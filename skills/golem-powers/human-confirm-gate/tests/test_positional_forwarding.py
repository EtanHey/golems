"""Positional forwarding fixtures. Candidate commands are never executed."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
ROOT = Path(__file__).resolve().parents[4]
assert (ROOT / 'skills/golem-powers/human-confirm-gate/hooks/human-confirm-pretooluse.py').is_file()
sys.path.insert(0, str(ROOT / 'skills/golem-powers/human-confirm-gate/hooks'))
from commands import operations
CASES = (('shell_0_0', 'bash -c \'$@\' _ "$TOOL" push --force origin topic', True),
 ('shell_0_1', 'bash -c \'"$@"\' _ "$TOOL" push --force origin topic', True),
 ('function_0_0', 'run() { $@; }; run "$TOOL" push --force origin topic', True),
 ('function_0_1', 'run() { "$@"; }; run "$TOOL" push --force origin topic', True),
 ('shell_1_0', 'bash -c \'${@}\' _ "$TOOL" push --force origin topic', True),
 ('shell_1_1', 'bash -c \'"${@}"\' _ "$TOOL" push --force origin topic', True),
 ('function_1_0', 'run() { ${@}; }; run "$TOOL" push --force origin topic', True),
 ('function_1_1', 'run() { "${@}"; }; run "$TOOL" push --force origin topic', True),
 ('shell_2_0', 'bash -c \'$*\' _ "$TOOL" push --force origin topic', True),
 ('shell_2_1', 'bash -c \'"$*"\' _ "$TOOL" push --force origin topic', True),
 ('function_2_0', 'run() { $*; }; run "$TOOL" push --force origin topic', True),
 ('function_2_1', 'run() { "$*"; }; run "$TOOL" push --force origin topic', True),
 ('shell_3_0', 'bash -c \'${*}\' _ "$TOOL" push --force origin topic', True),
 ('shell_3_1', 'bash -c \'"${*}"\' _ "$TOOL" push --force origin topic', True),
 ('function_3_0', 'run() { ${*}; }; run "$TOOL" push --force origin topic', True),
 ('function_3_1', 'run() { "${*}"; }; run "$TOOL" push --force origin topic', True),
 ('shell_4_0', 'bash -c \'$1 $2 $3 $4 $5\' _ "$TOOL" push --force origin topic', True),
 ('shell_4_1', 'bash -c \'"$1" "$2" "$3" "$4" "$5"\' _ "$TOOL" push --force origin topic', True),
 ('function_4_0', 'run() { $1 $2 $3 $4 $5; }; run "$TOOL" push --force origin topic', True),
 ('function_4_1', 'run() { "$1" "$2" "$3" "$4" "$5"; }; run "$TOOL" push --force origin topic', True),
 ('shell_5_0', 'bash -c \'${1} ${2} ${3} ${4} ${5}\' _ "$TOOL" push --force origin topic', True),
 ('shell_5_1', 'bash -c \'"${1}" "${2}" "${3}" "${4}" "${5}"\' _ "$TOOL" push --force origin topic', True),
 ('function_5_0', 'run() { ${1} ${2} ${3} ${4} ${5}; }; run "$TOOL" push --force origin topic', True),
 ('function_5_1',
  'run() { "${1}" "${2}" "${3}" "${4}" "${5}"; }; run "$TOOL" push --force origin topic',
  True),
 ('shell_6_0', 'bash -c \'${@:1}\' _ "$TOOL" push --force origin topic', True),
 ('shell_6_1', 'bash -c \'"${@:1}"\' _ "$TOOL" push --force origin topic', True),
 ('function_6_0', 'run() { ${@:1}; }; run "$TOOL" push --force origin topic', True),
 ('function_6_1', 'run() { "${@:1}"; }; run "$TOOL" push --force origin topic', True),
 ('shell_7_0', 'bash -c \'${*:1}\' _ "$TOOL" push --force origin topic', True),
 ('shell_7_1', 'bash -c \'"${*:1}"\' _ "$TOOL" push --force origin topic', True),
 ('function_7_0', 'run() { ${*:1}; }; run "$TOOL" push --force origin topic', True),
 ('function_7_1', 'run() { "${*:1}"; }; run "$TOOL" push --force origin topic', True),
 ('shell_8_0', 'bash -c \'$1 "${@:2}"\' _ "$TOOL" push --force origin topic', True),
 ('shell_8_1', 'bash -c \'$1 "${@:2}"\' _ "$TOOL" push --force origin topic', True),
 ('function_8_0', 'run() { $1 "${@:2}"; }; run "$TOOL" push --force origin topic', True),
 ('function_8_1', 'run() { $1 "${@:2}"; }; run "$TOOL" push --force origin topic', True),
 ('zero_0', 'bash -c \'$0 $1 $2 $3 $4\' "$TOOL" push --force origin topic', True),
 ('zero_1', 'bash -c \'"$0" "$@"\' "$TOOL" push --force origin topic', True),
 ('zero_2', 'bash -c \'"${@:0}"\' "$TOOL" push --force origin topic', True),
 ('stdin_dash', "xargs dash -c '$0 $1 $2 $3 $4'", True),
 ('stdin_ksh', 'xargs ksh -c \'"$0" "$@"\'', True),
 ('control_0', 'sh -c \'exec "$@"\' _ fixture-tool test', False),
 ('control_1', 'sh -c \'"$@"\' _ fixture-tool test', False),
 ('control_2', 'run() { "$@"; }; run fixture-tool test', False),
 ('control_3', 'retry() { "$@" || "$@"; }; retry fixture-tool test', False),
 ('control_4', "sh -c '$0 --version' fixture-tool", False),
 ('control_5', 'bash -c \'$1 "${@:2}"\' _ fixture-tool status', False),
 ('control_6', 'run() { "$1" "${@:2}"; }; run fixture-tool status', False),
 ('control_7', 'sh -c \'echo "$@"\' _ push --force', False),
 ('control_8', 'bash -c \'"$*"\' _ fixture-tool test', False),
 ('control_9', 'bash -c \'"$@"\' _', False),
 ('control_10', "sh -c 'echo $9' _", False),
 ('control_11', 'bash -c \'"$1"\' _ \'fixture-tool; echo data\'', False),
 ('control_12', 'bash -c \'echo "$1"\' _ \'$(fixture-tool push --force)\'', False),
 ('control_13', 'bash scripts/check.sh < <(ls)', False),
 ('control_14', 'bash scripts/check.sh 0< <(ls)', False),
 ('unknown_script', 'bash -c "$UNKNOWN"', True),
 ('empty_shell', 'bash -c \'$2 "${@:3}"\' _ \'\' "$TOOL" push --force origin topic', True),
 ('empty_function', 'f() { "$2" "${@:3}"; }; f "" "$TOOL" push --force origin topic', True),
 ('separator_function', 'f() { "$2" "${@:3}"; }; f \';\' "$TOOL" push --force origin topic', True),
 ('mutated_positionals', 'bash -c \'shift; $1 $2 $3 $4 $5\' _ echo "$TOOL" push --force origin topic', True),
 ('body_ifs', "bash -c 'IFS=:; $1' _ 'fixture-tool:push:--force:origin:topic'", True),
 ('dynamic_offset', 'bash -c \'"${@:$OFFSET}"\' _ "$TOOL" push --force origin topic', True),
 ('shell_function_scope',
  'bash -c \'f() { "$@"; }; f "$TOOL" push --force origin topic\' _ echo harmless',
  True),
 ('function_zero', 'bash -c \'f() { "$0" "$@"; }; f push --force origin topic\' fixture-tool', False),
 ('function_process_script',
  'f() { bash "$1"; }; f <(printf "%s" "fixture-tool push --force origin topic")',
  True),
 ('function_process_forward', 'f() { "$@"; }; f <(printf fixture-tool) push --force origin topic', True),
 ('function_substitution_data', 'f() { x=$(printf data); "$@"; }; f fixture-tool status', False),
 ('stdin_visible_zero', 'xargs dash -c \'"$@"\' _', True),
 ('source_process', 'source <(printf "%s" "fixture-tool push --force origin topic")', True),
 ('dot_process', '. <(printf "%s" "fixture-tool push --force origin topic")', True),
 ('stdin_negative_slice', 'xargs dash -c \'"${@: -5}"\' _ echo one two three four', True),
 ('multi_digit', 'bash -c \'${10} "${@:11}"\' _ a b c d e f g h i "$TOOL" push --force origin topic', True),
 ('slice_length', 'bash -c \'$1 "${@:2:4}"\' _ "$TOOL" push --force origin topic', True),
 ('negative_slice', 'bash -c \'"${@: -5}"\' _ "$TOOL" push --force origin topic', True),
 ('exec_wrapper', 'env bash -c \'exec "$@"\' _ "$TOOL" push --force origin topic', True),
 ('shell_options', 'bash -o posix -lc \'"$@"\' _ "$TOOL" push --force origin topic', True),
 ('nested_function',
  'inner() { "$@"; }; outer() { inner "$@"; }; outer "$TOOL" push --force origin topic',
  True),
 ('substitution_function',
  'f() { "$(printf fixture-tool)" $1 $2 $3 $4; }; f push --force origin topic',
  True),
 ('bound_function', 'TOOL=fixture-tool; f() { "$1" "${@:2}"; }; f "$TOOL" push --force origin topic', False),
 ('known_visible', 'bash -c \'"$@"\' _ fixture-tool push --force origin topic', False),
 ('known_function_visible', 'run() { "$@"; }; run fixture-tool push --force origin topic', False),
 ('nested_benign', 'inner() { "$@"; }; outer() { inner "$@"; }; outer fixture-tool test', False),
 ('literal_parameter', 'bash -c "\'\\$1\' --help" _ "$TOOL"', False),
 ('literal_operator', 'bash -c \'echo "$1"\' _ \'a; b | c > d\'', False),
 ('replacement_no_tail', 'xargs -I TOKEN dash -c \'"$@"\' _ fixture-tool status', False),
 ('no_stdin_forward', "xargs dash -c 'echo literal'", False),
 ('named_process_argv', 'bash scripts/check.sh <(ls)', False),
 ('process_script', 'bash <(printf fixture-tool)', True),
 ('process_descriptor', 'bash 0< <(printf fixture-tool)', True))
class PositionalForwarding(unittest.TestCase):
    def test_quoted_star_is_one_executable_word(self):
        import forwarding
        import shell_parse
        projected = forwarding.bind('"$*"', ['fixture-tool','test'], shell_parse)
        words, positions, _, _ = shell_parse._parse_bash(projected)
        self.assertEqual(words, ['fixture-tool test'])
        self.assertEqual(positions, [True])
        projected = forwarding.bind('"${@:2:2}"', ['ignored','fixture-tool','test','tail'], shell_parse)
        self.assertEqual(shell_parse._parse_bash(projected)[0], ['fixture-tool','test'])

def make_case(command, deny):
    def test(self):
        try:
            result = operations(command, str(ROOT), alias_lookup=lambda *_: None)
        except ValueError:
            result = ['structural denial']
        self.assertEqual(bool(result), deny, 'structural classification')
        env = {k:v for k,v in os.environ.items() if not k.startswith('GIT_') and
               k not in ('WEAVE_ALLOW_TMP','GOLEM_ROLE','GOLEM_EFFORT','PYTHONPATH','PYTHONHOME')}
        env.update(HOME=str(ROOT/'docs.local/f2-evidence/scratch-home'), GUARD_ROOT=str(ROOT))
        assert Path(env['GUARD_ROOT']).resolve() == ROOT
        payload = dict(tool_name='Bash', tool_input=dict(command=command), cwd=str(ROOT), session_id='synthetic-positional-forwarding')
        run = subprocess.run([sys.executable,'-I','-B',str(ROOT/'skills/golem-powers/human-confirm-gate/hooks/human-confirm-pretooluse.py')],input=json.dumps(payload),env=env,cwd=ROOT,text=True,capture_output=True,timeout=12)
        self.assertEqual(run.returncode,2 if deny else 0,run.stderr)
        data=json.loads(run.stdout)
        self.assertEqual(data.get('hookSpecificOutput',{}).get('permissionDecision'), 'deny' if deny else None)
    return test
for name,command,deny in CASES:
    setattr(PositionalForwarding,'test_'+name,make_case(command,deny))
if __name__=='__main__':
    unittest.main()
