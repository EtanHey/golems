#!/usr/bin/env python3
"""weave-cursor-run.py — wide/deep cursor-agent fan-out weave with rich live terminal UI.

One headless cursor-agent miner per session (auto model — never --model). Keeps
12–20 miners in flight via bounded semaphore. Mines ALL Claude + Codex JSONLs
since cutoff.

Usage:
  python3 weave-cursor-run.py run --cutoff 2026-06-14T05:30:00Z \\
      --workdir <repo>/docs.local/weave-2026-06-18-cursor-wide \\
      --concurrency 16 --fresh
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

try:
    from rich.console import Console, Group
    from rich.live import Live
    from rich.panel import Panel
    from rich.progress import BarColumn, Progress, SpinnerColumn, TextColumn, TimeElapsedColumn
    from rich.table import Table
    from rich.text import Text
except ImportError:
    print("ERROR: rich required — pip install rich", file=sys.stderr)
    raise SystemExit(1)

HERE = Path(__file__).resolve().parent
PREP = HERE / "prepare-mine-context.py"
LEDGER = HERE / "weave-ledger.py"

CLAUDE_PROJECTS = Path.home() / ".claude" / "projects"
CODEX_SESSIONS = Path.home() / ".codex" / "sessions"
CURSOR_PROJECTS = Path.home() / ".cursor" / "projects"

DEFAULT_CONCURRENCY = 16
MIN_CONCURRENCY = 12
MAX_CONCURRENCY = 20
DEFAULT_CHUNK_SIZE = 1  # one session per miner — wide + deep

FINDINGS_SCHEMA = (
    '{"id":"<label>#N","title":"...","detail":"...","evidence":"verbatim — [line N]",'
    '"type":"correction|frustration|anti-pattern|skill-gap|skill-candidate|decision|'
    'residual-bug|what-worked","track":"cmuxLayer|BrainLayer|VoiceLayer|MCL|MCP-layer|'
    'skill-creator|dashboard|plans|collab|cross-cutting","disposition":"MERGED-PR|'
    'PR-FILED|PR-FIX|SKILL-NEW|SKILL-EDIT|DEEP-RESEARCH|FOLLOW-UP|REJECTED|PARKED|'
    'KEEP|DUPLICATE|TRACKED","importance":1-10,"recurring":true|false}'
)


def _resolve_cursor_agent() -> str:
    """Resolve cursor-agent binary. CURSOR_AGENT=1 is cmux seat pollution — ignore it."""
    env_val = os.environ.get("CURSOR_AGENT", "").strip()
    if env_val and os.path.isfile(env_val) and os.access(env_val, os.X_OK):
        return env_val
    found = shutil.which("cursor-agent")
    if found:
        return found
    raise RuntimeError("cursor-agent not found on PATH")


def _subprocess_env() -> dict[str, str]:
    """Child env for cursor-agent spawns — strip bogus CURSOR_AGENT=1."""
    env = os.environ.copy()
    ca = env.get("CURSOR_AGENT", "")
    if ca and not (os.path.isfile(ca) and os.access(ca, os.X_OK)):
        env.pop("CURSOR_AGENT", None)
    return env


def _spawn_cursor_agent(prompt: str, timeout: int = 900) -> subprocess.CompletedProcess[str]:
    """Spawn cursor-agent with a sanitized argv list and child env."""
    binary = _resolve_cursor_agent()
    # argv MUST be list[str]; prompt is a single argument — never split concurrency into argv
    cmd: list[str] = [binary, "-p", "--force", "--output-format", "json", prompt]
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        env=_subprocess_env(),
    )


# ------------------------------------------------------------------ discovery
def _is_noise_session(path: Path) -> bool:
    return "subagents" in path.parts


def _parse_cutoff(s: str) -> float:
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def claude_label(jsonl: Path) -> str:
    slug = re.sub(r"^-Users-.+?-Gits-", "", jsonl.parent.name)
    slug = re.sub(r"^-Users-[^-]+-", "", slug)
    return f"{slug}/{jsonl.stem[:8]}"


def codex_label(jsonl: Path) -> str:
    return f"codex/{jsonl.stem}"


def cursor_label(jsonl: Path) -> str:
    parts = jsonl.parts
    try:
        idx = parts.index("projects")
        slug = re.sub(r"^Users-.+?-Gits-", "", parts[idx + 1])
        slug = re.sub(r"^Users-[^-]+-", "", slug)
    except (ValueError, IndexError):
        slug = "cursor"
    return f"cursor/{slug}/{jsonl.stem[:8]}"


def discover_sessions(
    cutoff_ts: float,
    centerpiece_repo: str = "orchestrator",
    sources: set[str] | None = None,
) -> list[dict]:
    if sources is None:
        sources = {"claude", "codex", "cursor"}
    sessions: list[dict] = []

    def add(jsonl: Path, source: str, label_fn):
        try:
            st = jsonl.stat()
        except OSError:
            return
        if st.st_mtime < cutoff_ts or st.st_size == 0:
            return
        if _is_noise_session(jsonl):
            return
        slug = jsonl.parent.name if source != "cursor" else ""
        sessions.append({
            "label": label_fn(jsonl),
            "src": str(jsonl),
            "source": source,
            "size": st.st_size,
            "mtime": int(st.st_mtime),
            "centerpiece": centerpiece_repo in slug or centerpiece_repo in str(jsonl),
        })

    if "claude" in sources:
        for jsonl in CLAUDE_PROJECTS.glob("**/*.jsonl"):
            add(jsonl, "claude", claude_label)
    if "codex" in sources:
        if CODEX_SESSIONS.exists():
            for jsonl in CODEX_SESSIONS.glob("**/*.jsonl"):
                add(jsonl, "codex", codex_label)
    if "cursor" in sources:
        if CURSOR_PROJECTS.exists():
            for jsonl in CURSOR_PROJECTS.glob("**/agent-transcripts/**/*.jsonl"):
                add(jsonl, "cursor", cursor_label)

    seen: set[str] = set()
    uniq: list[dict] = []
    for s in sorted(sessions, key=lambda x: (not x["centerpiece"], -x["size"])):
        if s["label"] in seen:
            continue
        seen.add(s["label"])
        uniq.append(s)
    return uniq


def findings_path(wd: Path, label: str) -> Path:
    return wd / "findings" / (label.replace("/", "__") + ".jsonl")


def ctx_path(wd: Path, label: str) -> Path:
    return wd / "mine-context" / (label.replace("/", "__") + ".md")


# ------------------------------------------------------------------- prepare
def prepare_contexts(wd: Path, sessions: list[dict], digest_min_mb: float = 0.3) -> int:
    ctx_dir = wd / "mine-context"
    digests = wd / "digests"
    ctx_dir.mkdir(parents=True, exist_ok=True)
    digests.mkdir(parents=True, exist_ok=True)
    session_miner = HERE.parent.parent / "skill-creator" / "scripts" / "session-miner.py"
    min_bytes = int(digest_min_mb * 1048576)
    ok = 0
    for s in sessions:
        if s["source"] == "claude" and s["size"] >= min_bytes and session_miner.exists():
            dg = digests / (s["label"].replace("/", "__") + ".md")
            if not dg.exists():
                subprocess.run(
                    [sys.executable, str(session_miner), "--src", s["src"],
                     "--out", str(dg), "--label", s["label"].split("/")[0]],
                    capture_output=True, text=True,
                )
            if dg.exists():
                s["digest"] = str(dg)
        r = subprocess.run(
            [sys.executable, str(PREP), "--ctx-dir", str(ctx_dir)],
            input=json.dumps(s), capture_output=True, text=True,
        )
        if r.returncode == 0:
            ok += 1
    return ok


# --------------------------------------------------------------------- miners
MINER_PROMPT = """DEEP weave session miner — extract EVERY pain point, not a sample.

Read the mine-context file (digest + grep excerpts). For verbatim quotes, grep the raw JSONL
by jsonl_line=N from the Grep excerpts section. NEVER load the whole JSONL into context.

Session: {label}
Context file: {ctx_file}
Raw JSONL: {src_path}
Output findings JSONL: {out_path}

DEEP extraction mandate (non-negotiable):
- Mine ALL operator corrections, frustrations, repeated mistakes, regressions, blockers
- Mine what slowed orc down, topology violations, verify-submit failures, monitor gaps
- Mine skill gaps, false-green, data-loss risks, deploy target mistakes
- For non-trivial sessions: target 5–20 findings minimum; centerpiece/orchestrator sessions: 10–30+
- Suppress ONLY: loop/cron/queue-operation noise, duplicate brain_search injections
- Empty/trivial session → empty output file (never invent)

Each finding — one JSON object per line:
{schema}

Rules:
- Verbatim evidence with jsonl_line=N or [line N] cite from RAW user turns when possible
- Write the JSONL file FIRST (terminal deliverable), then reply: WEAVE_MINE_DONE {label} <count>
- Files only — no brain_store
"""


def run_miner(miner_id: int, sessions: list[dict], wd: Path, state: "WeaveState") -> dict:
    assert len(sessions) == 1, "wide weave = one session per miner"
    session = sessions[0]
    label = session["label"]
    out_path = findings_path(wd, label)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if out_path.exists() and out_path.stat().st_size > 10:
        count = sum(1 for ln in out_path.open() if ln.strip())
        state.set_miner(miner_id, "done", count, 0, 0, label=label)
        return {"miner_id": miner_id, "label": label, "status": "done", "count": count, "tokens": 0, "elapsed": 0}

    prompt = MINER_PROMPT.format(
        label=label,
        ctx_file=ctx_path(wd, label),
        src_path=session["src"],
        out_path=out_path,
        schema=FINDINGS_SCHEMA,
    )

    t0 = time.time()
    state.set_miner(miner_id, "running", 0, label=label)
    try:
        r = _spawn_cursor_agent(prompt, timeout=900)
        elapsed = time.time() - t0
        count = sum(1 for ln in out_path.open() if ln.strip()) if out_path.exists() else 0
        tokens = 0
        try:
            agent_out = json.loads(r.stdout)
            usage = agent_out.get("usage", {})
            tokens = usage.get("inputTokens", 0) + usage.get("outputTokens", 0)
        except (json.JSONDecodeError, AttributeError):
            pass

        if count > 0:
            status = "done"
            err = ""
        elif r.returncode == 0:
            status = "done"
            err = "0 findings"
        else:
            status = "fail"
            err = (r.stderr or r.stdout or "unknown")[:120]
        state.set_miner(miner_id, status, count, elapsed, tokens, label=label, error=err)
        return {"miner_id": miner_id, "label": label, "status": status, "count": count, "tokens": tokens, "elapsed": elapsed}
    except subprocess.TimeoutExpired:
        state.set_miner(miner_id, "timeout", 0, 900, 0, label=label, error="timeout 900s")
        return {"miner_id": miner_id, "label": label, "status": "timeout", "count": 0, "tokens": 0, "elapsed": 900}
    except Exception as e:
        state.set_miner(miner_id, "error", 0, time.time() - t0, 0, label=label, error=str(e)[:120])
        return {"miner_id": miner_id, "label": label, "status": "error", "count": 0, "tokens": 0, "elapsed": 0}


@dataclass
class MinerStatus:
    miner_id: int
    label: str = ""
    status: str = "queued"  # queued | running | done | fail | timeout | error
    findings: int = 0
    elapsed: float = 0.0
    tokens: int = 0
    error: str = ""


@dataclass
class WeaveState:
    phase: str = "init"
    message: str = ""
    concurrency: int = DEFAULT_CONCURRENCY
    miners: dict[int, MinerStatus] = field(default_factory=dict)
    total_sessions: int = 0
    findings_total: int = 0
    tokens_total: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def set_phase(self, phase: str, message: str = ""):
        with self.lock:
            self.phase = phase
            self.message = message

    def set_miner(
        self, miner_id: int, status: str, findings: int,
        elapsed: float = 0, tokens: int = 0,
        label: str | None = None, error: str = "",
    ):
        with self.lock:
            m = self.miners.get(miner_id)
            if m:
                m.status = status
                m.findings = findings
                m.elapsed = elapsed
                m.tokens = tokens
                if label:
                    m.label = label
                if error:
                    m.error = error
            self.findings_total = sum(x.findings for x in self.miners.values() if x.status == "done")
            self.tokens_total = sum(x.tokens for x in self.miners.values())

    def init_miners(self, sessions: list[dict]):
        with self.lock:
            self.miners = {
                i: MinerStatus(miner_id=i, label=s["label"], status="queued")
                for i, s in enumerate(sessions)
            }
            self.total_sessions = len(sessions)

    def counts(self) -> dict[str, int]:
        with self.lock:
            c = {"queued": 0, "running": 0, "done": 0, "failed": 0}
            for m in self.miners.values():
                if m.status == "queued":
                    c["queued"] += 1
                elif m.status == "running":
                    c["running"] += 1
                elif m.status == "done":
                    c["done"] += 1
                else:
                    c["failed"] += 1
            return c


def build_ui(state: WeaveState) -> Panel:
    with state.lock:
        phase = state.phase
        msg = state.message
        miners = list(state.miners.values())
        findings = state.findings_total
        tokens = state.tokens_total
        total = state.total_sessions
        conc = state.concurrency

    counts = state.counts()

    header = Table.grid(expand=True)
    header.add_column()
    header.add_row(
        f"[bold]Sessions {total}[/] · "
        f"[cyan]▶ running {counts['running']}[/] · "
        f"[dim]○ queued {counts['queued']}[/] · "
        f"[green]✓ done {counts['done']}[/] · "
        f"[red]✗ failed {counts['failed']}[/] · "
        f"in-flight cap {conc} · findings {findings:,} · tokens {tokens:,}"
    )

    prog = Progress(
        SpinnerColumn(),
        TextColumn("[bold]{task.description}"),
        BarColumn(bar_width=40),
        TextColumn("{task.completed}/{task.total}"),
        TimeElapsedColumn(),
        expand=True,
    )
    finished = counts["done"] + counts["failed"]
    prog.add_task(f"weave-cursor — {phase}", total=total or 1, completed=finished)

    if msg:
        header.add_row(f"[dim]{msg}[/]")

    # ALL miners visible — scrollable table
    tbl = Table(
        title=f"Parallel miners ({len(miners)} total)",
        expand=True,
        show_header=True,
        header_style="bold",
        pad_edge=False,
    )
    tbl.add_column("#", style="dim", width=4, justify="right")
    tbl.add_column("st", width=3)
    tbl.add_column("session", min_width=28, no_wrap=True)
    tbl.add_column("f", width=4, justify="right")
    tbl.add_column("s", width=5, justify="right")
    tbl.add_column("err", max_width=36, overflow="ellipsis")

    icon = {"queued": "○", "running": "▶", "done": "✓", "fail": "✗", "timeout": "⏱", "error": "!"}
    color = {"queued": "dim", "running": "yellow", "done": "green", "fail": "red", "timeout": "red", "error": "red"}

    for m in sorted(miners, key=lambda x: (x.status != "running", x.status == "done", x.miner_id)):
        st = m.status
        tbl.add_row(
            str(m.miner_id),
            f"[{color.get(st, 'white')}]{icon.get(st, '?')}[/]",
            m.label[:42],
            str(m.findings) if m.findings else "—",
            f"{m.elapsed:.0f}" if m.elapsed else "—",
            f"[red]{m.error}[/]" if m.error else "",
        )

    return Panel(Group(header, prog, tbl), title="🧵 weave-cursor-run WIDE", border_style="blue")


def chunk_sessions(sessions: list[dict], chunk_size: int) -> list[list[dict]]:
    return [sessions[i:i + chunk_size] for i in range(0, len(sessions), chunk_size)]


SYNTH_PROMPT = """You are the weave synthesizer. Read:
  {ledger_path}
  {ledger_json}

Write markdown to {out_path} with sections:
## Summary (4-6 paragraphs — deep, cite progression vs gen-16)
## Pain-Points Ledger (ranked) — top 20, frequency×severity table
## Plan for Next orcClaude — 5 parallel tracks, mined actions only

Then reply: WEAVE_SYNTH_DONE
"""


def synthesize(wd: Path, out_retro: Path, state: WeaveState) -> bool:
    state.set_phase("synthesize", f"writing {out_retro.name}")
    prompt = SYNTH_PROMPT.format(
        ledger_path=wd / "ACTION-LEDGER.md",
        ledger_json=wd / "ledger.json",
        out_path=out_retro,
    )
    try:
        _spawn_cursor_agent(prompt, timeout=600)
    except Exception:
        pass
    return out_retro.exists()


def _fresh_workdir(wd: Path):
    for sub in ("findings", "mine-context", "digests"):
        d = wd / sub
        if d.exists():
            shutil.rmtree(d)


# ----------------------------------------------------------------------- run
def cmd_discover(args) -> int:
    sources = set(args.sources.split(","))
    cutoff_ts = _parse_cutoff(args.cutoff)
    sessions = discover_sessions(cutoff_ts, args.centerpiece_repo, sources)
    wd = Path(args.workdir)
    wd.mkdir(parents=True, exist_ok=True)
    manifest = {
        "cutoff": args.cutoff,
        "cutoff_ts": cutoff_ts,
        "sources": sorted(sources),
        "discovered_at": datetime.now(timezone.utc).isoformat(),
        "sessions": sessions,
    }
    (wd / "corpus-manifest.json").write_text(json.dumps(manifest, indent=2))
    cp = sum(1 for s in sessions if s["centerpiece"])
    mb = sum(s["size"] for s in sessions) / 1048576
    by_src: dict[str, int] = {}
    for s in sessions:
        by_src[s["source"]] = by_src.get(s["source"], 0) + 1
    print(f"DISCOVERED {len(sessions)} sessions since {args.cutoff} ({cp} centerpiece, {mb:.1f} MB)")
    print(f"  by source: {by_src}")
    return 0


def cmd_run(args) -> int:
    wd = Path(args.workdir)
    wd.mkdir(parents=True, exist_ok=True)
    if args.fresh:
        _fresh_workdir(wd)

    concurrency = max(MIN_CONCURRENCY, min(MAX_CONCURRENCY, args.concurrency))
    state = WeaveState(concurrency=concurrency)
    console = Console()
    sources = set(args.sources.split(","))
    cutoff_ts = _parse_cutoff(args.cutoff)

    with Live(build_ui(state), console=console, refresh_per_second=6, vertical_overflow="visible") as live:
        def refresh():
            live.update(build_ui(state))

        state.set_phase("discover", f"scanning {','.join(sorted(sources))} since {args.cutoff}")
        refresh()
        sessions = discover_sessions(cutoff_ts, args.centerpiece_repo, sources)
        manifest = {
            "cutoff": args.cutoff,
            "cutoff_ts": cutoff_ts,
            "sources": sorted(sources),
            "prior_weave": args.prior_weave,
            "mode": "wide-deep",
            "chunk_size": args.chunk_size,
            "concurrency": concurrency,
            "discovered_at": datetime.now(timezone.utc).isoformat(),
            "sessions": sessions,
        }
        (wd / "corpus-manifest.json").write_text(json.dumps(manifest, indent=2))

        if not sessions:
            state.set_phase("done", "no sessions in window")
            refresh()
            return 0

        state.set_phase("prepare", f"mine-context for {len(sessions)} sessions")
        refresh()
        prepared = prepare_contexts(wd, sessions)
        state.set_phase("prepare", f"prepared {prepared}/{len(sessions)}")
        refresh()

        chunks = chunk_sessions(sessions, args.chunk_size)
        state.init_miners(sessions)
        state.set_phase("mine", f"{len(chunks)} miners · {concurrency} in flight")
        refresh()

        (wd / "findings").mkdir(parents=True, exist_ok=True)
        results: list[dict] = []
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = {
                pool.submit(run_miner, i, chunk, wd, state): i
                for i, chunk in enumerate(chunks)
            }
            for fut in as_completed(futures):
                results.append(fut.result())
                refresh()

        done_n = sum(1 for r in results if r["status"] == "done")
        if done_n == 0:
            state.set_phase("failed", f"0/{len(chunks)} miners succeeded")
            refresh()
            console.print("[red]Mining failed — check miners table for errors[/]")
            return 1

        state.set_phase("aggregate", "weave-ledger.py")
        refresh()
        subprocess.run(
            [sys.executable, str(LEDGER),
             "--findings-dir", str(wd / "findings"),
             "--out-dir", str(wd),
             "--title", f"Weave Action-Ledger WIDE — {args.run_date}",
             "--tokens", str(state.tokens_total)],
            capture_output=True, text=True,
        )

        retro_path = Path(args.retro_out)
        retro_path.parent.mkdir(parents=True, exist_ok=True)
        state.set_phase("synthesize", retro_path.name)
        refresh()
        synthesize(wd, retro_path, state)

        if args.eval_out:
            eval_path = Path(args.eval_out)
            eval_path.parent.mkdir(parents=True, exist_ok=True)
            parts = []
            if retro_path.exists():
                parts.append(retro_path.read_text())
            ledger = wd / "ACTION-LEDGER.md"
            if ledger.exists():
                parts.append("\n---\n\n" + ledger.read_text())
            eval_path.write_text("\n".join(parts))

        state.set_phase("done", f"{done_n}/{len(chunks)} miners · {state.findings_total} findings")
        refresh()

    console.print(f"\n[green]✓[/] WIDE weave → {wd}")
    console.print(f"  Retro: {args.retro_out}")
    if args.eval_out:
        console.print(f"  Eval:  {args.eval_out}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("discover")
    d.add_argument("--cutoff", required=True)
    d.add_argument("--workdir", required=True)
    d.add_argument("--centerpiece-repo", default="orchestrator")
    d.add_argument("--sources", default="claude,codex", help="comma: claude,codex,cursor")

    r = sub.add_parser("run")
    r.add_argument("--cutoff", required=True)
    r.add_argument("--workdir", required=True)
    r.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY,
                     help=f"miners in flight ({MIN_CONCURRENCY}-{MAX_CONCURRENCY})")
    r.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK_SIZE,
                     help="sessions per miner (1=wide/deep)")
    r.add_argument("--sources", default="claude,codex")
    r.add_argument("--centerpiece-repo", default="orchestrator")
    r.add_argument("--prior-weave", default="gen-16 @ skill-creator/docs.local/weave-2026-06-14-retro/")
    r.add_argument("--run-date", default=datetime.now().strftime("%Y-%m-%d"))
    r.add_argument("--fresh", action="store_true", help="wipe findings/mine-context before run")
    private_root = Path(os.environ.get("WEAVE_PRIVATE_ROOT", Path.home() / ".local/share/golems/weave"))
    r.add_argument("--retro-out", default=str(private_root / "retros/2026-06-18-gen17-wide.md"))
    r.add_argument("--eval-out", default=str(private_root / "evals/weave-2026-06-18-wide.md"))

    args = p.parse_args()
    if args.cmd == "discover":
        return cmd_discover(args)
    if args.cmd == "run":
        return cmd_run(args)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
