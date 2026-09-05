from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SKILL_DIR = Path(__file__).resolve().parents[2]
RUNNER_PATH = SKILL_DIR / "scripts" / "convention_audit.py"
LIVE_EVAL_PATH = SKILL_DIR / "evals" / "run_live_eval.py"
FIXTURES = SKILL_DIR / "evals" / "fixtures"
EXPECTED = SKILL_DIR / "evals" / "expected"


def load_runner():
    if not RUNNER_PATH.exists():
        return None
    spec = importlib.util.spec_from_file_location("convention_audit", RUNNER_PATH)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_live_eval():
    if not LIVE_EVAL_PATH.exists():
        return None
    spec = importlib.util.spec_from_file_location("run_live_eval", LIVE_EVAL_PATH)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class KnownAnswerEvalTest(unittest.TestCase):
    def test_fixture_repositories_contain_no_answer_keys(self) -> None:
        self.assertEqual(list(FIXTURES.rglob("worker-output.json")), [])

    def test_local_detector_finds_the_known_sqlite_window_divergence(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        sites = {
            "src/brainlayer/session_repo.py": (
                62,
                "where.append(f\"created_at > datetime('now', '-{int(since_hours)} hours')\")",
            ),
            "scripts/enrich_recent.py": (
                77,
                "WHERE created_at > datetime('now', '-7 days')",
            ),
            "src/brainlayer/search_repo.py": (
                2264,
                "WHERE datetime(created_at) >= datetime('now', '-7 days')",
            ),
            "src/brainlayer/mcp/enrich_handler.py": (
                107,
                "WHERE datetime(enriched_at) > datetime('now', '-24 hours')",
            ),
            "src/brainlayer/eval/enrichment_quality_benchmark.py": (
                127,
                "OR datetime(created_at) >= datetime('now', ?)",
            ),
            "src/brainlayer/p0_longitudinal_count.py": (
                25,
                "WHERE datetime(created_at) > datetime(?)",
            ),
        }
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            for relative, (line, source) in sites.items():
                path = repo / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("\n" * (line - 1) + source + "\n", encoding="utf-8")

            payload = runner.detect_sqlite_recent_window_candidates(repo)

        self.assertEqual(payload["worker"], "static-sqlite-recent-window-detector")
        self.assertEqual(len(payload["findings"]), 1)
        finding = payload["findings"][0]
        self.assertEqual(
            {(site["path"], site["line"]) for site in finding["implementation_sites"]},
            {(path, line) for path, (line, _) in sites.items()},
        )
        self.assertEqual(
            {(site["path"], site["line"]) for site in finding["divergent_sites"]},
            {
                ("src/brainlayer/session_repo.py", 62),
                ("scripts/enrich_recent.py", 77),
            },
        )

    def test_local_detector_returns_no_candidates_for_dynamic_shared_helper_fixture(
        self,
    ) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")

        payload = runner.detect_sqlite_recent_window_candidates(
            FIXTURES / "shared-helper-control"
        )

        self.assertEqual(payload["findings"], [])

    def test_expected_known_answer_aggregates_six_sites_and_two_divergences(
        self,
    ) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        payload = json.loads((EXPECTED / "known-answer.json").read_text())

        report = runner.aggregate_worker_payloads(
            [payload], repo="brainlayer", revision="c99fabb7"
        )

        self.assertEqual(report["findings"][0]["site_count"], 6)
        self.assertEqual(
            {
                (site["path"], site["line"])
                for site in report["findings"][0]["divergent_sites"]
            },
            {
                ("src/brainlayer/session_repo.py", 62),
                ("scripts/enrich_recent.py", 77),
            },
        )
        self.assertTrue(
            {
                ("src/brainlayer/search_repo.py", 2264),
                ("src/brainlayer/mcp/enrich_handler.py", 107),
                ("src/brainlayer/eval/enrichment_quality_benchmark.py", 127),
                ("src/brainlayer/p0_longitudinal_count.py", 25),
            }.isdisjoint(
                {
                    (site["path"], site["line"])
                    for site in report["findings"][0]["divergent_sites"]
                }
            )
        )

    def test_shared_helper_control_has_no_findings(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        payload = json.loads((EXPECTED / "shared-helper-control.json").read_text())

        report = runner.aggregate_worker_payloads(
            [payload], repo="control", revision="fixture"
        )

        self.assertEqual(report["findings"], [])


class RunnerContractTest(unittest.TestCase):
    def test_real_finding_zero_mismatch_reaches_strict_synthesis(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / "repo"
            repo.mkdir()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (repo / "example.py").write_text("VALUE = 1\n", encoding="utf-8")
            fake_codex = root / "fake-codex"
            fake_codex.write_text(
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import json
                    import re
                    import sys
                    from pathlib import Path

                    prompt = sys.stdin.read()
                    output_path = Path(sys.argv[sys.argv.index("-o") + 1])
                    match = re.search(r'Set worker to ("[^"]+")', prompt)
                    worker = json.loads(match.group(1)) if match else "synthesis"
                    mismatch = {
                        "concept": "Watcher chunk persistence",
                        "implementation_sites": [
                            {"path": "src/brainlayer/watcher_bridge.py", "line": 537, "summary": "direct writer"},
                            {"path": "src/brainlayer/drain.py", "line": 799, "summary": "queued writer"},
                        ],
                        "divergent_sites": [
                            {"path": "src/brainlayer/watcher_bridge.py", "line": 561, "reason": "does not merge offsets"},
                        ],
                        "shared_helper_shape": "one persistence owner",
                        "confidence": "high",
                    }
                    if "--json" not in sys.argv:
                        payload = {"worker": "synthesis", "findings": []}
                    elif worker == "lifecycle-control":
                        payload = {"worker": worker, "findings": [mismatch]}
                    elif worker == "synthesis":
                        if "Watcher chunk persistence" not in prompt:
                            print("raw mismatch never reached synthesis", file=sys.stderr)
                            raise SystemExit(9)
                        payload = {"worker": "synthesis", "findings": []}
                    else:
                        payload = {"worker": worker, "findings": []}
                    output_path.write_text(json.dumps(payload))
                    print("model: gpt-5.6-luna")
                    print("reasoning effort: max")
                    if "--json" in sys.argv:
                        print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 3, "output_tokens": 2}}))
                    """
                ),
                encoding="utf-8",
            )
            fake_codex.chmod(0o755)
            output_dir = root / "reports"

            completed = subprocess.run(
                [
                    "bash",
                    str(SKILL_DIR / "scripts" / "run.sh"),
                    "--repo",
                    str(repo),
                    "--output-dir",
                    str(output_dir),
                    "--codex-binary",
                    str(fake_codex),
                    "--concurrency",
                    "2",
                ],
                capture_output=True,
                text=True,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            run_dir = next(output_dir.iterdir())
            self.assertTrue((run_dir / "synthesis.last.json").is_file())
            self.assertEqual(
                json.loads((run_dir / "report.json").read_text())["findings"], []
            )

    def test_failed_analysis_writes_a_durable_partial_run_log(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / "repo"
            repo.mkdir()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (repo / "example.py").write_text("VALUE = 1\n", encoding="utf-8")
            fake_codex = root / "fake-codex"
            fake_codex.write_text(
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import json
                    import re
                    import sys
                    from pathlib import Path

                    prompt = sys.stdin.read()
                    output_path = Path(sys.argv[sys.argv.index("-o") + 1])
                    match = re.search(r'Set worker to ("[^"]+")', prompt)
                    worker = json.loads(match.group(1)) if match else "synthesis"
                    if "--json" in sys.argv and worker == "data-ownership":
                        print("intentional analysis failure", file=sys.stderr)
                        raise SystemExit(9)
                    output_path.write_text(json.dumps({"worker": worker, "findings": []}))
                    print("model: gpt-5.6-luna")
                    print("reasoning effort: max")
                    if "--json" in sys.argv:
                        print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 3, "output_tokens": 2}}))
                    """
                ),
                encoding="utf-8",
            )
            fake_codex.chmod(0o755)
            output_dir = root / "reports"

            completed = subprocess.run(
                [
                    "bash",
                    str(SKILL_DIR / "scripts" / "run.sh"),
                    "--repo",
                    str(repo),
                    "--output-dir",
                    str(output_dir),
                    "--codex-binary",
                    str(fake_codex),
                    "--concurrency",
                    "2",
                ],
                capture_output=True,
                text=True,
            )

            self.assertNotEqual(completed.returncode, 0)
            run_dir = next(output_dir.iterdir())
            run_log = json.loads((run_dir / "run-log.json").read_text())
            self.assertEqual(run_log["status"], "failed")
            self.assertEqual(run_log["failure"]["stage"], "analysis")
            self.assertIn("worker data-ownership failed", run_log["failure"]["message"])
            self.assertTrue(run_log["target_git_state_unchanged"])
            self.assertGreaterEqual(len(run_log["telemetry"]["workers"]), 1)
            self.assertFalse((run_dir / "report.json").exists())

    def test_run_audit_exercises_fanout_reports_and_immutability_with_a_fake_cli(
        self,
    ) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / "repo"
            repo.mkdir()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (repo / "example.py").write_text("VALUE = 1\n", encoding="utf-8")
            fake_codex = root / "fake-codex"
            fake_codex.write_text(
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import json
                    import re
                    import sys
                    from pathlib import Path

                    prompt = sys.stdin.read()
                    output_path = Path(sys.argv[sys.argv.index("-o") + 1])
                    match = re.search(r'Set worker to ("[^"]+")', prompt)
                    worker = json.loads(match.group(1)) if match else "synthesis"
                    output_path.write_text(json.dumps({"worker": worker, "findings": []}))
                    print("model: gpt-5.6-luna")
                    print("reasoning effort: max")
                    if "--json" in sys.argv:
                        print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 3, "output_tokens": 2}}))
                    """
                ),
                encoding="utf-8",
            )
            fake_codex.chmod(0o755)
            output_dir = root / "reports"
            completed = subprocess.run(
                [
                    "bash",
                    str(SKILL_DIR / "scripts" / "run.sh"),
                    "--repo",
                    str(repo),
                    "--output-dir",
                    str(output_dir),
                    "--codex-binary",
                    str(fake_codex),
                    "--concurrency",
                    "2",
                ],
                capture_output=True,
                text=True,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            run_dir = next(output_dir.iterdir())
            report = json.loads((run_dir / "report.json").read_text())
            run_log = json.loads((run_dir / "run-log.json").read_text())
            self.assertEqual(report["findings"], [])
            self.assertEqual(run_log["status"], "complete")
            self.assertEqual(run_log["stage"], "complete")
            self.assertIs(run_log["pin"]["fallback_used"], False)
            self.assertTrue(run_log["target_git_state_unchanged"])
            self.assertEqual(
                run_log["target_git_state_scope"],
                "tracked and nonignored untracked paths visible to git status",
            )
            self.assertEqual(
                len(run_log["telemetry"]["workers"]), len(runner.LENSES) + 1
            )
            self.assertTrue((run_dir / "report.json").is_file())
            self.assertTrue((run_dir / "run-log.json").is_file())
            self.assertTrue((run_dir / "report.md").is_file())
            self.assertTrue((run_dir / "pin-preflight.log").is_file())
            self.assertEqual(run_log["detector_seed"]["finding_count"], 0)
            self.assertIn(
                "no measured known-answer detection evidence for unseeded lenses",
                (run_dir / "report.md").read_text(),
            )

    def test_eval_and_synthesis_prompts_forbid_external_answer_key_paths(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        live_eval = load_live_eval()
        self.assertIsNotNone(live_eval, "live eval harness is not implemented")

        prompts = (
            runner._worker_prompt("data-ownership", runner.LENSES["data-ownership"]),
            runner._synthesis_prompt([]),
            live_eval._baseline_prompt(),
        )

        for prompt in prompts:
            self.assertIn(
                "Do not inspect paths outside the current working directory", prompt
            )
            self.assertIn("may contain answer keys", prompt)

    def test_git_state_fails_closed_for_a_non_git_directory(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(RuntimeError, "could not read git state"):
                runner._git_state(Path(temporary))

    def test_payload_validation_rejects_orphan_divergent_sites(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        with self.assertRaisesRegex(
            RuntimeError, "divergent sites must also be implementation sites"
        ):
            runner.validate_payload(
                {
                    "worker": "synthesis",
                    "findings": [
                        {
                            "concept": "window",
                            "implementation_sites": [
                                {"path": "a.py", "line": 1, "summary": "normalized"}
                            ],
                            "divergent_sites": [
                                {"path": "b.py", "line": 2, "reason": "raw"}
                            ],
                            "shared_helper_shape": "one helper",
                            "confidence": "high",
                        }
                    ],
                }
            )

    def test_local_detector_ignores_comments_and_third_party_trees(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            files = {
                "src/a.py": "created_at > datetime('now', '-1 day')\n",
                "src/b.py": "datetime(created_at) >= datetime('now', '-1 day')\n",
                "src/comment.py": "# created_at > datetime('now', '-1 day')\n",
                "vendor/dependency.py": "created_at > datetime('now', '-1 day')\n",
                "node_modules/package.py": "created_at > datetime('now', '-1 day')\n",
            }
            for relative, content in files.items():
                path = repo / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")

            payload = runner.detect_sqlite_recent_window_candidates(repo)

        self.assertEqual(
            {
                (site["path"], site["line"])
                for site in payload["findings"][0]["implementation_sites"]
            },
            {("src/a.py", 1), ("src/b.py", 1)},
        )

    def test_local_detector_does_not_claim_divergence_when_every_site_is_raw(
        self,
    ) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            (repo / "a.py").write_text(
                "created_at > datetime('now', '-1 day')\n", encoding="utf-8"
            )
            (repo / "b.py").write_text(
                "updated_at >= datetime('now', '-2 days')\n", encoding="utf-8"
            )

            payload = runner.detect_sqlite_recent_window_candidates(repo)

        self.assertEqual(payload["findings"], [])

    def test_time_worker_prompt_receives_local_detector_evidence(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        detector_payload = {
            "worker": "static-sqlite-recent-window-detector",
            "findings": [
                {
                    "concept": "SQLite recent timestamp-window comparison",
                    "implementation_sites": [
                        {
                            "path": "src/brainlayer/session_repo.py",
                            "line": 62,
                            "summary": "raw comparison",
                        }
                    ],
                    "divergent_sites": [
                        {
                            "path": "src/brainlayer/session_repo.py",
                            "line": 62,
                            "reason": "raw comparison",
                        }
                    ],
                    "shared_helper_shape": "one helper",
                    "confidence": "high",
                }
            ],
        }

        prompt = runner._worker_prompt(
            "time-and-query-semantics",
            runner.LENSES["time-and-query-semantics"],
            detector_payload=detector_payload,
        )

        self.assertIn("static-sqlite-recent-window-detector", prompt)
        self.assertIn("src/brainlayer/session_repo.py", prompt)
        self.assertIn("verify this inventory first", prompt.lower())

    def test_codex_command_pins_luna_and_max_without_aliases(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")

        command = runner.build_codex_command(
            codex_binary="/usr/local/bin/codex",
            repo=Path("/repo"),
            output_schema=Path("/schema.json"),
            effort="max",
        )

        self.assertEqual(command[0:2], ["/usr/local/bin/codex", "exec"])
        self.assertIn("gpt-5.6-luna", command)
        self.assertIn('model_reasoning_effort="max"', command)
        self.assertNotIn("repogolem", " ".join(command).lower())

    def test_effective_pin_parser_rejects_a_silent_downgrade(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        banner = "model: gpt-5.6-luna\nreasoning effort: xhigh\n"

        with self.assertRaisesRegex(RuntimeError, "effective reasoning effort"):
            runner.verify_effective_pin(banner, requested_effort="max")

    def test_usage_parser_sums_output_tokens_and_cost(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        events = [
            {
                "type": "turn.completed",
                "usage": {"input_tokens": 100, "output_tokens": 40, "cost_usd": 0.02},
            },
            {
                "type": "turn.completed",
                "usage": {"input_tokens": 50, "output_tokens": 10, "cost_usd": 0.01},
            },
        ]

        usage = runner.usage_from_events(events)

        self.assertEqual(usage["input_tokens"], 150)
        self.assertEqual(usage["output_tokens"], 50)
        self.assertEqual(usage["cost_usd"], 0.03)

    def test_usage_parser_marks_unrecognized_telemetry_unobserved(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")

        usage = runner.usage_from_events(
            [{"type": "thread.completed", "tokens": {"generated": 50}}]
        )

        self.assertFalse(usage["usage_observed"])
        self.assertIsNone(usage["output_tokens"])

    def test_max_fallback_only_accepts_an_explicit_effort_rejection(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")

        self.assertTrue(
            runner._max_is_unavailable("invalid value 'max' for model_reasoning_effort")
        )
        self.assertFalse(
            runner._max_is_unavailable("network unavailable while requesting max model")
        )

    def test_no_fallback_preflight_never_attempts_xhigh(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")
        rejected = subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="invalid value 'max' for model_reasoning_effort",
        )
        with tempfile.TemporaryDirectory() as temporary:
            with mock.patch.object(
                runner, "_run_process", return_value=rejected
            ) as run_process:
                with self.assertRaisesRegex(RuntimeError, "pin preflight failed"):
                    runner.preflight_pin(
                        "/fake/codex",
                        Path(temporary),
                        SKILL_DIR / "scripts" / "report.schema.json",
                        timeout=1,
                        allow_fallback=False,
                    )

        self.assertEqual(run_process.call_count, 1)
        self.assertIn('model_reasoning_effort="max"', run_process.call_args.args[0])

    def test_payload_validation_rejects_missing_finding_fields(self) -> None:
        runner = load_runner()
        self.assertIsNotNone(runner, "convention-audit runner is not implemented")

        with self.assertRaisesRegex(RuntimeError, "missing required field confidence"):
            runner.validate_payload(
                {
                    "worker": "synthesis",
                    "findings": [
                        {
                            "concept": "x",
                            "implementation_sites": [],
                            "divergent_sites": [],
                            "shared_helper_shape": "helper",
                        }
                    ],
                }
            )


class LiveEvalScoringTest(unittest.TestCase):
    def test_control_confirmation_runs_isolated_arm_with_fake_cli(self) -> None:
        live_eval = load_live_eval()
        self.assertIsNotNone(live_eval, "live eval harness is not implemented")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fake_codex = root / "fake-codex"
            fake_codex.write_text(
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import json
                    import sys
                    from pathlib import Path

                    output_path = Path(sys.argv[sys.argv.index("-o") + 1])
                    output_path.write_text(json.dumps({"worker": "synthesis", "findings": []}))
                    print("model: gpt-5.6-luna")
                    print("reasoning effort: max")
                    if "--json" in sys.argv:
                        print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 3, "output_tokens": 2}}))
                    """
                ),
                encoding="utf-8",
            )
            fake_codex.chmod(0o755)
            args = SimpleNamespace(
                codex_binary=str(fake_codex),
                output_dir=root / "results",
                timeout=30,
                no_effort_fallback=True,
            )

            results = live_eval.run_control_confirmation(args)

        self.assertTrue(results["control_gate_passed"])
        self.assertTrue(results["contamination_check_passed"])
        self.assertEqual(results["green_with_skill"]["passed"], 3)
        self.assertIs(results["pin"]["fallback_used"], False)

    def test_contamination_check_rejects_answer_key_paths(self) -> None:
        live_eval = load_live_eval()
        self.assertIsNotNone(live_eval, "live eval harness is not implemented")
        with tempfile.TemporaryDirectory() as temporary:
            log = Path(temporary) / "worker.jsonl"
            worker = SimpleNamespace(label="worker", stdout_log=str(log))
            log.write_text(
                '{"message":"read evals/expected/known-answer.json"}\n',
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "answer-key contamination"):
                live_eval.assert_no_eval_contamination([worker])
            log.write_text('{"message":"read src/example.py"}\n', encoding="utf-8")
            live_eval.assert_no_eval_contamination([worker])

    def test_ship_gate_requires_every_green_assertion(self) -> None:
        live_eval = load_live_eval()
        self.assertIsNotNone(live_eval, "live eval harness is not implemented")
        passing = {
            "contamination_check_passed": True,
            "green_with_skill": {
                "cases": {
                    "known_answer": {"passed": 5, "total": 5, "score_pct": 100.0},
                    "shared_helper_control": {
                        "passed": 3,
                        "total": 3,
                        "score_pct": 100.0,
                    },
                }
            },
        }
        failing = json.loads(json.dumps(passing))
        failing["green_with_skill"]["cases"]["shared_helper_control"]["passed"] = 2
        missing_contamination_proof = json.loads(json.dumps(passing))
        missing_contamination_proof.pop("contamination_check_passed")

        self.assertTrue(live_eval.ship_gate_passed(passing))
        self.assertFalse(live_eval.ship_gate_passed(failing))
        self.assertFalse(live_eval.ship_gate_passed(missing_contamination_proof))

    def test_known_answer_scoring_uses_the_exact_candidate_not_the_first_partial_match(
        self,
    ) -> None:
        live_eval = load_live_eval()
        self.assertIsNotNone(live_eval, "live eval harness is not implemented")
        expected = json.loads((EXPECTED / "known-answer.json").read_text())["findings"][
            0
        ]
        partial = {
            **expected,
            "concept": "larger unrelated family",
            "implementation_sites": [
                *expected["implementation_sites"],
                {"path": "src/other.py", "line": 1, "summary": "other"},
            ],
        }

        score = live_eval.score_known_answer({"findings": [partial, expected]})

        self.assertEqual(score["passed"], 5)

    def test_known_answer_scoring_requires_exact_divergence(self) -> None:
        live_eval = load_live_eval()
        self.assertIsNotNone(live_eval, "live eval harness is not implemented")
        payload = json.loads((EXPECTED / "known-answer.json").read_text())
        finding = payload["findings"][0]

        score = live_eval.score_known_answer(
            {"findings": [{**finding, "site_count": 6}]}
        )

        self.assertEqual(score["passed"], 5)
        self.assertEqual(score["total"], 5)

        wrong_six = {
            **finding,
            "implementation_sites": [
                *finding["implementation_sites"][:-1],
                {
                    "path": "src/unrelated.py",
                    "line": 1,
                    "summary": "not part of the concept",
                },
            ],
        }
        self.assertLess(
            live_eval.score_known_answer({"findings": [wrong_six]})["passed"], 5
        )

    def test_control_scoring_requires_zero_findings(self) -> None:
        live_eval = load_live_eval()
        self.assertIsNotNone(live_eval, "live eval harness is not implemented")

        score = live_eval.score_control({"findings": []})

        self.assertEqual(score, {"passed": 3, "total": 3, "score_pct": 100.0})


if __name__ == "__main__":
    unittest.main()
