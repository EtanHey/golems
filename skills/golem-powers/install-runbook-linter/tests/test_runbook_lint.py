"""RED→GREEN replay for the install-runbook linter (gen-18 Track 6 D2)."""

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("runbook_lint", ROOT / "runbook_lint.py")
rl = importlib.util.module_from_spec(spec)
sys.modules["runbook_lint"] = rl
spec.loader.exec_module(rl)

RED = (ROOT / "fixtures" / "red-runbook.md").read_text()
GREEN = (ROOT / "fixtures" / "green-runbook.md").read_text()


def _rules(violations):
    return {v["rule"] for v in violations}


# ── The headline gate: RED trips every rule, GREEN trips none ──────────────────────

def test_red_runbook_trips_all_rules():
    rules = _rules(rl.lint_runbook(RED))
    assert "privileged-in-standard-phase" in rules
    assert "cask-before-prereqs" in rules
    assert "receipt-not-bundle-verify" in rules
    assert "inconsistent-identifier-spelling" in rules
    assert "prereq-incompleteness" in rules


def test_green_runbook_is_clean():
    assert rl.lint_runbook(GREEN) == [], "the correct runbook must produce zero violations"


# ── Rule 1: privilege split (scans code blocks only) ───────────────────────────────

def test_privileged_command_in_standard_phase_flagged():
    violations = [v for v in rl.lint_runbook(RED) if v["rule"] == "privileged-in-standard-phase"]
    labels = {v["evidence"].split(":")[0] for v in violations}
    assert {"brew tap", "brew install", "--cask", "sudo"} <= labels


def test_prose_prohibition_does_not_false_fire():
    # GREEN's Phase B names `brew install` / `sudo` / `npm install -g` in PROSE — must not fire.
    violations = [v for v in rl.lint_runbook(GREEN) if v["rule"] == "privileged-in-standard-phase"]
    assert violations == []


def test_code_comment_in_block_does_not_false_fire():
    md = (
        "## Phase B - worker (Standard user)\n"
        "```bash\n"
        "# do not run brew install --cask here\n"
        "echo ok\n"
        "```\n"
    )
    assert [v for v in rl.lint_runbook(md) if v["rule"] == "privileged-in-standard-phase"] == []


def test_npm_install_g_allowed_with_user_prefix():
    # `npm install -g` is user-space-safe when a per-user npm prefix is established.
    safe = (
        "## Phase B - worker (Standard user)\n"
        "```bash\n"
        'npm config set prefix "$HOME/.npm-global"\n'
        "npm install -g @anthropic-ai/claude-code\n"
        "```\n"
    )
    assert not any(
        v["rule"] == "privileged-in-standard-phase" and "npm" in v["evidence"]
        for v in rl.lint_runbook(safe)
    )
    # …but `npm install -g` with NO user prefix in the doc is still flagged.
    unsafe = (
        "## Phase B - worker (Standard user)\n"
        "```bash\nnpm install -g @anthropic-ai/claude-code\n```\n"
    )
    assert any(
        v["rule"] == "privileged-in-standard-phase" and "npm" in v["evidence"]
        for v in rl.lint_runbook(unsafe)
    )


def test_admin_phase_privileged_is_allowed():
    md = (
        "## Prerequisites\n- bun present\n"
        "## Phase A - Admin: Machine-Wide Setup\n"
        "```bash\nbrew install --cask brainbar\n```\n"
        "## Phase C - Verify\n```bash\nls /Applications/BrainBar.app --version\n```\n"
    )
    assert [v for v in rl.lint_runbook(md) if v["rule"] == "privileged-in-standard-phase"] == []


def test_privileged_command_in_neutral_phase_flagged():
    # RED specimen: retitling a Standard phase to a neutral/unlabeled "Install" phase
    # must not make privileged machine-wide work go silent.
    md = (
        "## Install\n"
        "```bash\n"
        "brew install --cask brainbar\n"
        "```\n"
    )
    violations = [v for v in rl.lint_runbook(md) if v["rule"] == "privileged-in-standard-phase"]
    assert any("--cask" in v["evidence"] for v in violations)

    clean = (
        "## Prerequisites\n- brew present\n"
        "## Phase A - Admin: Machine-Wide Setup\n"
        "```bash\nbrew install --cask brainbar\n```\n"
        "## Verify\n```bash\nls /Applications/BrainBar.app\n```\n"
    )
    assert [v for v in rl.lint_runbook(clean) if v["rule"] == "privileged-in-standard-phase"] == []


def test_privileged_command_aliases_and_homebrew_chown_flagged():
    # RED specimen: privileged helpers spelled as absolute sudo, doas, or Homebrew chown
    # are still privileged commands.
    md = (
        "## Phase B - worker (Standard user)\n"
        "```bash\n"
        "/usr/bin/sudo mkdir -p /opt/app-data\n"
        "doas launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.test.plist\n"
        "chown -R /opt/homebrew/Cellar/example\n"
        "```\n"
    )
    labels = {
        v["evidence"].split(":")[0]
        for v in rl.lint_runbook(md)
        if v["rule"] == "privileged-in-standard-phase"
    }
    assert {"/usr/bin/sudo", "doas", "chown -R /opt/homebrew"} <= labels

    assert [v for v in rl.lint_runbook(GREEN) if v["rule"] == "privileged-in-standard-phase"] == []


# ── Phase classification ───────────────────────────────────────────────────────────

def test_classify_phase_roles():
    assert rl.classify_phase("Phase A - Admin Etan: Machine-Wide Setup", "") == "admin"
    assert rl.classify_phase("Phase B - happy-camper: Install in User Space", "boundary admin") == "standard"
    assert rl.classify_phase("Phase C - End-State Verification", "") == "neutral"


def test_standard_role_from_body_only():
    # PR #527 Bugbot: a neutral title with Standard role stated in the body → standard,
    # and an admin-boundary mention in the body must NOT flip a Standard phase to admin.
    assert rl.classify_phase("Phase 2 - Install", "the happy-camper Standard user runs this") == "standard"
    assert rl.classify_phase("Setup", "Standard user; do not cross the admin boundary") == "standard"


def test_privileged_under_non_phase_section_flagged():
    # PR #527 Bugbot: privileged code under a non-"Phase" h2 section (here a Standard
    # "## Setup") must still be linted, not skipped for lacking the word "Phase".
    md = (
        "## Setup (worker, a Standard user)\n"
        "```bash\nbrew install --cask brainbar\n```\n"
    )
    rules = {v["rule"] for v in rl.lint_runbook(md)}
    assert "privileged-in-standard-phase" in rules


def test_subsection_code_stays_under_parent_phase():
    # `###` subsection brew under an Admin h2 phase is admin, not its own neutral section.
    md = (
        "## Prerequisites\n- bun\n"
        "## Phase A - Admin: Machine-Wide\n"
        "### A3. Install\n```bash\nbrew install --cask x\n```\n"
        "## Verify\n```bash\nls /Applications/X.app --version\n```\n"
    )
    assert not any(v["rule"] == "privileged-in-standard-phase" for v in rl.lint_runbook(md))


# ── Rule 2 & 3 isolation ───────────────────────────────────────────────────────────

def test_cask_before_prereqs_only_when_no_preflight():
    with_prereq = (
        "## Prerequisites\n- bun\n"
        "## Phase A - Admin\n```bash\nbrew install --cask x\n```\n"
        "## Verify\n```bash\nls /Applications/X.app\n```\n"
    )
    assert not any(v["rule"] == "cask-before-prereqs" for v in rl.lint_runbook(with_prereq))


def test_receipt_only_verification_flagged():
    md = (
        "## Prerequisites\n- bun\n"
        "## Phase A - Admin\n```bash\nbrew install --cask x\n```\n"
        "## Verify\n```bash\nbrew list --cask x\n```\n"  # receipt only, no bundle
    )
    assert any(v["rule"] == "receipt-not-bundle-verify" for v in rl.lint_runbook(md))


def test_receipt_verification_must_match_its_own_bundle():
    # RED specimen: a BrainBar receipt cannot be satisfied by checking some other app's
    # bundle. The receipt must be tied to the cask's own on-disk bundle.
    md = (
        "## Prerequisites\n- brew\n"
        "## Phase A - Admin\n```bash\nbrew install --cask brainbar\n```\n"
        "## Verify\n"
        "```bash\n"
        "ls /Applications/VoiceBar.app\n"
        "brew list --cask brainbar\n"
        "```\n"
    )
    assert any(v["rule"] == "receipt-not-bundle-verify" for v in rl.lint_runbook(md))

    clean = (
        "## Prerequisites\n- brew\n"
        "## Phase A - Admin\n```bash\nbrew install --cask brainbar\n```\n"
        "## Verify\n"
        "```bash\n"
        "ls /Applications/BrainBar.app\n"
        "brew list --cask brainbar\n"
        "```\n"
    )
    assert [v for v in rl.lint_runbook(clean) if v["rule"] == "receipt-not-bundle-verify"] == []


def test_non_fenced_privileged_and_cask_commands_are_linted():
    # RED specimen: a command copied as an indented/non-fenced runbook line is still a
    # command, not prose, and must hit both privilege and cask gates.
    md = (
        "## Install\n"
        "    brew install --cask brainbar\n"
        "## Verify\n"
        "    brew list --cask brainbar\n"
    )
    rules = _rules(rl.lint_runbook(md))
    assert "privileged-in-standard-phase" in rules
    assert "cask-before-prereqs" in rules
    assert "receipt-not-bundle-verify" in rules

    clean = (
        "## Notes\n"
        "The Standard user must not run brew install --cask from prose.\n"
    )
    assert rl.lint_runbook(clean) == []


def test_prose_bundle_mention_does_not_satisfy_verification():
    # PR #527 Bugbot: prose saying "check /Applications" must NOT count as real bundle
    # verification — only fenced code commands do. Receipt-only code → still flagged.
    md = (
        "## Prerequisites\n- bun\n"
        "## Phase A - Admin\n```bash\nbrew install --cask x\n```\n"
        "## Verify\n"
        "Confirm the app is at /Applications/X.app and check its --version.\n"  # PROSE only
        "```bash\nbrew list --cask x\n```\n"  # actual command: receipt only
    )
    assert any(v["rule"] == "receipt-not-bundle-verify" for v in rl.lint_runbook(md))


def test_inline_comment_privileged_token_does_not_fire():
    # PR #527 Bugbot: a privileged token after an inline `#` comment is not a command.
    md = (
        "## Phase B - worker (Standard user)\n"
        "```bash\n"
        "echo ok   # brew install --cask should NOT run here\n"
        "true       # sudo is also fine to mention\n"
        "```\n"
    )
    assert [v for v in rl.lint_runbook(md) if v["rule"] == "privileged-in-standard-phase"] == []


# ── Rule 4: inconsistent identifier spelling ──────────────────────────────────────

def test_identifier_spelling_allows_happy_campr_company_and_happy_camper_account():
    md = (
        "# Happy Campr Setup\n"
        "Use the `happy-camper` account for the install.\n"
        "Start the happyCampr launcher after setup.\n"
        "```bash\n"
        'launchctl kickstart gui/$(id -u happy-camper)/com.happyCampr.launcher\n'
        "```\n"
    )
    assert [
        v for v in rl.lint_runbook(md)
        if v["rule"] == "inconsistent-identifier-spelling"
    ] == []


def test_inconsistent_identifier_spelling_still_flags_happy_camper_account_typo():
    md = (
        "# Happy Camper Setup\n"
        "Use the `happy-camper` account for the install.\n"
        "Later commands mistakenly refer to `happy-campep`.\n"
        "The `happy-camper` account owns the user-space files.\n"
    )
    violations = [
        v for v in rl.lint_runbook(md)
        if v["rule"] == "inconsistent-identifier-spelling"
    ]
    assert violations
    assert "happy-camper" in violations[0]["evidence"]
    assert "happy-campep" in violations[0]["evidence"]


def test_identifier_spelling_checks_load_bearing_across_all_occurrences():
    md = (
        "# Happy Camper Setup\n"
        "The prose first mentions happy-camper without making it a code identifier.\n"
        "The prose first mentions happy-campep without making it a code identifier.\n"
        "Later the account is used as `happy-camper`.\n"
        "```bash\n"
        "repoGolem happy-campep \"$HOME/Gits/mimir\"\n"
        "```\n"
    )
    violations = [
        v for v in rl.lint_runbook(md)
        if v["rule"] == "inconsistent-identifier-spelling"
    ]
    assert violations
    assert "happy-camper" in violations[0]["evidence"]
    assert "happy-campep" in violations[0]["evidence"]


def test_inconsistent_identifier_spelling_flags_load_bearing_case_variants():
    md = (
        "# VoiceBar Setup\n"
        "Install `VoiceBar` from the cask.\n"
        "Verify `Voicebar` after launch.\n"
    )
    violations = [
        v for v in rl.lint_runbook(md)
        if v["rule"] == "inconsistent-identifier-spelling"
    ]
    assert violations
    assert "VoiceBar" in violations[0]["evidence"]
    assert "Voicebar" in violations[0]["evidence"]


def test_identifier_spelling_does_not_flag_distinct_words_or_substrings():
    md = (
        "# Install Runbook\n"
        "Install the app in user space.\n"
        "Uninstall the app during rollback.\n"
        "`golden_retriever` is a real identifier, not a golden-file marker.\n"
        "`retriever` is a different identifier.\n"
    )
    assert [
        v for v in rl.lint_runbook(md)
        if v["rule"] == "inconsistent-identifier-spelling"
    ] == []


def test_identifier_spelling_does_not_flag_prose_heading_case_variants():
    md = (
        "# Runbook\n"
        "## Phase A - One-Time Machine-Wide Setup\n"
        "The shared machine-wide tools are installed by the admin.\n"
        "## Phase B - Per-User Setup\n"
        "The worker runs per-user setup without admin writes.\n"
        "```bash\n"
        "echo \"OK: per-user socket\"\n"
        "```\n"
    )
    assert [
        v for v in rl.lint_runbook(md)
        if v["rule"] == "inconsistent-identifier-spelling"
    ] == []


def test_identifier_spelling_does_not_flag_regex_character_class_fragments():
    md = (
        "# Verify\n"
        "BrainLayer should be running.\n"
        "```bash\n"
        "ps aux | grep -i '[b]rainlayer' || true\n"
        "```\n"
    )
    assert [
        v for v in rl.lint_runbook(md)
        if v["rule"] == "inconsistent-identifier-spelling"
    ] == []


# ── Rule 5: prereq incompleteness ─────────────────────────────────────────────────

def test_prereq_incompleteness_flags_missing_developer_tool_used_in_code():
    md = (
        "# Tool Install\n"
        "## Prerequisites\n"
        "- Homebrew exists at `/opt/homebrew/bin/brew`.\n"
        "## Phase B - worker (Standard user)\n"
        "```bash\n"
        "bun install\n"
        "```\n"
    )
    violations = [
        v for v in rl.lint_runbook(md)
        if v["rule"] == "prereq-incompleteness"
    ]
    assert len(violations) == 1
    assert violations[0]["evidence"] == "bun"


def test_prereq_incompleteness_accepts_tools_named_in_prereqs():
    md = (
        "# Tool Install\n"
        "## Prerequisites\n"
        "- Homebrew exists at `/opt/homebrew/bin/brew`.\n"
        "- `bun`, `git`, and `rustup` are installed.\n"
        "## Phase B - worker (Standard user)\n"
        "```bash\n"
        "command -v brew\n"
        "bun install\n"
        "git status\n"
        "rustup target list\n"
        "```\n"
    )
    assert [
        v for v in rl.lint_runbook(md)
        if v["rule"] == "prereq-incompleteness"
    ] == []


def test_prereq_incompleteness_searches_nested_prereq_heading():
    md = (
        "# Tool Install\n"
        "## Phase 0 - Preflight\n"
        "### Prerequisites\n"
        "- `node` and `npm` are installed.\n"
        "## Phase B - worker (Standard user)\n"
        "```bash\n"
        "node --version\n"
        "npm --version\n"
        "```\n"
    )
    assert [
        v for v in rl.lint_runbook(md)
        if v["rule"] == "prereq-incompleteness"
    ] == []
