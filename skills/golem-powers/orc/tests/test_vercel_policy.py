from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]


def test_deploy_agent_vercel_contract():
    text = (ROOT / "skills/golem-powers/orc/agents/deploy-local-prod.md").read_text()
    for requirement in ("standards/vercel-deploys.md", "node scripts/vercel-budget.mjs", "soft limit 60", "Only this deploy agent", "default-branch SHA", "deploy-preview", "Never run a manual deploy otherwise"):
        assert requirement in text


def test_pr_loop_routes_vercel_without_prescribing_deploy():
    path = ROOT / "skills/golem-powers/pr-loop/SKILL.md"
    text = path.read_text()
    line = next(line for line in text.splitlines() if "standards/vercel-deploys.md" in line)
    assert "Never run" in line
    assert "only the deploy agent deploys" in line
    assert (path.parent / "../../../standards/vercel-deploys.md").resolve().is_file()
    assert not any(line.strip().startswith(("vercel deploy", "vercel --prod", "npx vercel")) for line in text.splitlines())
