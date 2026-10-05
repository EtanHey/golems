from .common import *  # noqa: F403

class Cases02:
    def test_watch_does_not_finalize_preparing_worker_without_log(self):
        module = load_module()
        manifest_path = self.temp_dir / "run" / "manifest.json"
        module.create_manifest(manifest_path, "run-1", "/repo", "lead-a")
        module.update_worker(
            manifest_path,
            "worker-a",
            {
                "status": "preparing",
                "log": str(self.temp_dir / "missing.log"),
            },
        )

        code = module.watch_manifest(manifest_path, timeout=0)

        self.assertEqual(code, 124)
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(data["workers"]["worker-a"]["status"], "watch_timeout")


    def test_pipeline_stops_before_next_stage_after_failure(self):
        module = load_module()
        parallel = self.composition_spec()
        Path(parallel["repo"]).mkdir()
        brief_c = self.temp_dir / "brief-c.md"
        brief_c.write_text("C\n", encoding="utf-8")
        spec = {
            "repo": parallel["repo"],
            "lead": parallel["lead"],
            "stages": [
                {"name": "stage-1", "workers": parallel["workers"]},
                {"name": "stage-2", "workers": [{"name": "worker-c", "brief": str(brief_c)}]},
            ],
        }
        events = []

        def fake_launch(**kwargs):
            events.append(f"launch:{kwargs['worker_name']}")
            module.update_worker(
                kwargs["manifest_path"],
                kwargs["worker_name"],
                {"status": "running"},
            )
            return {"ok": True, "state": "running", "worker": kwargs["worker_name"]}

        def failing_watch(_manifest_path, **_kwargs):
            events.append("watch:failed")
            return 1

        code, manifest_path = module.run_pipeline_spec(
            spec,
            run_root=self.temp_dir / "pipeline",
            run_id="pipeline-run",
            launch_fn=fake_launch,
            watch_fn=failing_watch,
        )

        self.assertEqual(code, 1)
        self.assertEqual(events, ["launch:worker-a", "launch:worker-b", "watch:failed"])
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertFalse(data["continue_on_failure"])
        self.assertNotIn("worker-c", data["workers"])


    def test_spec_validation_rejects_unsafe_or_ambiguous_inputs(self):
        module = load_module()
        valid = self.composition_spec()
        Path(valid["repo"]).mkdir()
        module.validate_composition_spec(valid, pipeline=False)

        bad_name = json.loads(json.dumps(valid))
        bad_name["workers"][0]["name"] = "../../outside"
        missing_brief = json.loads(json.dumps(valid))
        del missing_brief["workers"][0]["brief"]
        relative_brief = json.loads(json.dumps(valid))
        relative_brief["workers"][0]["brief"] = "brief.md"
        bad_timeout = json.loads(json.dumps(valid))
        bad_timeout["workers"][1]["launch_timeout"] = "oops"
        bad_worker_effort = json.loads(json.dumps(valid))
        bad_worker_effort["workers"][1]["effort"] = "medium"
        bad_worker_name_type = json.loads(json.dumps(valid))
        bad_worker_name_type["workers"][1]["name"] = 123
        unknown_worker_field = json.loads(json.dumps(valid))
        unknown_worker_field["workers"][1]["unexpected"] = True
        for candidate in (
            bad_name,
            missing_brief,
            relative_brief,
            bad_timeout,
            bad_worker_effort,
            bad_worker_name_type,
            unknown_worker_field,
        ):
            with self.subTest(candidate=candidate):
                with self.assertRaises(module.CodexWorkflowError):
                    module.validate_composition_spec(candidate, pipeline=False)


    def test_pipeline_rejects_nonboolean_failure_policy(self):
        module = load_module()
        parallel = self.composition_spec()
        Path(parallel["repo"]).mkdir()
        spec = {
            "repo": parallel["repo"],
            "lead": parallel["lead"],
            "continue_on_failure": "false",
            "stages": [{"name": "stage-1", "workers": parallel["workers"]}],
        }

        with self.assertRaisesRegex(module.CodexWorkflowError, "continue_on_failure"):
            module.validate_composition_spec(spec, pipeline=True)


    def test_skill_frontmatter_and_routing_contract(self):
        skill_path = SKILL_DIR / "SKILL.md"
        self.assertTrue(skill_path.is_file(), f"missing {skill_path}")
        text = skill_path.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\nname: codex-workflows\n"))
        description_line = next(
            line for line in text.splitlines() if line.startswith("description:")
        )
        self.assertLess(len(description_line.removeprefix("description:").strip()), 300)
        for required in (
            "NOT for",
            "cmux",
            "$HOME/.local/bin/codex",
            "git remote show origin",
            "Never live-grep",
            "codex.implement",
            "output tokens",
            "wall-clock",
            "lead-reachable-only",
            "no-pane",
            "no-listen-name",
            "no-self-monitor",
            "--add-dir",
        ):
            with self.subTest(required=required):
                self.assertIn(required, text)


    def test_skill_packages_agent_parallel_pipeline_workflows(self):
        expected = {
            "agent.md": ["codex-workflows.sh agent", "--manifest", "--run-id"],
            "parallel.md": ["codex-workflows.sh parallel", "workers", "--watch"],
            "pipeline.md": ["codex-workflows.sh pipeline", "stages", "continue_on_failure"],
        }
        for filename, required in expected.items():
            path = SKILL_DIR / "workflows" / filename
            with self.subTest(filename=filename):
                self.assertTrue(path.is_file(), f"missing {path}")
                text = path.read_text(encoding="utf-8")
                for token in required:
                    self.assertIn(token, text)

        parallel = (SKILL_DIR / "workflows" / "parallel.md").read_text(encoding="utf-8")
        self.assertIn("worktree-relative", parallel)
        self.assertIn("<run-dir>/<run-id>/harvest", parallel)


    def test_composition_schema_and_manifest_reference_are_packaged(self):
        schema_path = SKILL_DIR / "references" / "composition.schema.json"
        manifest_path = SKILL_DIR / "references" / "manifest.md"
        self.assertTrue(schema_path.is_file(), f"missing {schema_path}")
        self.assertTrue(manifest_path.is_file(), f"missing {manifest_path}")
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertIn("repo", schema["required"])
        self.assertIn("lead", schema["required"])
        reference = manifest_path.read_text(encoding="utf-8")
        for state in (
            "failed_launch",
            "watch_timeout",
            "completed",
            "failed",
            "parser_failed",
            "incomplete",
        ):
            self.assertIn(state, reference)


    def test_shell_entrypoints_are_executable(self):
        for path in (
            SKILL_DIR / "scripts" / "codex-workflows.sh",
            SKILL_DIR / "evals" / "run-false-green.sh",
            SKILL_DIR / "evals" / "run-live-fanout.sh",
        ):
            with self.subTest(path=path):
                self.assertTrue(path.is_file(), f"missing {path}")
                self.assertTrue(os.access(path, os.X_OK), f"not executable: {path}")


    def test_live_eval_defaults_to_untracked_repo_worktrees_and_result(self):
        script = (SKILL_DIR / "evals" / "run-live-fanout.sh").read_text(
            encoding="utf-8"
        )
        self.assertIn('$REPO/.worktrees/codex-workflows-evals', script)
        self.assertIn("CODEX_WORKFLOWS_RESULT_PATH", script)
        self.assertNotIn('RESULT="$SCRIPT_DIR/results/live-', script)
        self.assertIn('cleanup --manifest "$MANIFEST" --delete-branches', script)


