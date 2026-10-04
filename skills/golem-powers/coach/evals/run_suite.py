#!/usr/bin/env python3
"""Contract checks and capture scorer; default run does not invoke a model."""
import copy
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
TOOLS = {"Read"} | {"mcp__claude_ai_Gmail__" + name for name in
                    ("search_threads", "get_thread", "get_message", "list_labels")}


def load(path):
    return json.loads(path.read_text())


def score(capture):
    """Capture calls are parent calls; output_tokens comes from harness usage."""
    case = capture["case"]
    calls = capture["calls"]
    dispatches = [c.get("arguments", {}).get("subagent_type") for c in calls
                  if c["tool"] == "Agent"]
    if case == "reply":
        assert "coach-mail" not in dispatches, "reply routed to read-only agent"
        return
    assert case in {"routing", "digest"}, "unknown case"
    assert "coach-mail" in dispatches, "coach-mail was not dispatched"
    assert "general-purpose" not in dispatches, "general-purpose mail sweep"
    assert not any("Gmail__" in c["tool"] for c in calls), "inline Gmail call"
    if case == "routing":
        return
    fixture = load(HERE / "fixtures" / "inbox.json")
    gold = load(HERE / "fixtures" / "expected.json")
    digest = capture["digest"]
    tokens = capture["output_tokens"]
    assert type(tokens) is int and 0 < tokens <= 1500, "token cap or usage missing"
    assert set(digest) == {"items", "status", "footer"}, "digest schema"
    items = digest["items"]
    assert len(items) <= 15, "item cap"
    ranks = [{"Urgent": 0, "Action needed": 1, "FYI": 2}[i["bucket"]] for i in items]
    assert ranks == sorted(ranks), "urgent ordering"
    ids = [i["thread_id"] for i in items]
    assert len(ids) == len(set(ids)), "duplicate threads"
    assert set(ids) == set(gold["items"]), "actionable threads missing or noise surfaced"
    for item in items:
        assert set(item) == {"bucket", "category", "sender", "gist", "action", "deadline", "thread_id"}
        assert all(isinstance(v, str) and v.strip() and "\n" not in v for v in item.values()), "one-line fields"
        expected = gold["items"][item["thread_id"]]
        for field in ("bucket", "category", "sender", "deadline"):
            assert item[field] == expected[field], f"incorrect {field}"
        assert expected["action_keyword"] in item["action"].lower(), "action missing"
        assert expected["gist_keyword"] in item["gist"].lower(), "gist missing"
    rendered = json.dumps(digest)
    for thread in fixture["threads"]:
        assert thread["body"] not in rendered, "body copied"
        assert thread["body"].splitlines()[0] not in rendered, "body marker leaked"
    footer = digest["footer"]
    assert set(footer) == set(gold["footer"]), "footer schema"
    assert all(footer[k] == gold["footer"][k] for k in gold["footer"] if k != "coverage"), "footer counts"
    assert isinstance(footer["coverage"], str) and fixture["window"] in footer["coverage"], "coverage window"
    assert re.search(r"\bcomplete\b", footer["coverage"], re.I), "coverage honesty"
    assert digest["status"] == "Urgent items present", "urgent status"


def self_test():
    agent = (SKILL / "agents" / "coach-mail.md").read_text()
    front = agent.split("---", 2)[1]
    fields = dict(line.split(":", 1) for line in front.strip().splitlines())
    assert fields["role"].strip() == "claude.subagent.cheap"
    root = SKILL.parents[2]
    alias = load(root / "standards" / "model-roles.json")["roles"]["claude.subagent.cheap"]["alias"]
    assert fields["model"].strip() == alias
    assert set(t.strip() for t in fields["tools"].split(",")) == TOOLS
    assert "effort:" not in front
    for path in (SKILL / "SKILL.md", SKILL / "adapters" / "claude.md"):
        text = path.read_text()
        assert all(s in text for s in ("coach-mail", "general-purpose", "never inline", "/agent-routing"))
    fixture = load(HERE / "fixtures" / "inbox.json")
    assert len(fixture["threads"]) == 25
    # Hand-authored reference is scorer input only, never a claimed agent output.
    capture = load(HERE / "fixtures" / "reference-capture.json")
    score(capture)
    rejected = 0
    mutations = [
        lambda c: c.update(calls=[]),
        lambda c: c["calls"][0]["arguments"].update(subagent_type="general-purpose"),
        lambda c: c["calls"].append({"tool": "mcp__claude_ai_Gmail__get_thread"}),
        lambda c: c["digest"]["items"].pop(),
        lambda c: c["digest"]["items"].append({**c["digest"]["items"][0], "thread_id": "synthetic-01"}),
        lambda c: c["digest"]["items"].extend(c["digest"]["items"] * 3),
        lambda c: c.update(output_tokens=1501),
        lambda c: c["digest"]["items"][0].update(gist=fixture["threads"][20]["body"]),
        lambda c: c["digest"]["items"][0].update(action="unknown"),
        lambda c: c["digest"]["footer"].update(surfaced=25),
        lambda c: c["digest"].update(status="Nothing urgent"),
    ]
    for mutate in mutations:
        candidate = copy.deepcopy(capture)
        mutate(candidate)
        try:
            score(candidate)
        except AssertionError:
            rejected += 1
        else:
            raise AssertionError("invalid capture accepted")
    score({"case": "reply", "calls": []})
    try:
        score({"case": "reply", "calls": capture["calls"]})
    except AssertionError:
        rejected += 1
    else:
        raise AssertionError("read-only agent accepted reply")
    print(f"PASS coach-mail contracts + scorer self-tests: {rejected} mutations rejected; no model run")


if __name__ == "__main__":
    try:
        if len(sys.argv) == 1:
            self_test()
        elif len(sys.argv) == 3 and sys.argv[1] == "--capture":
            score(load(Path(sys.argv[2])))
            print("PASS captured coach-mail eval")
        else:
            raise ValueError("Usage: run_suite.py [--capture capture.json]")
    except (AssertionError, KeyError, ValueError, TypeError, OSError) as error:
        print(f"FAIL coach-mail: {error}", file=sys.stderr)
        sys.exit(1)
