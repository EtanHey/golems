"""Class-only argv fixtures; fixture-tool is absent. Never execute a payload."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[2]
sys.path.insert(0, str(ROOT / 'hooks'))
from commands import operations

DENIALS = {
    'glob_star_option': 'xargs -* "$TOOL"',
    'glob_question_option': 'xargs -? "$TOOL"',
    'glob_bracket_option': 'xargs -[a-z] "$TOOL"',
    'brace_list_option': 'xargs -{t,0} "$TOOL"',
    'brace_range_option': 'xargs -{1..3} "$TOOL"',
    'insert_utility': 'xargs -J TOKEN TOKEN push --force origin topic',
    'insert_utility_cluster': 'xargs -tJ TOKEN TOKEN push --force origin topic',
    'insert_utility_terminated': 'xargs -J TOKEN -- TOKEN push --force origin topic',
    'insert_utility_whole_command': 'xargs -J TOKEN TOKEN',
    'insert_shared_token': 'xargs -I TOKEN -J TOKEN TOKEN',
    'last_insert_appends_env': 'xargs -I TOKEN -J OTHER env',
    'last_insert_appends_command': 'xargs -I TOKEN -J OTHER command',
    'last_insert_appends_nested': 'xargs -I TOKEN -J OTHER timeout 2 env',
    'last_insert_appends_dynamic': 'xargs -I TOKEN -J OTHER "$TOOL"',
    'gnu_count_cancels': 'xargs -I TOKEN -n 9 env',
    'gnu_lines_cancels': 'xargs -I TOKEN -L 1 env',
    'gnu_optional_lines_cancels': 'xargs -I TOKEN -l env',
    'gnu_optional_replace_cancels': 'xargs -i -n 5 env',
    'gnu_long_count_cancels': 'xargs --replace=TOKEN --max-args=9 env',
    'gnu_long_lines_cancels': 'xargs --replace=TOKEN --max-lines=1 env',
    'gnu_long_default_lines_cancels': 'xargs --replace=TOKEN --max-lines env',
    'gnu_cluster_lines_cancels': 'xargs -ITOKEN -tl1 env',
    'gnu_count_cancels_dynamic': 'xargs -I TOKEN -n 4 "$TOOL"',
    'gnu_dynamic_count_may_cancel': 'xargs -I TOKEN -n "$COUNT" env',
    'gnu_one_does_not_restore': 'xargs -I TOKEN -n 9 -n 1 env',
    'dynamic_cluster_option': 'xargs -t"$OPT" "$TOOL"',
    'dynamic_option': 'xargs "-$OPT" "$TOOL"',
    'dynamic_null_option': 'xargs -0"$OPT" "$TOOL"',
    'dynamic_substitution_option': 'xargs -"$(fixture-tool options)" "$TOOL"',
    'dynamic_option_fixed_child': 'xargs -t"$OPT" fixture-tool status',
    'bsd_insert_wrapper': 'xargs -J TOKEN env TOKEN push --force origin topic',
    'cluster_replace': 'xargs -tI TOKEN TOKEN push --force origin topic',
    'cluster_attached': 'xargs -0rtITOKEN TOKEN push --force origin topic',
    'cluster_insert': 'xargs -otJ TOKEN command TOKEN push --force origin topic',
    'bsd_count': 'xargs -R 1 -I TOKEN TOKEN push --force origin topic',
    'bsd_size': 'xargs -S 512 -I TOKEN TOKEN push --force origin topic',
    'gnu_file': 'xargs -a input -I TOKEN TOKEN push --force origin topic',
    'gnu_delimiter': 'xargs -d : -I TOKEN TOKEN push --force origin topic',
    'cluster_value': 'xargs -tn1 -tI TOKEN TOKEN push --force origin topic',
    'attached_values': 'xargs -R1 -S512 -aINPUT -d: -tITOKEN TOKEN push --force origin topic',
    'long_values': 'xargs --arg-file input --delimiter : --process-slot-var SLOT --replace=TOKEN TOKEN push --force origin topic',
    'long_abbreviation': 'xargs --arg-f=input --rep=TOKEN TOKEN push --force origin topic',
    'optional_short': 'xargs -tiTOKEN TOKEN push --force origin topic',
    'optional_default': 'xargs -ti {} push --force origin topic',
    'optional_long': 'xargs --replace {} push --force origin topic',
    'end_options': 'xargs -tI TOKEN -- TOKEN push --force origin topic',
    'replacement_env': 'xargs -I TOKEN env TOKEN push --force origin topic',
    'replacement_command': 'xargs -I TOKEN command TOKEN push --force origin topic',
    'replacement_nested': 'xargs -I TOKEN timeout 2 env -u NAME nice -n 1 TOKEN push --force origin topic',
    'replacement_path': 'xargs -I TOKEN env /fixture/TOKEN push --force origin topic',
    'insert_nested': 'xargs -J TOKEN timeout 2 env TOKEN push --force origin topic',
    'insert_no_visible_argv': 'xargs -J TOKEN env TOKEN',
    'insert_option_operand': 'xargs -J TOKEN env -u TOKEN',
    'insert_nested_no_argv': 'xargs -J TOKEN timeout 2 env TOKEN',
    'dynamic_replacement': 'xargs -I "$TOKEN" TOKEN push --force origin topic',
    'dynamic_insertion': 'xargs -J "$TOKEN" env TOKEN',
    'unknown_option_wrapper': 'xargs --future-option VALUE env',
    'unknown_short': 'xargs -Z VALUE TOKEN push --force origin topic',
    'unknown_long': 'xargs --future-option VALUE TOKEN push --force origin topic',
    'ambiguous_long': 'xargs --max 2 TOKEN push --force origin topic',
    'bare_env': 'xargs env',
    'bare_command': 'xargs command',
    'bare_exec': 'xargs exec',
    'bare_timeout': 'xargs timeout 2',
    'bare_env_options': 'xargs env -u NAME',
    'bare_env_assignment': 'xargs env NAME=value',
    'bare_nested': 'xargs timeout 2 env -u NAME nice -n 1',
    'appended_unknown_identity': 'xargs "$TOOL"',
    'appended_unknown_wrapper_child': 'xargs env "$TOOL"',
    'bare_insert_missing': 'xargs -J TOKEN env',
    'missing_required': 'xargs -tI',
    'missing_long_required': 'xargs --arg-file',
}

CONTROLS = {
    'literal_brace_replacement': 'xargs -I{TOKEN} echo {TOKEN}',
    'empty_brace_replacement': 'xargs -I{} echo {}',
    'gnu_one_retains': 'xargs -I TOKEN -n 1 env',
    'gnu_attached_one_retains': 'xargs -ITOKEN -n1 env',
    'gnu_long_one_retains': 'xargs --replace=TOKEN --max-args=1 env',
    'gnu_zero_padded_one_retains': 'xargs -I TOKEN -n 01 env',
    'gnu_count_before_replace': 'xargs -n 9 -I TOKEN env',
    'gnu_lines_before_replace': 'xargs -L 1 -I TOKEN env',
    'gnu_replace_restores': 'xargs -I TOKEN -l -I OTHER env',
    'bsd_last_replace': 'xargs -J TOKEN -I OTHER env',
    'bsd_last_replace_shared_token': 'xargs -J TOKEN -I TOKEN env',
    'bsd_replacement_restores': 'xargs -I TOKEN -J OTHER -I TOKEN env',
    'bsd_missing_insert_fixed_child': 'xargs -I TOKEN -J OTHER env fixture-tool status',
    'gnu_cancel_fixed_child': 'xargs -I TOKEN -n 9 env fixture-tool status',
    'gnu_cancel_data': 'xargs -I TOKEN -L 1 echo TOKEN push --force',
    'bsd_shared_token_data': 'xargs -I TOKEN -J TOKEN echo TOKEN',
    'help_before_dynamic_option': 'xargs --help -"$OPT" "$TOOL"',
    'bsd_insert_data': 'xargs -J TOKEN echo TOKEN push --force',
    'bsd_insert_substring': 'xargs -J TOKEN env fixture-TOKEN status',
    'bsd_insert_first_only': 'xargs -J TOKEN echo TOKEN TOKEN push --force',
    'bsd_insert_fixed_command': 'xargs -J TOKEN env fixture-tool TOKEN status',
    'cluster_data': 'xargs -tI TOKEN echo TOKEN push --force',
    'cluster_insert_data': 'xargs -otJ TOKEN printf "%s" TOKEN',
    'bsd_values_data': 'xargs -R 1 -S 512 -I TOKEN echo TOKEN',
    'gnu_values_data': 'xargs -a input -d : -I TOKEN echo TOKEN',
    'attached_data': 'xargs -R1 -S512 -aINPUT -d: -tITOKEN echo TOKEN',
    'long_values_data': 'xargs --arg-file=input --delimiter=: --process-slot-var=SLOT --replace=TOKEN echo TOKEN',
    'long_abbreviation_data': 'xargs --arg-f=input --rep=TOKEN echo TOKEN push --force',
    'optional_eof': 'xargs -te echo push --force',
    'optional_lines': 'xargs -tl echo push --force',
    'optional_long_values': 'xargs --eof --max-lines echo push --force',
    'optional_operand_is_child': 'xargs --replace TOKEN TOKEN push --force',
    'optional_replace': 'xargs -ti echo {} push --force',
    'option_operand_is_data': 'xargs -a --force echo status',
    'marker_without_guarded_argv': 'xargs -I TOKEN TOKEN --help',
    'wrapper_fixed_command': 'xargs -I TOKEN env fixture-tool TOKEN status',
    'nested_fixed_command': 'xargs -I TOKEN timeout 2 env nice fixture-tool TOKEN status',
    'wrapper_lookup': 'xargs command -v',
    'replacement_no_append': 'xargs -I TOKEN env',
    'ordinary_append': 'xargs env fixture-tool status',
    'ordinary_data': 'xargs echo push --force',
    'known_appended_identity': 'TOOL=echo; xargs "$TOOL"',
    'no_utility': 'xargs -0',
    'terminated_option_is_utility': 'xargs -- -I TOKEN push --force',
    'child_flags_are_not_options': 'xargs fixture-tool -tI TOKEN push --force',
    'unknown_option_benign': 'xargs --future-option VALUE fixture-tool status',
    'help_no_execution': 'xargs --help env',
    'version_no_execution': 'xargs --version env',
}


class XargsIdentity(unittest.TestCase):
    pass


def make_case(command, deny):
    def test(self):
        if deny:
            with self.assertRaises(ValueError):
                operations(command, str(REPO), alias_lookup=lambda *_: None)
        else:
            self.assertEqual(operations(command, str(REPO), alias_lookup=lambda *_: None), [])
        env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_') and
               k not in ('WEAVE_ALLOW_TMP', 'GOLEM_ROLE', 'GOLEM_EFFORT', 'PYTHONPATH', 'PYTHONHOME')}
        env['HOME'] = str(REPO / 'docs.local/f1-evidence/empty-home')
        env['GUARD_ROOT'] = str(REPO)
        payload = dict(tool_name='Bash', tool_input=dict(command=command),
                       cwd=str(REPO), session_id='synthetic-xargs-identity')
        run = subprocess.run([sys.executable, '-I', '-B', str(ROOT / 'hooks/human-confirm-pretooluse.py')],
                             input=json.dumps(payload), env=env, cwd=REPO, text=True,
                             capture_output=True, timeout=12)
        self.assertEqual(run.returncode, 2 if deny else 0, run.stderr)
        data = json.loads(run.stdout)
        if deny:
            self.assertEqual(data['hookSpecificOutput']['permissionDecision'], 'deny')
        else:
            self.assertEqual(data, {})
    return test


for name, command in DENIALS.items():
    setattr(XargsIdentity, 'test_deny_' + name, make_case(command, True))
for name, command in CONTROLS.items():
    setattr(XargsIdentity, 'test_allow_' + name, make_case(command, False))

if __name__ == '__main__':
    unittest.main()
