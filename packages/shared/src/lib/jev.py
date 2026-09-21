"""Shadow-by-default TypeSafe Jev client. Contract version: 1."""

from __future__ import annotations

import hashlib
import json
import math
import os
import queue
import random
import re
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.request import Request, urlopen

PRICE_PER_INPUT_TOKEN = 0.042 / 1_000_000
MAX_REQUEST_USD = 64_000 * PRICE_PER_INPUT_TOKEN


def jev(
    state: Any,
    questions: list[dict[str, Any]],
    sanitizer: Callable[[Any], Any],
    *,
    site: str,
    state_dir: str | Path | None = None,
    key_file: str | Path | None = None,
    transport: Callable[[dict[str, Any], str], dict[str, Any]] | None = None,
    model: str = "jev-latest",
    timeout_seconds: float = 10,
    lock_wait_seconds: float = 1,
) -> list[dict[str, Any]]:
    return _run_jev(
        state,
        questions,
        sanitizer,
        site=site,
        state_dir=state_dir,
        key_file=key_file,
        transport=transport,
        model=model,
        timeout_seconds=timeout_seconds,
        lock_wait_seconds=lock_wait_seconds,
        return_shadow=False,
    )


def jev_shadow(
    state: Any,
    questions: list[dict[str, Any]],
    sanitizer: Callable[[Any], Any],
    *,
    site: str,
    state_dir: str | Path | None = None,
    key_file: str | Path | None = None,
    transport: Callable[[dict[str, Any], str], dict[str, Any]] | None = None,
    model: str = "jev-latest",
    timeout_seconds: float = 10,
    lock_wait_seconds: float = 1,
) -> list[dict[str, Any]]:
    mode = _site_mode(site)
    if mode != "shadow":
        raise ValueError("jev_shadow requires shadow mode")
    return _run_jev(
        state,
        questions,
        sanitizer,
        site=site,
        state_dir=state_dir,
        key_file=key_file,
        transport=transport,
        model=model,
        timeout_seconds=timeout_seconds,
        lock_wait_seconds=lock_wait_seconds,
        return_shadow=True,
        resolved_mode=mode,
    )


def _run_jev(
    state: Any,
    questions: list[dict[str, Any]],
    sanitizer: Callable[[Any], Any],
    *,
    site: str,
    state_dir: str | Path | None,
    key_file: str | Path | None,
    transport: Callable[[dict[str, Any], str], dict[str, Any]] | None,
    model: str,
    timeout_seconds: float,
    lock_wait_seconds: float,
    return_shadow: bool,
    resolved_mode: str | None = None,
) -> list[dict[str, Any]]:
    _validate_questions(questions)
    fallback = _fallback_answers(questions)
    root = Path(state_dir) if state_dir else Path.home() / ".local/state/jev"
    try:
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
    except OSError:
        return fallback
    try:
        clean = sanitizer(state)
        state_hash = _hash(_canonical_json(clean))
    except Exception:
        state_hash = _hash("sanitizer_error")
        _append_decisions(
            root,
            _decision_rows(
                site, state_hash, questions, fallback, False, "sanitizer_error"
            ),
        )
        return fallback

    mode = resolved_mode or _site_mode(site)
    if mode == "off":
        _append_decisions(
            root,
            _decision_rows(site, state_hash, questions, fallback, False, "disabled"),
        )
        return fallback

    api_key = _load_api_key(key_file)
    if not api_key:
        _append_decisions(
            root,
            _decision_rows(
                site, state_hash, questions, fallback, False, "missing_api_key"
            ),
        )
        return fallback

    lock = root / ".cost.lock"
    lock_token = _acquire_cost_lock_with_retry(
        lock, timeout_seconds + 60, lock_wait_seconds
    )
    if not lock_token:
        _append_decisions(
            root,
            _decision_rows(
                site, state_hash, questions, fallback, False, "cost_lock_busy"
            ),
        )
        return fallback

    reservation_id = uuid.uuid4().hex
    try:
        if _spent_today(root) + MAX_REQUEST_USD > _daily_cap():
            _append_decisions(
                root,
                _decision_rows(
                    site, state_hash, questions, fallback, False, "cap_exceeded"
                ),
            )
            return fallback
        _append_jsonl(
            root / "usage.jsonl",
            [
                {
                    "ts": _now(),
                    "site": site,
                    "model": model,
                    "kind": "reservation",
                    "reservation_id": reservation_id,
                    "reserved_input_tokens": 64_000,
                    "cost_usd": MAX_REQUEST_USD,
                }
            ],
        )
    except Exception:
        _append_decisions(
            root,
            _decision_rows(
                site, state_hash, questions, fallback, False, "usage_log_error"
            ),
        )
        return fallback
    finally:
        _release_cost_lock(lock, lock_token)

    request = _build_request(clean, questions, model)
    try:
        selected_transport = transport or (
            lambda payload, key: _http_transport(payload, key, timeout_seconds)
        )
        response = _run_transport(selected_transport, request, api_key, timeout_seconds)
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException as error:
        _append_decisions(
            root,
            _decision_rows(
                site,
                state_hash,
                questions,
                fallback,
                False,
                _transport_fallback_reason(error),
            ),
        )
        return fallback

    if not isinstance(response, dict) or not isinstance(response.get("answers"), dict):
        _append_decisions(
            root,
            _decision_rows(
                site, state_hash, questions, fallback, False, "response_invalid"
            ),
        )
        return fallback

    usage = response.get("usage")
    if usage is not None and not isinstance(usage, dict):
        _append_decisions(
            root,
            _decision_rows(
                site, state_hash, questions, fallback, False, "response_invalid"
            ),
        )
        return fallback
    input_tokens = (usage or {}).get("input_tokens")
    if input_tokens is not None and (
        not isinstance(input_tokens, int)
        or isinstance(input_tokens, bool)
        or not 0 <= input_tokens <= 64_000
    ):
        _append_decisions(
            root,
            _decision_rows(
                site, state_hash, questions, fallback, False, "usage_out_of_range"
            ),
        )
        return fallback

    try:
        vendor_answers = _parse_answers(questions, response["answers"])
    except Exception:
        _append_decisions(
            root,
            _decision_rows(
                site, state_hash, questions, fallback, False, "response_invalid"
            ),
        )
        return fallback

    input_tokens = 64_000 if input_tokens is None else input_tokens
    reconcile_token = _acquire_cost_lock_with_retry(
        lock, timeout_seconds + 60, lock_wait_seconds
    )
    if reconcile_token:
        try:
            _append_jsonl(
                root / "usage.jsonl",
                [
                    {
                        "ts": _now(),
                        "site": site,
                        "model": response.get("model", "unknown"),
                        "kind": "reconciliation",
                        "reservation_id": reservation_id,
                        "input_tokens": input_tokens,
                        "cost_usd": input_tokens * PRICE_PER_INPUT_TOKEN
                        - MAX_REQUEST_USD,
                    }
                ],
            )
        finally:
            _release_cost_lock(lock, reconcile_token)

    acted = mode == "on"
    if not _append_decisions(
        root,
        _decision_rows(site, state_hash, questions, vendor_answers, acted, None),
    ):
        return fallback
    if acted or return_shadow:
        return [
            {**answer, "acted": acted, "source": "jev"} for answer in vendor_answers
        ]
    return fallback


def vote_most_cautious(
    vote: Callable[[], Any], cautiousness: Callable[[Any], float], n: int = 3
) -> Any:
    if not isinstance(n, int) or n < 1:
        raise ValueError("n must be a positive integer")
    values = [vote() for _ in range(n)]
    return max(values, key=cautiousness)


def _site_mode(site: str) -> str:
    if os.environ.get("CI") or os.environ.get("JEV_ENABLED") == "0":
        return "off"
    key = "JEV_SITE_" + re.sub(r"[^A-Z0-9]", "_", site.upper())
    value = os.environ.get(key, "shadow")
    return value if value in {"off", "shadow", "on"} else "shadow"


def _daily_cap() -> float:
    try:
        value = float(os.environ.get("JEV_DAILY_USD_CAP", "5"))
        return value if math.isfinite(value) and value > 0 else 0
    except ValueError:
        return 0


def _spent_today(root: Path) -> float:
    path = root / "usage.jsonl"
    if not path.exists():
        return 0
    try:
        date = _now()[:10]
        total = 0.0
        for row in map(json.loads, filter(None, path.read_text().splitlines())):
            if not isinstance(row.get("ts"), str) or not _number(row.get("cost_usd")):
                raise ValueError("Invalid usage row")
            if row["ts"].startswith(date):
                total += row["cost_usd"]
        return total
    except Exception:
        return float("inf")


def _load_api_key(key_file: str | Path | None) -> str | None:
    env_key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if env_key:
        return env_key
    path = Path(key_file) if key_file else Path.home() / ".config/typesafe/api-key"
    try:
        return path.read_text().strip() or None
    except OSError:
        return None


def _http_transport(
    payload: dict[str, Any], api_key: str, timeout_seconds: float
) -> dict[str, Any]:
    request = Request(
        "https://api.typesafe.ai/v1/systemone",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    with urlopen(request, timeout=timeout_seconds) as response:
        return json.load(response)


def _run_transport(transport, payload, api_key, timeout_seconds):
    result: queue.Queue[tuple[bool, Any]] = queue.Queue(maxsize=1)

    def run() -> None:
        try:
            result.put((True, transport(payload, api_key)))
        except BaseException as error:
            result.put((False, error))

    threading.Thread(target=run, daemon=True, name="jev-transport").start()
    try:
        succeeded, value = result.get(timeout=timeout_seconds)
    except queue.Empty as error:
        raise TimeoutError("Jev request timed out") from error
    if not succeeded:
        raise value
    return value


def _build_request(
    state: Any, questions: list[dict[str, Any]], model: str
) -> dict[str, Any]:
    mapped = {}
    for question in questions:
        mapped[question["id"]] = {
            key: value
            for key, value in question.items()
            if key not in {"id", "fallback_answer"}
        }
    return {"state": state, "model": model, "questions": mapped}


def _parse_answers(
    questions: list[dict[str, Any]], answers: dict[str, Any]
) -> list[dict[str, Any]]:
    parsed = []
    for question in questions:
        raw = answers.get(question["id"])
        if not isinstance(raw, dict) or raw.get("type") != question["type"]:
            raise ValueError("Invalid Jev response")
        if question["type"] == "noul" and _probability(raw.get("noul")):
            parsed.append(_answer(question, raw["noul"], None))
        elif (
            question["type"] == "choice"
            and raw.get("choice") in question["criteria"]
            and _probability(raw.get("confidence"))
        ):
            parsed.append(
                _answer(
                    question,
                    raw["choice"],
                    raw["confidence"],
                    _probabilities(
                        raw.get("probabilities"), list(question["criteria"])
                    ),
                )
            )
        elif (
            question["type"] == "score"
            and _number(raw.get("score"))
            and 0 <= raw["score"] <= len(question["criteria"]) - 1
            and _probability(raw.get("confidence"))
        ):
            parsed.append(
                _answer(
                    question,
                    raw["score"],
                    raw["confidence"],
                    _probabilities(
                        raw.get("probabilities"),
                        [str(index) for index in range(len(question["criteria"]))],
                    ),
                )
            )
        else:
            raise ValueError("Invalid Jev response")
    return parsed


def _answer(
    question: dict[str, Any], value: Any, confidence: float | None, probabilities=None
) -> dict[str, Any]:
    return {
        "question_id": question["id"],
        "type": question["type"],
        "answer": value,
        "confidence": confidence,
        "probabilities": probabilities,
        "fallback_answer": question["fallback_answer"],
        "acted": False,
        "source": "jev",
    }


def _fallback_answers(questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {**_answer(question, question["fallback_answer"], None), "source": "fallback"}
        for question in questions
    ]


def _validate_questions(questions: list[dict[str, Any]]) -> None:
    if not questions or any(not isinstance(question, dict) for question in questions):
        raise ValueError("Questions need unique ids")
    ids = [question.get("id") for question in questions]
    if not ids or any(not value for value in ids) or len(set(ids)) != len(ids):
        raise ValueError("Questions need unique ids")
    for question in questions:
        question_type = question.get("type")
        if question_type not in {"noul", "choice", "score"}:
            raise ValueError("Invalid question type")
        if "instructions" not in question or "fallback_answer" not in question:
            raise ValueError("Incomplete question")
        if question_type == "noul" and not _probability(question["fallback_answer"]):
            raise ValueError("Invalid noul fallback")
        if question_type == "choice" and (
            not isinstance(question.get("criteria"), dict)
            or question["fallback_answer"] not in question["criteria"]
        ):
            raise ValueError("Invalid choice fallback")
        if question_type == "score" and (
            not isinstance(question.get("criteria"), list)
            or not 2 <= len(question["criteria"]) <= 10
            or not _number(question["fallback_answer"])
            or not 0 <= question["fallback_answer"] <= len(question["criteria"]) - 1
        ):
            raise ValueError("Invalid score criteria or fallback")


def _decision_rows(site, state_hash, questions, values, acted, fallback_reason):
    ts = _now()
    return [
        {
            "ts": ts,
            "site": site,
            "state_hash": state_hash,
            "question_id": question["id"],
            "answer": values[index]["answer"],
            "confidence": values[index]["confidence"],
            "fallback_answer": question["fallback_answer"],
            "acted": acted,
            "fallback_reason": fallback_reason,
        }
        for index, question in enumerate(questions)
    ]


def _append_decisions(root: Path, rows: list[dict[str, Any]]) -> bool:
    try:
        _append_jsonl(root / "decisions.jsonl", rows)
        return True
    except Exception:
        return False


def _append_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    payload = "".join(
        json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
        for row in rows
    )
    with path.open("a", encoding="utf-8") as handle:
        handle.write(payload)


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _probability(value: Any) -> bool:
    return _number(value) and 0 <= value <= 1


def _number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _probabilities(value: Any, expected_keys: list[str]) -> dict[str, float]:
    if (
        not isinstance(value, dict)
        or set(value) != set(expected_keys)
        or any(not _probability(item) for item in value.values())
    ):
        raise ValueError("Invalid probabilities")
    return value


def _acquire_cost_lock(lock: Path, lease_seconds: float) -> str | None:
    token = uuid.uuid4().hex
    owner = {"token": token, "pid": os.getpid(), "created_ms": int(time.time() * 1000)}
    try:
        _create_cost_lock(lock, owner)
        return token
    except FileExistsError:
        pass
    except OSError:
        return None

    try:
        existing = json.loads((lock / "owner.json").read_text(encoding="utf-8"))
        age_seconds = (int(time.time() * 1000) - existing["created_ms"]) / 1000
        if age_seconds <= lease_seconds or _process_alive(existing["pid"]):
            return None
        if json.loads((lock / "owner.json").read_text(encoding="utf-8")).get(
            "token"
        ) != existing.get("token"):
            return None
        shutil.rmtree(lock)
        _create_cost_lock(lock, owner)
        return token
    except Exception:
        return None


def _acquire_cost_lock_with_retry(
    lock: Path, lease_seconds: float, wait_seconds: float
) -> str | None:
    deadline = time.monotonic() + max(0, wait_seconds)
    while True:
        token = _acquire_cost_lock(lock, lease_seconds)
        if token:
            return token
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        time.sleep(min(remaining, random.uniform(0.005, 0.02)))


def _create_cost_lock(lock: Path, owner: dict[str, Any]) -> None:
    lock.mkdir()
    try:
        (lock / "owner.json").write_text(json.dumps(owner), encoding="utf-8")
    except Exception:
        shutil.rmtree(lock, ignore_errors=True)
        raise


def _release_cost_lock(lock: Path, token: str) -> None:
    try:
        owner = json.loads((lock / "owner.json").read_text(encoding="utf-8"))
        if owner.get("token") == token:
            shutil.rmtree(lock)
    except Exception:
        pass


def _process_alive(pid: Any) -> bool:
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except (PermissionError, OSError):
        return True


def _transport_fallback_reason(error: BaseException) -> str:
    status = getattr(error, "code", None)
    if isinstance(status, int) and 100 <= status <= 599:
        return f"http_error_{status}"
    if isinstance(error, TimeoutError):
        return "transport_timeout"
    error_class = "".join(
        char if char.isalnum() or char in "_-" else "_" for char in type(error).__name__
    )[:64]
    return f"transport_error_{error_class or 'unknown'}"
