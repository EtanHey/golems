"""Synthetic current/historical communication compatibility; no real sessions."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("session_miner", Path(__file__).parents[1] / "scripts/session-miner.py")
miner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(miner)


def test_current_send_to_and_historical_send_input_survive():
    calls = [
        (1, "2026-01-01T00:00:00Z", "mcp__cmuxlayer__send_to", {"mode": "agent", "agent_id": "worker-fixture", "text": "current"}, "a"),
        (2, "2026-01-01T00:00:01Z", "mcp__cmuxlayer__send_to", {"mode": "surface", "surface": "surface:fixture", "text": "surface"}, "b"),
        (3, "2026-01-01T00:00:02Z", "mcp__cmuxlayer__send_input", {"surface": "surface:old", "input": "historical"}, "c"),
    ]
    comms = miner.collect_agent_comms(calls, {})
    assert comms["worker-fixture"][0][3] == "current"
    assert comms["surface:fixture"][0][3] == "surface"
    assert comms["surface:old"][0][3] == "historical"
    timeline = miner.build_dispatches(calls)
    assert [row[2] for row in timeline] == ["send_to", "send_to", "send_input"]


def test_key_is_not_a_message_and_command_is_distinguished():
    calls = [
        (1, "2026-01-01T00:00:00Z", "mcp__cmuxlayer__send_to", {"mode": "key", "surface": "surface:fixture", "text": "escape"}, "a"),
        (2, "2026-01-01T00:00:01Z", "mcp__cmuxlayer__send_to", {"mode": "command", "surface": "surface:fixture", "text": "echo fixture"}, "b"),
    ]
    comms = miner.collect_agent_comms(calls, {})
    assert len(comms["surface:fixture"]) == 1
    assert comms["surface:fixture"][0][3] == "[COMMAND] echo fixture"
    timeline = miner.build_dispatches(calls)
    assert len(timeline) == 1
    assert timeline[0][2] == "send_to(command)"
