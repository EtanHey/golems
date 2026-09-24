"""RED→GREEN replay for the launchd-plist secret linter (gen-18 Track 6 D7).

Provider-pattern secret values are CONSTRUCTED in code (e.g. "AIza" + filler), never
committed as literals, so this test suite carries no real-shaped secret and golems Secret
Scanning stays green. The committed RED fixture uses rule 2 (literal in a secret-named var)
with mundane placeholder values.
"""

import importlib.util
import plistlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("psl", ROOT / "plist_secret_lint.py")
psl = importlib.util.module_from_spec(spec)
sys.modules["psl"] = psl
spec.loader.exec_module(psl)

RED = (ROOT / "fixtures" / "red-plist.plist").read_bytes()
GREEN = (ROOT / "fixtures" / "green-plist.plist").read_bytes()


def _plist_with_env(env: dict) -> bytes:
    return plistlib.dumps({"Label": "com.test", "EnvironmentVariables": env})


def _rules(violations):
    return {v["rule"] for v in violations}


# ── Headline gate: RED leaks, GREEN is hardened ────────────────────────────────────

def test_red_fixture_flags_secret_named_literals():
    violations = psl.lint_plist(RED)
    keys = {v["key"] for v in violations}
    assert "GOOGLE_API_KEY" in keys
    assert "DB_PASSWORD" in keys
    assert "DATA_DIR" not in keys  # not secret-named, literal path is fine
    assert _rules(violations) == {"literal-in-secret-named-var"}


def test_green_fixture_is_clean():
    assert psl.lint_plist(GREEN) == [], "op:// refs and $VAR indirection must not be flagged"


# ── Rule 1: known provider secret shapes (values built in-test, never committed) ───

def test_raw_google_api_key_flagged():
    leaky = _plist_with_env({"SOME_VAR": "AIza" + "B" * 33})  # Google key shape
    v = psl.lint_plist(leaky)
    assert any(x["rule"] == "raw-secret-value" and x["key"] == "SOME_VAR" for x in v)


def test_raw_github_and_openai_and_aws_flagged():
    cases = {
        "A": "ghp_" + "c" * 36,          # GitHub
        "B": "sk-" + "d" * 32,           # OpenAI-style
        "C": "AKIA" + "E" * 16,          # AWS access key id
    }
    for name, value in cases.items():
        v = psl.lint_plist(_plist_with_env({name: value}))
        assert any(x["rule"] == "raw-secret-value" for x in v), name


def test_provider_secrets_in_non_secret_named_vars_are_flagged():
    # RED specimen: provider-shaped secrets hidden in innocuous env var names still leak.
    cases = {
        "DATA_DIR": "sk_live_" + "a" * 24,
        "CACHE_PATH": "sk-ant-api03-" + "b" * 48,
        "ACCOUNT_ID": "AC" + "c" * 32,
        "LOG_DEST": "ghp_" + "d" * 36,
    }
    for key, value in cases.items():
        violations = psl.lint_plist(_plist_with_env({key: value}))
        assert any(v["rule"] == "raw-secret-value" and v["key"] == key for v in violations), key

    assert psl.lint_plist(_plist_with_env({"DATA_DIR": "/Users/x/data"})) == []


def test_program_arguments_are_scanned_for_provider_secrets():
    # RED specimen: launchd ProgramArguments leaks are just as durable as env leaks.
    data = plistlib.dumps({
        "Label": "com.test",
        "ProgramArguments": [
            "/opt/homebrew/bin/worker",
            "--anthropic-key",
            "sk-ant-api03-" + "e" * 48,
        ],
    })
    violations = psl.lint_plist(data)
    assert any(v["rule"] == "raw-secret-value" and v["key"] == "ProgramArguments[2]" for v in violations)

    clean = plistlib.dumps({
        "Label": "com.test",
        "ProgramArguments": ["/opt/homebrew/bin/worker", "--config", "/Users/x/config.json"],
    })
    assert psl.lint_plist(clean) == []


def test_pem_private_key_flagged():
    v = psl.lint_plist(_plist_with_env({"KEY": "-----BEGIN RSA PRIVATE KEY-----\nx\n"}))
    assert any(x["rule"] == "raw-secret-value" for x in v)


# ── Indirection is always safe (the hardened form) ─────────────────────────────────

def test_op_reference_and_env_indirection_never_flagged():
    safe = _plist_with_env({
        "GOOGLE_API_KEY": "op://Private/google/api_key",
        "GH_TOKEN": "$GH_TOKEN",
        "DB_PASSWORD": "${DB_PASSWORD}",
    })
    assert psl.lint_plist(safe) == []


def test_provider_pattern_in_op_reference_not_flagged():
    # Even if an op:// path contains a token-ish segment, it's a reference, not a literal.
    safe = _plist_with_env({"API_KEY": "op://vault/AIzaItemName/field"})
    assert psl.lint_plist(safe) == []


def test_secret_appended_to_op_reference_flagged():
    # PR #529 Bugbot r2: a provider key appended to an op:// value still sits in the file.
    leaky = _plist_with_env({"API_KEY": "op://vault/item " + "AIza" + "Q" * 33})
    assert any(x["rule"] == "raw-secret-value" for x in psl.lint_plist(leaky))


def test_dollar_prefix_does_not_hide_embedded_secret():
    # PR #529 Bugbot: a value that starts with $VAR but concatenates a real key is a leak.
    leaky = _plist_with_env({"FOO": "${PREFIX}" + "AIza" + "Z" * 33})
    assert any(x["rule"] == "raw-secret-value" for x in psl.lint_plist(leaky))
    # A secret-named var with `$VAR` + literal junk (no provider pattern) is still a leak.
    leaky2 = _plist_with_env({"API_KEY": "$BASE/hardcoded-trailing-literal"})
    assert any(x["rule"] == "literal-in-secret-named-var" for x in psl.lint_plist(leaky2))


def test_nested_environment_variables_are_scanned():
    # RED specimen: structured env payloads cannot hide nested literal secrets.
    leaky = {
        "EnvironmentVariables": {
            "CONFIG": {
                "DATA_DIR": "/Users/x/data",
                "API_KEY": "literal-secret-here",
                "PROVIDER": "sk-ant-api03-" + "f" * 48,
            },
            "LIST": ["ok", {"GH_TOKEN": "literal-token"}],
        }
    }
    keys = {v["key"] for v in psl.lint_plist(leaky)}
    assert {"EnvironmentVariables.CONFIG.API_KEY", "EnvironmentVariables.CONFIG.PROVIDER", "EnvironmentVariables.LIST[1].GH_TOKEN"} <= keys

    clean = {
        "EnvironmentVariables": {
            "CONFIG": {
                "DATA_DIR": "/Users/x/data",
                "API_KEY": "op://Private/service/api_key",
                "GH_TOKEN": "$GH_TOKEN",
            },
            "LIST": ["ok", {"PORT": "8765"}],
        }
    }
    assert psl.lint_plist(clean) == []


def test_command_substitution_is_flagged():
    # RED specimen: launchd does not need shell command substitution in static secrets
    # fields; `$(...)` is executable-looking material and must be rejected.
    leaky_env = _plist_with_env({"DATA_DIR": "$(op read op://Private/service/path)"})
    violations = psl.lint_plist(leaky_env)
    assert any(v["rule"] == "command-substitution" and v["key"] == "DATA_DIR" for v in violations)

    leaky_args = plistlib.dumps({
        "Label": "com.test",
        "ProgramArguments": ["/bin/sh", "-c", "echo $(op read op://Private/service/token)"],
    })
    violations = psl.lint_plist(leaky_args)
    assert any(v["rule"] == "command-substitution" and v["key"] == "ProgramArguments[2]" for v in violations)

    assert psl.lint_plist(_plist_with_env({"DATA_DIR": "$DATA_DIR"})) == []


# ── Non-secret values & shapes ─────────────────────────────────────────────────────

def test_non_secret_vars_with_plain_values_ok():
    ok = _plist_with_env({"DATA_DIR": "/Users/x/data", "PORT": "8765", "LOG_LEVEL": "info"})
    assert psl.lint_plist(ok) == []


def test_spaced_op_reference_not_flagged():
    # PR #529 Bugbot r3: a 1Password ref with spaces in vault/item names is still hardened.
    safe = _plist_with_env({"GOOGLE_API_KEY": "op://Private Vault/Google API/credential"})
    assert psl.lint_plist(safe) == []


def test_secret_name_substring_false_positives_avoided():
    # PR #529 Bugbot r3: TOKENIZER / SECRETARY are not credential-named.
    ok = _plist_with_env({"TOKENIZER": "bert-base", "SECRETARY": "alice", "PUBLIC_KEY": "/etc/k.pub"})
    assert psl.lint_plist(ok) == []
    # …but real credential names still fire on a literal.
    leak = _plist_with_env({"AWS_SECRET_ACCESS_KEY": "literal-blob", "GH_TOKEN": "literal-blob"})
    keys = {v["key"] for v in psl.lint_plist(leak)}
    assert keys == {"AWS_SECRET_ACCESS_KEY", "GH_TOKEN"}


def test_empty_and_missing_env_blocks_are_clean():
    assert psl.lint_plist(plistlib.dumps({"Label": "x"})) == []
    assert psl.lint_plist(_plist_with_env({})) == []
    assert psl.lint_plist({"EnvironmentVariables": {"API_KEY": "   "}}) == []  # blank value


def test_accepts_bytes_str_and_dict():
    d = {"EnvironmentVariables": {"TOKEN": "literal-secret-here"}}
    assert _rules(psl.lint_plist(d)) == {"literal-in-secret-named-var"}
    assert _rules(psl.lint_plist(_plist_with_env({"TOKEN": "literal-secret-here"}))) == {"literal-in-secret-named-var"}
    assert _rules(psl.lint_plist(_plist_with_env({"TOKEN": "literal-secret-here"}).decode())) == {"literal-in-secret-named-var"}
