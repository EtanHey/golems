#!/usr/bin/env python3
"""
session-miner — parameterized JSONL mining helper.

Reads a Claude Code session JSONL and emits a 10-section markdown digest:
1. Major dispatches timeline
2. User corrections (verbatim with event indices)
3. Architectural decisions (brain_store high-importance / decision-keyword chunks)
4. Task list evolution
5. Files created (Write calls)
6. brain_* call outcomes (search/store/digest/recall)
7. Sub-agent communications (cmux send_input / read_screen)
8. Cron / monitoring (CronCreate/Delete/ScheduleWakeup)
9. BrainLayer health events
10. Session close state (last assistant text, away_summary, last 30 events)

Hard rules baked in:
- Every claim cites an event index [N]
- User corrections are verbatim (truncated only at 1200 chars with marker)
- Low-importance loop-counter ticks are suppressed (not dropped silently — counted)
- Deduplicated content keyed by first 60 chars (case-insensitive)
- Output terminates with `MINE_DONE <label> <path> <line_count>` for parent agent parsing

Converged from 4 parallel miners on 2026-05-15. See:
$SESSION_ARCHIVE_ROOT/handoffs/2026-05-15-eod-mine/_mine_script.py (origin)
$SESSION_ARCHIVE_ROOT/research/2026-05-15-session-miner-design.md (design)

Usage:
  python3 session-miner.py --src PATH --out PATH [--label NAME] [--cap-lines N]

Exit codes: 0 success, 1 src missing, 2 parse error.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict


def hhmm(ts: str) -> str:
    return ts[11:16] if ts and len(ts) >= 16 else "?"


def load_events(src: str):
    events = []
    parse_errors = 0
    with open(src) as f:
        for i, line in enumerate(f):
            try:
                events.append((i, json.loads(line)))
            except Exception:
                parse_errors += 1
    return events, parse_errors


def categorize(events):
    user_msgs = []         # (idx, ts, text, kind)
    assistant_texts = []   # (idx, ts, text)
    tool_calls = []        # (idx, ts, name, inp, tool_use_id)
    tool_results = {}      # tool_use_id -> result text
    queue_ops = []         # (idx, ts, op, content)
    sys_events = []        # (idx, ts, subtype, content)

    for i, obj in events:
        t = obj.get("type")
        ts = obj.get("timestamp", "")
        if t == "user":
            msg = obj.get("message", {})
            content = msg.get("content")
            if isinstance(content, str):
                user_msgs.append((i, ts, content, "HUMAN"))
            elif isinstance(content, list):
                for c in content:
                    if not isinstance(c, dict):
                        continue
                    if c.get("type") == "text":
                        user_msgs.append((i, ts, c.get("text", ""), "HUMAN"))
                    elif c.get("type") == "tool_result":
                        tid = c.get("tool_use_id")
                        body = c.get("content", "")
                        if isinstance(body, list):
                            body = "".join(
                                p.get("text", "")
                                for p in body
                                if isinstance(p, dict)
                            )
                        if tid:
                            tool_results[tid] = str(body)
        elif t == "assistant":
            msg = obj.get("message", {})
            content = msg.get("content", [])
            if isinstance(content, list):
                for c in content:
                    if not isinstance(c, dict):
                        continue
                    ctype = c.get("type")
                    if ctype == "text":
                        txt = c.get("text", "")
                        if txt.strip():
                            assistant_texts.append((i, ts, txt))
                    elif ctype == "tool_use":
                        tool_calls.append(
                            (
                                i,
                                ts,
                                c.get("name", ""),
                                c.get("input", {}),
                                c.get("id", ""),
                            )
                        )
        elif t == "queue-operation":
            queue_ops.append(
                (i, ts, obj.get("operation", ""), obj.get("content", ""))
            )
        elif t == "system":
            sys_events.append(
                (i, ts, obj.get("subtype", ""), obj.get("content", ""))
            )

    return user_msgs, assistant_texts, tool_calls, tool_results, queue_ops, sys_events


CORRECTION_RE = re.compile(
    r"\b(why|what the fuck|for fuck'?s sake|no I|i told you|wrong|stop|should have|"
    r"instead of|fuck|focus|paused|never said|ffs)\b",
    re.IGNORECASE,
)

POLL_PREFIXES = (
    "orc monitor tick",
    "orc light monitor tick",
    "orc post-",
    "Monitor check:",
    "QUEUE-OPERATION",
    "/loop ",
    "[orc-s",      # self-issued cron monitor ticks like "[orc-s31 monitor-tick s:7/s:26/s:29] ..."
    "[orc s",      # variant spacing
)


def is_poll_message(text: str) -> bool:
    s = (text or "").lstrip()
    if not s:
        return False
    for p in POLL_PREFIXES:
        if s.startswith(p):
            return True
    return False


DECISION_KEYWORDS = (
    "decision",
    "verdict",
    "locked",
    "architecture",
    "phase report",
    "milestone",
    "ship",
    "supersede",
)


def build_dispatches(tool_calls):
    out = []
    for idx, ts, name, inp, _tid in tool_calls:
        if name == "TaskCreate":
            subj = inp.get("subject", "")
            out.append((idx, ts, "TaskCreate", "-", subj[:90]))
        elif name == "mcp__cmuxlayer__send_input":
            surface = inp.get("surface", inp.get("surface_id", "?"))
            text = inp.get("text", "") or inp.get("input", "") or ""
            first_line = text.split("\n", 1)[0][:140]
            out.append((idx, ts, "send_input", str(surface), first_line))
        elif name == "mcp__cmuxlayer__spawn_agent":
            target = inp.get("agent_name", inp.get("worker", "?"))
            prompt = (inp.get("prompt", "") or "")[:120]
            out.append((idx, ts, "spawn_agent", str(target), prompt))
        elif name == "mcp__cmuxlayer__send_to_agent":
            target = inp.get("agent_name", "?")
            msg = (inp.get("message", "") or "")[:120]
            out.append((idx, ts, "send_to_agent", str(target), msg))
        elif name == "mcp__cmuxlayer__new_split":
            ws = inp.get("workspace_id", inp.get("agent_name", "?"))
            out.append(
                (idx, ts, "new_split", str(ws), json.dumps(inp)[:120])
            )
        elif name == "Agent":
            stype = inp.get("subagent_type", "general-purpose")
            desc = (inp.get("description", "") or "")[:90]
            out.append((idx, ts, f"Agent({stype})", "-", desc))
    return out


def collect_corrections(user_msgs):
    corrections = []
    interrupts = []
    for idx, ts, text, kind in user_msgs:
        if kind == "INTERRUPT":
            interrupts.append((idx, ts, text))
            continue
        if is_poll_message(text):
            continue
        s = (text or "").strip()
        if s.startswith("@orc — TASK_DONE") or s.startswith("@orc TASK_DONE"):
            continue
        if CORRECTION_RE.search(text or ""):
            corrections.append((idx, ts, text))
    return corrections, interrupts


def collect_architectural(tool_calls, decision_keys):
    out = []
    for idx, ts, name, inp, _tid in tool_calls:
        if name != "mcp__brainlayer__brain_store":
            continue
        content = inp.get("content", "") or ""
        tags = inp.get("tags", []) or []
        importance = inp.get("importance", 0)
        try:
            imp = int(importance)
        except Exception:
            imp = 0
        tag_str = " ".join(str(t).lower() for t in tags)
        if "loop-counter" in tag_str or "orc-monitor" in tag_str:
            continue
        has_dec_kw = any(k.lower() in content.lower() for k in decision_keys)
        has_dec_tag = any(
            ("decision" in str(t).lower() or "architecture" in str(t).lower())
            for t in tags
        )
        if imp >= 7 or has_dec_kw or has_dec_tag:
            out.append((idx, ts, content, tags, imp))
    # Dedup by first 60 chars
    seen = set()
    deduped = []
    for row in out:
        key = row[2][:60].lower().strip()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def collect_file_writes(tool_calls):
    return [
        (idx, ts, inp)
        for idx, ts, name, inp, _tid in tool_calls
        if name == "Write"
    ]


def collect_brain_outcomes(tool_calls, tool_results):
    out = []
    for idx, ts, name, inp, tid in tool_calls:
        if not name.startswith("mcp__brainlayer__"):
            continue
        result = tool_results.get(tid, "")
        out.append((idx, ts, name, inp, result[:200]))
    return out


def collect_agent_comms(tool_calls, tool_results):
    comms = defaultdict(list)
    for idx, ts, name, inp, tid in tool_calls:
        if name == "mcp__cmuxlayer__send_input":
            surface = str(inp.get("surface", "?"))
            text = inp.get("text", "") or inp.get("input", "") or ""
            comms[surface].append((idx, ts, "SENT", text))
        elif name == "mcp__cmuxlayer__read_screen":
            surface = str(inp.get("surface", "?"))
            result = tool_results.get(tid, "")
            comms[surface].append((idx, ts, "READ", result[:600]))
    return comms


def collect_cron(tool_calls):
    return [
        (idx, ts, name, inp)
        for idx, ts, name, inp, _tid in tool_calls
        if name in ("CronCreate", "CronDelete", "ScheduleWakeup")
    ]


HEALTH_KEYWORDS = (
    "DB-busy",
    "db busy",
    "database is locked",
    "MCP disconnect",
    "MCP reconnect",
    "WAL",
    "enrichment",
    "backup-daily",
    "drain",
    "queue_depth",
    "collisions_dropped",
    "fall-back",
    "fallback",
)


def collect_health(tool_calls, user_msgs):
    out = []
    for idx, ts, name, inp, _tid in tool_calls:
        content = ""
        if name == "mcp__brainlayer__brain_store":
            content = inp.get("content", "") or ""
        elif name == "Bash":
            content = inp.get("command", "") or ""
        if not content:
            continue
        for kw in HEALTH_KEYWORDS:
            if kw.lower() in content.lower():
                out.append((idx, ts, name, kw, content[:250]))
                break
    for idx, ts, text, kind in user_msgs:
        if kind == "INTERRUPT":
            continue
        for kw in HEALTH_KEYWORDS:
            if kw.lower() in (text or "").lower():
                out.append((idx, ts, "USER_MSG", kw, (text or "")[:250]))
                break
    # Dedup
    seen = set()
    deduped = []
    for row in out:
        key = (row[3], row[4][:80])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def render(
    src,
    out_path,
    label,
    size_bytes,
    n_events,
    n_parse_errors,
    user_msgs,
    assistant_texts,
    tool_calls,
    queue_ops,
    sys_events,
    dispatches,
    corrections,
    interrupts,
    architectural,
    file_writes,
    brain_outcomes,
    agent_comms,
    cron_events,
    health_events,
    events,
):
    n_human = len([u for u in user_msgs if u[3] == "HUMAN"])
    n_tools = len(tool_calls)

    L = []
    L.append(f"# Session Mine — {label} ({os.path.basename(src).split('.')[0]})")
    L.append(f"**Source:** `{src}`")
    L.append(f"**Generated by:** session-miner agent (~/.claude/scripts/session-miner.py)")
    L.append(
        f"**Session size:** {size_bytes:,} bytes, {n_events:,} events "
        f"({n_tools} tool calls, {n_human} human user messages, {len(queue_ops)} queue ops)"
    )
    if events:
        first_ts = next((e[1].get("timestamp") for e in events if e[1].get("timestamp")), "?")
        last_ts = next((e[1].get("timestamp") for e in reversed(events) if e[1].get("timestamp")), "?")
        L.append(f"**Time span:** {first_ts} → {last_ts}")
    if n_parse_errors:
        L.append(f"**Parse errors:** {n_parse_errors} lines failed JSON.parse (likely truncated tail)")
    L.append("")
    L.append("---")
    L.append("")

    # Section 1: Major dispatches timeline
    L.append("## 1. Major dispatches timeline")
    L.append("")
    if not dispatches:
        L.append("_(no dispatches found)_")
    else:
        L.append("| Event | HH:MM | Type | Target | Summary |")
        L.append("|------:|:------|:-----|:-------|:--------|")
        seen_tasks = {}
        for idx, ts, kind, tgt, summary in dispatches:
            if kind == "TaskCreate":
                key = (summary or "")[:60]
                prev_ts = seen_tasks.get(key)
                if prev_ts and ts and prev_ts[:13] == ts[:13]:
                    continue  # same-hour duplicate
                seen_tasks[key] = ts
            s = (summary or "").replace("|", "\\|").replace("\n", " ")
            L.append(f"| [{idx}] | {hhmm(ts)} | {kind} | {tgt} | {s[:120]} |")
    L.append("")

    # Section 2: User corrections
    L.append("## 2. User corrections (verbatim with event index)")
    L.append("")
    if not corrections and not interrupts:
        L.append("_(no corrections found)_")
    else:
        L.append(f"_Total corrections: {len(corrections)}; interrupts (escape): {len(interrupts)}._")
        L.append("")
        L.append("### Direct corrections")
        L.append("")
        for idx, ts, text in corrections:
            clean = (text or "").strip().replace("\r", "")
            L.append(f"**[{idx}] {hhmm(ts)}:**")
            L.append("")
            L.append("> " + clean[:1200].replace("\n", "\n> "))
            if len(clean) > 1200:
                L.append("> _(truncated)_")
            L.append("")
        if interrupts:
            L.append("### Interrupts (escape pressed — signal of wrong-track)")
            L.append("")
            L.append(", ".join(f"[{idx}] {hhmm(ts)}" for idx, ts, _ in interrupts))
            L.append("")

    # Section 3: Architectural decisions
    L.append("## 3. Architectural decisions (brain_store, importance≥7 or decision-tagged)")
    L.append("")
    if not architectural:
        L.append("_(no entries found)_")
    else:
        L.append(f"_{len(architectural)} unique chunks after dedup. Loop-counter / orc-monitor ticks excluded._")
        L.append("")
        for idx, ts, content, tags, imp in architectural:
            L.append(f"### [{idx}] {hhmm(ts)} — importance={imp}, tags={tags[:6]}")
            L.append("")
            snip = (content or "")[:600]
            L.append("> " + snip.replace("\n", "\n> "))
            if len(content or "") > 600:
                L.append("> _(truncated)_")
            L.append("")

    # Section 4: Task list evolution
    task_creates = [(idx, ts, inp) for idx, ts, name, inp, _ in tool_calls if name == "TaskCreate"]
    task_updates = [(idx, ts, inp) for idx, ts, name, inp, _ in tool_calls if name == "TaskUpdate"]
    L.append("## 4. Task list evolution")
    L.append("")
    L.append(f"**TaskCreate calls:** {len(task_creates)} · **TaskUpdate calls:** {len(task_updates)}")
    L.append("")
    if task_creates:
        L.append("| # | Event | HH:MM | Subject |")
        L.append("|--:|------:|:------|:--------|")
        for n, (idx, ts, inp) in enumerate(task_creates, 1):
            subj = (inp.get("subject", "") or "").replace("|", "\\|").replace("\n", " ")
            L.append(f"| {n} | [{idx}] | {hhmm(ts)} | {subj[:120]} |")
        L.append("")

    # Section 5: Files created
    L.append("## 5. Files created (Write tool)")
    L.append("")
    if not file_writes:
        L.append("_(no entries found)_")
    else:
        for idx, ts, inp in file_writes:
            fp = inp.get("file_path", "?")
            content = inp.get("content", "") or ""
            first_line = content.split("\n", 1)[0][:100] if content else ""
            L.append(f"- **[{idx}] {hhmm(ts)}:** `{fp}` ({len(content):,} chars)")
            if first_line:
                L.append(f"  - First line: `{first_line}`")
    L.append("")

    # Section 6: brain_* call outcomes
    L.append("## 6. brain_* call outcomes")
    L.append("")
    by_name = defaultdict(list)
    for idx, ts, name, inp, result in brain_outcomes:
        by_name[name].append((idx, ts, inp, result))
    if not by_name:
        L.append("_(no brain_* calls)_")
    else:
        for name, calls in sorted(by_name.items()):
            L.append(f"### {name} — {len(calls)} calls")
            L.append("")
            if name == "mcp__brainlayer__brain_search":
                for idx, ts, inp, result in calls:
                    q = inp.get("query", "") or ""
                    L.append(f"- **[{idx}] {hhmm(ts)}:** query=`{q[:100]}`")
                    L.append(f"  - result: `{result[:200]}`")
            elif name == "mcp__brainlayer__brain_store":
                kept = 0
                for idx, ts, inp, result in calls:
                    tags = inp.get("tags", []) or []
                    try:
                        imp = int(inp.get("importance", 0))
                    except Exception:
                        imp = 0
                    if imp < 6:
                        continue
                    snip = (inp.get("content", "") or "")[:90].replace("\n", " ")
                    tag_str = ",".join(str(t) for t in tags[:5])
                    ok = "ok" if ("ok" in result.lower() or "stored" in result.lower()) else result[:40]
                    L.append(f"- [{idx}] {hhmm(ts)} imp={imp} [{tag_str}] → `{snip}` ({ok})")
                    kept += 1
                skipped = len(calls) - kept
                if skipped:
                    L.append(f"- _(suppressed {skipped} low-importance brain_store entries — mostly loop-counter ticks)_")
            else:
                for idx, ts, inp, result in calls:
                    L.append(f"- [{idx}] {hhmm(ts)}: inp=`{json.dumps(inp)[:150]}` → `{result[:120]}`")
            L.append("")

    # Section 7: Sub-agent communications
    L.append("## 7. Sub-agent communications (cmux send_input / read_screen)")
    L.append("")
    if not agent_comms:
        L.append("_(no cmux comms)_")
    else:
        for surface in sorted(agent_comms.keys()):
            entries = agent_comms[surface]
            sent = [e for e in entries if e[2] == "SENT"]
            read = [e for e in entries if e[2] == "READ"]
            if not sent and not read:
                continue
            L.append(f"### {surface} — {len(sent)} sent, {len(read)} read_screens")
            L.append("")
            for idx, ts, _kind, text in sent:
                first = (text or "").strip().split("\n", 1)[0][:160]
                L.append(f"- [{idx}] {hhmm(ts)}: {first}")
            L.append("")

    # Section 8: Cron / monitoring
    L.append("## 8. Cron / monitoring")
    L.append("")
    if not cron_events:
        L.append("_(no cron/schedule entries)_")
    else:
        for idx, ts, name, inp in cron_events:
            if name == "CronCreate":
                cron = inp.get("cron", "?")
                prompt = (inp.get("prompt", "") or "")[:180].replace("\n", " ")
                L.append(f"- **[{idx}] {hhmm(ts)} CronCreate:** `{cron}`")
                L.append(f"  - prompt: `{prompt}`")
            elif name == "CronDelete":
                L.append(f"- **[{idx}] {hhmm(ts)} CronDelete:** id=`{inp.get('id', '?')}`")
            else:
                L.append(f"- [{idx}] {hhmm(ts)} {name}: `{json.dumps(inp)[:150]}`")
    L.append("")

    # Section 9: BrainLayer health events
    L.append("## 9. BrainLayer health events")
    L.append("")
    if not health_events:
        L.append("_(no health-keyword hits)_")
    else:
        L.append(f"_{len(health_events)} unique events._")
        L.append("")
        for idx, ts, source, kw, content in health_events:
            snippet = (content or "").replace("\n", " ").strip()[:200]
            L.append(f"- [{idx}] {hhmm(ts)} ({source}, kw=\"{kw}\"): {snippet}")
    L.append("")

    # Section 10: Session close state
    L.append("## 10. Session close state")
    L.append("")
    if events:
        L.append(f"**Last event timestamp:** `{events[-1][1].get('timestamp', '?')}`")
    last_asst = None
    for idx, ts, text in reversed(assistant_texts):
        last_asst = (idx, ts, text)
        break
    if last_asst:
        idx, ts, text = last_asst
        L.append("")
        L.append(f"**Final assistant message [{idx}] {hhmm(ts)}:**")
        L.append("")
        L.append("> " + (text or "")[:1500].replace("\n", "\n> "))
        if len(text or "") > 1500:
            L.append("> _(truncated)_")
        L.append("")

    aways = [(idx, ts, sub, content) for idx, ts, sub, content in sys_events if sub == "away_summary"]
    if aways:
        L.append("### away_summary system events")
        L.append("")
        for idx, ts, _sub, content in aways:
            L.append(f"- **[{idx}] {hhmm(ts)}:** {(content or '')[:500]}")
        L.append("")

    # Last 30 events condensed
    L.append("### Last 30 events (chronological, condensed)")
    L.append("")
    L.append("```")
    for idx, obj in events[-30:]:
        t = obj.get("type", "?")
        ts = obj.get("timestamp", "")
        tt = ts[11:16] if ts and len(ts) >= 16 else ""
        if t == "user":
            msg = obj.get("message", {})
            c = msg.get("content")
            txt = ""
            if isinstance(c, str):
                txt = c[:100]
            elif isinstance(c, list):
                for x in c:
                    if isinstance(x, dict):
                        if x.get("type") == "text":
                            txt = (x.get("text", "") or "")[:100]
                        elif x.get("type") == "tool_result":
                            tc = x.get("content", "")
                            if isinstance(tc, list):
                                tc = "".join(p.get("text", "") for p in tc if isinstance(p, dict))
                            txt = f"[tool_result] {str(tc)[:80]}"
            L.append(f"[{idx}] {tt} USER: {txt}")
        elif t == "assistant":
            msg = obj.get("message", {})
            for c in msg.get("content", []) or []:
                if not isinstance(c, dict):
                    continue
                if c.get("type") == "text":
                    L.append(f"[{idx}] {tt} ASST: {(c.get('text', '') or '')[:100]}")
                elif c.get("type") == "tool_use":
                    L.append(
                        f"[{idx}] {tt} TOOL: {c.get('name', '')} {json.dumps(c.get('input', {}))[:100]}"
                    )
        elif t == "system":
            L.append(f"[{idx}] {tt} SYS: {obj.get('subtype', '')} {(obj.get('content', '') or '')[:100]}")
    L.append("```")
    L.append("")

    # Write
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w") as f:
        f.write("\n".join(L))
    with open(out_path) as f:
        line_count = sum(1 for _ in f)
    return line_count


def main():
    ap = argparse.ArgumentParser(description="Mine a Claude Code session JSONL into a 10-section markdown digest.")
    ap.add_argument("--src", required=True, help="Path to session JSONL")
    ap.add_argument("--out", required=True, help="Output markdown path")
    ap.add_argument("--label", default="session", help="Label for the mine (e.g. 'orc', 'voicelayer')")
    ap.add_argument(
        "--cap-lines",
        type=int,
        default=0,
        help="Soft line cap (0 = no cap). When exceeded, last-30 events are trimmed first.",
    )
    args = ap.parse_args()

    if not os.path.exists(args.src):
        print(f"ERROR: source not found: {args.src}", file=sys.stderr)
        sys.exit(1)

    try:
        events, parse_errors = load_events(args.src)
    except Exception as e:
        print(f"ERROR: parse failure on {args.src}: {e}", file=sys.stderr)
        sys.exit(2)

    size_bytes = os.path.getsize(args.src)
    n_events = len(events)

    (user_msgs, assistant_texts, tool_calls, tool_results, queue_ops, sys_events) = categorize(events)

    dispatches = build_dispatches(tool_calls)
    corrections, interrupts = collect_corrections(user_msgs)
    architectural = collect_architectural(tool_calls, DECISION_KEYWORDS)
    file_writes = collect_file_writes(tool_calls)
    brain_outcomes = collect_brain_outcomes(tool_calls, tool_results)
    agent_comms = collect_agent_comms(tool_calls, tool_results)
    cron_events = collect_cron(tool_calls)
    health_events = collect_health(tool_calls, user_msgs)

    line_count = render(
        args.src,
        args.out,
        args.label,
        size_bytes,
        n_events,
        parse_errors,
        user_msgs,
        assistant_texts,
        tool_calls,
        queue_ops,
        sys_events,
        dispatches,
        corrections,
        interrupts,
        architectural,
        file_writes,
        brain_outcomes,
        agent_comms,
        cron_events,
        health_events,
        events,
    )

    print(f"MINE_DONE {args.label} {args.out} {line_count}")


if __name__ == "__main__":
    main()
