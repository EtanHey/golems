import importlib.util
import json
import os
import ssl
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

MODULE_PATH = Path(__file__).parents[1] / "lib" / "jev.py"
SPEC = importlib.util.spec_from_file_location("jev_client", MODULE_PATH)
jev_client = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(jev_client)


class JevTest(unittest.TestCase):
    def setUp(self):
        repo_root = Path(__file__).parents[4]
        temp_root = repo_root / "docs.local"
        temp_root.mkdir(parents=True, exist_ok=True)
        self.tempdir = tempfile.TemporaryDirectory(dir=temp_root)
        self.old_env = os.environ.copy()
        os.environ["TYPESAFE_API_KEY"] = "secret-test-key"
        for name in ("CI", "JEV_ENABLED", "JEV_SITE_GATE", "JEV_DAILY_USD_CAP"):
            os.environ.pop(name, None)
        self.questions = [
            {
                "id": "urgent",
                "type": "noul",
                "instructions": "Is this urgent?",
                "fallback_answer": 0,
            }
        ]

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old_env)
        self.tempdir.cleanup()

    @staticmethod
    def response(value=0.91):
        return {
            "model": "jev-1.13.0",
            "answers": {"urgent": {"type": "noul", "noul": value}},
            "usage": {"input_tokens": 100, "output_tokens": 10},
        }

    def test_shadow_sanitizes_and_logs_no_raw_state(self):
        sent = {}

        def transport(payload, _key):
            sent.update(payload)
            return self.response()

        result = jev_client.jev(
            {"message": "private text", "token": "remove-me"},
            self.questions,
            lambda state: {"message": state["message"]},
            site="gate",
            state_dir=self.tempdir.name,
            transport=transport,
        )
        self.assertEqual(sent["state"], {"message": "private text"})
        self.assertEqual(result[0]["answer"], 0)
        log = (Path(self.tempdir.name) / "decisions.jsonl").read_text()
        self.assertNotIn("private text", log)
        self.assertNotIn("remove-me", log)
        self.assertEqual(json.loads(log)["answer"], 0.91)

    def test_on_mode_acts(self):
        os.environ["JEV_SITE_GATE"] = "on"
        result = jev_client.jev(
            "state",
            self.questions,
            lambda state: state,
            site="gate",
            state_dir=self.tempdir.name,
            transport=lambda *_: self.response(0.83),
        )
        self.assertEqual(result[0]["answer"], 0.83)
        self.assertTrue(result[0]["acted"])

    def test_explicit_shadow_returns_vendor_answer_without_acting(self):
        result = jev_client.jev_shadow(
            "state",
            self.questions,
            lambda state: state,
            site="gate",
            state_dir=self.tempdir.name,
            transport=lambda *_: self.response(0.84),
        )
        self.assertEqual(result[0]["answer"], 0.84)
        self.assertFalse(result[0]["acted"])
        self.assertEqual(result[0]["source"], "jev")
        decision = json.loads((Path(self.tempdir.name) / "decisions.jsonl").read_text())
        self.assertIsNone(decision["fallback_reason"])

    def test_shadow_refuses_any_non_shadow_effective_mode(self):
        calls = []

        def transport(*_):
            calls.append(True)
            return self.response()

        os.environ["JEV_SITE_GATE"] = "on"
        with self.assertRaisesRegex(ValueError, "requires shadow mode"):
            jev_client.jev_shadow(
                "state",
                self.questions,
                lambda state: state,
                site="gate",
                state_dir=self.tempdir.name,
                transport=transport,
            )
        os.environ["JEV_SITE_GATE"] = "shadow"
        os.environ["JEV_ENABLED"] = "0"
        with self.assertRaisesRegex(ValueError, "requires shadow mode"):
            jev_client.jev_shadow(
                "state",
                self.questions,
                lambda state: state,
                site="gate",
                state_dir=self.tempdir.name,
                transport=transport,
            )
        self.assertEqual(calls, [])

    def test_kill_switch_and_ci_never_call_transport(self):
        calls = []

        def transport(*_):
            calls.append(True)

        os.environ["JEV_ENABLED"] = "0"
        jev_client.jev(
            "state",
            self.questions,
            lambda value: value,
            site="gate",
            state_dir=self.tempdir.name,
            transport=transport,
        )
        os.environ["JEV_ENABLED"] = "1"
        os.environ["CI"] = "1"
        jev_client.jev(
            "state",
            self.questions,
            lambda value: value,
            site="gate",
            state_dir=self.tempdir.name,
            transport=transport,
        )
        self.assertEqual(calls, [])

    def test_non_ascii_site_uses_typescript_compatible_kill_switch_name(self):
        calls = []
        os.environ["JEV_SITE_CAF_"] = "off"
        jev_client.jev(
            "state",
            self.questions,
            lambda value: value,
            site="café",
            state_dir=self.tempdir.name,
            transport=lambda *_: calls.append(True),
        )
        self.assertEqual(calls, [])

    def test_cap_blocks_before_network(self):
        os.environ["JEV_DAILY_USD_CAP"] = "0.001"
        calls = []
        jev_client.jev(
            "state",
            self.questions,
            lambda value: value,
            site="gate",
            state_dir=self.tempdir.name,
            transport=lambda *_: calls.append(True),
        )
        self.assertEqual(calls, [])

    def test_usage_reader_skips_blank_lines_but_fails_closed_on_torn_tail(self):
        usage_path = Path(self.tempdir.name) / "usage.jsonl"
        today = jev_client._now()
        usage_path.write_text(
            json.dumps({"ts": today, "cost_usd": 0.125}) + "\n\n",
            encoding="utf-8",
        )
        self.assertEqual(jev_client._spent_today(Path(self.tempdir.name)), 0.125)

        usage_path.write_text(
            json.dumps({"ts": today, "cost_usd": 0.125}) + '\n{"ts":',
            encoding="utf-8",
        )
        self.assertEqual(jev_client._spent_today(Path(self.tempdir.name)), float("inf"))

    def test_jsonl_batch_is_written_with_one_write_call(self):
        handle = MagicMock()
        context = MagicMock()
        context.__enter__.return_value = handle
        with patch.object(Path, "open", return_value=context):
            jev_client._append_jsonl(
                Path(self.tempdir.name) / "usage.jsonl",
                [{"row": 1}, {"row": 2}],
            )
        handle.write.assert_called_once_with('{"row":1}\n{"row":2}\n')

    def test_reclaims_only_expired_lock_with_dead_owner(self):
        os.environ["JEV_SITE_GATE"] = "on"
        lock = Path(self.tempdir.name) / ".cost.lock"
        lock.mkdir()
        (lock / "owner.json").write_text(
            json.dumps(
                {
                    "token": "stale",
                    "pid": 99_999_999,
                    "created_ms": 0,
                }
            )
        )
        result = jev_client.jev(
            "state",
            self.questions,
            lambda value: value,
            site="gate",
            state_dir=self.tempdir.name,
            transport=lambda *_: self.response(0.72),
            timeout_seconds=5,
        )
        self.assertEqual(result[0]["answer"], 0.72)

    def test_bounds_custom_transport_and_releases_lock(self):
        def transport(*_):
            time.sleep(10)

        started = time.monotonic()
        result = jev_client.jev(
            "state",
            self.questions,
            lambda value: value,
            site="gate",
            state_dir=self.tempdir.name,
            transport=transport,
            timeout_seconds=0.01,
        )
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertEqual(result[0]["answer"], 0)
        usage = json.loads((Path(self.tempdir.name) / "usage.jsonl").read_text())
        self.assertEqual(usage["reserved_input_tokens"], 64_000)
        self.assertEqual(usage["cost_usd"], jev_client.MAX_REQUEST_USD)
        (Path(self.tempdir.name) / ".cost.lock").mkdir()

    def test_concurrent_shadow_calls_all_reach_vendor_under_reserved_cap(self):
        os.environ["JEV_DAILY_USD_CAP"] = str(8 * jev_client.MAX_REQUEST_USD)
        calls = []

        def transport(*_):
            calls.append(True)
            time.sleep(0.01)
            return self.response(0.77)

        def invoke(_):
            return jev_client.jev_shadow(
                "state",
                self.questions,
                lambda state: state,
                site="gate",
                state_dir=self.tempdir.name,
                transport=transport,
            )

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(invoke, range(8)))
        self.assertEqual(len(calls), 8)
        self.assertTrue(
            all(
                result[0]["answer"] == 0.77
                and not result[0]["acted"]
                and result[0]["source"] == "jev"
                for result in results
            )
        )
        usage = [
            json.loads(line)
            for line in (Path(self.tempdir.name) / "usage.jsonl")
            .read_text()
            .splitlines()
        ]
        self.assertAlmostEqual(
            sum(row["cost_usd"] for row in usage),
            8 * 100 * jev_client.PRICE_PER_INPUT_TOKEN,
        )

    def test_concurrent_reservations_never_exceed_hard_cap(self):
        os.environ["JEV_DAILY_USD_CAP"] = str(2 * jev_client.MAX_REQUEST_USD)
        release = threading.Event()
        calls = []

        def transport(*_):
            calls.append(True)
            release.wait(1)
            return self.response(0.77)

        def invoke(_):
            return jev_client.jev_shadow(
                "state",
                self.questions,
                lambda state: state,
                site="gate",
                state_dir=self.tempdir.name,
                transport=transport,
            )

        with ThreadPoolExecutor(max_workers=8) as pool:
            pending = [pool.submit(invoke, index) for index in range(8)]
            deadline = time.monotonic() + 1
            while len(calls) < 2 and time.monotonic() < deadline:
                time.sleep(0.005)
            self.assertEqual(len(calls), 2)
            time.sleep(0.03)
            self.assertEqual(len(calls), 2)
            release.set()
            results = [future.result() for future in pending]
        self.assertEqual(sum(result[0]["source"] == "jev" for result in results), 2)
        self.assertEqual(
            sum(result[0]["source"] == "fallback" for result in results), 6
        )

    def test_lock_contention_fallback_has_reason(self):
        lock = Path(self.tempdir.name) / ".cost.lock"
        lock.mkdir()
        (lock / "owner.json").write_text(
            json.dumps(
                {"token": "busy", "pid": os.getpid(), "created_ms": time.time() * 1000}
            )
        )
        result = jev_client.jev(
            "state",
            self.questions,
            lambda state: state,
            site="gate",
            state_dir=self.tempdir.name,
            transport=lambda *_: self.response(),
            lock_wait_seconds=0.005,
        )
        self.assertEqual(result[0]["source"], "fallback")
        decision = json.loads((Path(self.tempdir.name) / "decisions.jsonl").read_text())
        self.assertEqual(decision["fallback_reason"], "cost_lock_busy")

    def test_loads_key_file_without_exposing_it_when_transport_raises(self):
        os.environ.pop("TYPESAFE_API_KEY")
        key_file = Path(self.tempdir.name) / "api-key"
        key_file.write_text("file-secret-key\n")

        def transport(_payload, key):
            raise RuntimeError(f"failed {key}")

        jev_client.jev(
            "state",
            self.questions,
            lambda value: value,
            site="gate",
            state_dir=self.tempdir.name,
            key_file=key_file,
            transport=transport,
        )
        log = (Path(self.tempdir.name) / "decisions.jsonl").read_text()
        self.assertNotIn("file-secret-key", log)

    def test_passes_caller_owned_choice_options_unchanged(self):
        os.environ["JEV_SITE_GATE"] = "on"
        criteria = {"allow": "Safe to proceed", "review": "Needs a human"}
        question = [
            {
                "id": "route",
                "type": "choice",
                "instructions": "Choose",
                "criteria": criteria,
                "fallback_answer": "review",
            }
        ]
        sent = {}

        def transport(payload, _key):
            sent.update(payload)
            return {
                "model": "jev-1.13.0",
                "answers": {
                    "route": {
                        "type": "choice",
                        "choice": "allow",
                        "confidence": 0.8,
                        "probabilities": {"allow": 0.9, "review": 0.1},
                    }
                },
                "usage": {"input_tokens": 100, "output_tokens": 10},
            }

        result = jev_client.jev(
            "state",
            question,
            lambda value: value,
            site="gate",
            state_dir=self.tempdir.name,
            transport=transport,
        )
        self.assertEqual(sent["questions"]["route"]["criteria"], criteria)
        self.assertEqual(result[0]["answer"], "allow")

    def test_rejects_out_of_range_usage_and_keeps_ceiling_reservation(self):
        os.environ["JEV_SITE_GATE"] = "on"
        response = self.response(0.99)
        response["usage"]["input_tokens"] = 10_000_000
        result = jev_client.jev(
            "state",
            self.questions,
            lambda state: state,
            site="gate",
            state_dir=self.tempdir.name,
            transport=lambda *_: response,
        )
        self.assertEqual(result[0]["source"], "fallback")
        decision = json.loads((Path(self.tempdir.name) / "decisions.jsonl").read_text())
        self.assertEqual(decision["fallback_reason"], "usage_out_of_range")
        usage = [
            json.loads(line)
            for line in (Path(self.tempdir.name) / "usage.jsonl")
            .read_text()
            .splitlines()
        ]
        self.assertAlmostEqual(
            sum(row["cost_usd"] for row in usage), jev_client.MAX_REQUEST_USD
        )

    def test_http_failure_logs_status_only(self):
        def transport(*_):
            raise HTTPError(
                "https://api.typesafe.ai/v1/systemone",
                429,
                "secret vendor message",
                None,
                None,
            )

        jev_client.jev(
            "state",
            self.questions,
            lambda state: state,
            site="gate",
            state_dir=self.tempdir.name,
            transport=transport,
        )
        log = (Path(self.tempdir.name) / "decisions.jsonl").read_text()
        self.assertEqual(json.loads(log)["fallback_reason"], "http_error_429")
        self.assertNotIn("secret vendor message", log)

    def test_default_transport_uses_verified_certifi_context(self):
        import certifi

        response = MagicMock()
        response.__enter__.return_value = MagicMock()
        create_default_context = ssl.create_default_context
        with (
            patch.object(jev_client, "urlopen", return_value=response) as urlopen,
            patch.object(jev_client.json, "load", return_value=self.response()),
            patch.object(
                jev_client.ssl,
                "create_default_context",
                wraps=create_default_context,
            ) as create_context,
        ):
            jev_client._http_transport({}, "secret-test-key", 3)

        create_context.assert_called_once_with(cafile=certifi.where())
        context = urlopen.call_args.kwargs["context"]
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_missing_certifi_certificate_failure_has_specific_reason_and_message(self):
        observed = {}
        original_reason = jev_client._transport_fallback_reason

        def capture_reason(error):
            observed["error"] = error
            return original_reason(error)

        certificate_error = ssl.SSLCertVerificationError(
            1, "certificate verify failed: unable to get local issuer certificate"
        )
        with (
            patch.dict(sys.modules, {"certifi": None}),
            patch.object(
                jev_client, "urlopen", side_effect=URLError(certificate_error)
            ),
            patch.object(
                jev_client, "_transport_fallback_reason", side_effect=capture_reason
            ),
        ):
            result = jev_client.jev(
                "state",
                self.questions,
                lambda state: state,
                site="gate",
                state_dir=self.tempdir.name,
            )

        self.assertEqual(result[0]["source"], "fallback")
        decision = json.loads((Path(self.tempdir.name) / "decisions.jsonl").read_text())
        self.assertEqual(decision["fallback_reason"], "transport_error_tls_ca_missing")
        self.assertRegex(str(observed["error"]), r"install certifi")

    def test_injected_transport_bypasses_default_transport_unchanged(self):
        calls = []

        def transport(payload, key):
            calls.append((payload, key))
            return self.response(0.82)

        with patch.object(jev_client, "urlopen") as urlopen:
            result = jev_client.jev_shadow(
                "state",
                self.questions,
                lambda state: state,
                site="gate",
                state_dir=self.tempdir.name,
                transport=transport,
            )

        urlopen.assert_not_called()
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1], "secret-test-key")
        self.assertEqual(result[0]["answer"], 0.82)

    def test_transport_does_not_swallow_process_interrupts(self):
        for interrupt in (KeyboardInterrupt, SystemExit):
            with self.subTest(interrupt=interrupt.__name__):
                with self.assertRaises(interrupt):
                    jev_client.jev(
                        "state",
                        self.questions,
                        lambda state: state,
                        site="gate",
                        state_dir=self.tempdir.name,
                        transport=lambda *_args, interrupt=interrupt: (
                            _ for _ in ()
                        ).throw(interrupt()),
                    )

    def test_on_mode_falls_back_if_decision_cannot_be_recorded(self):
        os.environ["JEV_SITE_GATE"] = "on"
        with patch.object(jev_client, "_append_decisions", return_value=False):
            result = jev_client.jev(
                "state",
                self.questions,
                lambda value: value,
                site="gate",
                state_dir=self.tempdir.name,
                transport=lambda *_: self.response(0.83),
            )
        self.assertEqual(result[0]["answer"], 0)
        self.assertFalse(result[0]["acted"])

    def test_vote_most_cautious(self):
        votes = iter([1, 3, 2])
        self.assertEqual(
            jev_client.vote_most_cautious(lambda: next(votes), lambda value: value), 3
        )


if __name__ == "__main__":
    unittest.main()
