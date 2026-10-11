"""Class-only defect fixtures; classify/JSON only, never execute payloads."""
ROWS=[('ctl_operator', 'F="fixture-tool push --force origin topic"; ${F:-}', True),
 ('ctl_exact', 'F="fixture-tool push --force origin topic"; $F', True),
 ('ctl_harmless', 'F=fixture-tool; ${F:-} status', False),
 ('skip_pipe_after', 'F="fixture-tool push --force origin topic"; ${F:-} | cat', True),
 ('skip_bg_after', 'F="fixture-tool push --force origin topic"; ${F:-} &', True),
 ('skip_echo_for', 'F="fixture-tool push --force origin topic"; ${F:-}; echo for', True),
 ('skip_echo_if_before', 'echo if; F="fixture-tool push --force origin topic"; ${F:-}', True),
 ('skip_echo_case_after', 'F="fixture-tool push --force origin topic"; ${F#x}; echo case', True),
 ('skip_brace_group', 'F="fixture-tool push --force origin topic"; { ${F:-}; }', True),
 ('skip_subshell', 'F="fixture-tool push --force origin topic"; (${F:-})', True),
 ('skip_if', 'F="fixture-tool push --force origin topic"; if true; then ${F:-}; fi', True),
 ('skip_whole_sub_pipe', '$(printf "%s" "fixture-tool push --force origin topic") | cat', True),
 ('skip_whole_sub_for', '$(printf "%s" "fixture-tool push --force origin topic"); echo for', True),
 ('skip_read_pipe', 'read -r F <<< "fixture-tool push --force origin topic"; $F | cat', True),
 ('skip_declare_for', 'declare F="fixture-tool push --force origin topic"; ${F%%x}; echo while', True),
 ('ok_andand', 'F="fixture-tool push --force origin topic"; true && ${F:-}', True),
 ('unset_f_function', 'F="fixture-tool push --force origin topic"; unset -f F; ${F:-}', True),
 ('unset_conditional', 'F="fixture-tool push --force origin topic"; false && unset F; ${F:-}', True),
 ('overwrite_conditional', 'F="fixture-tool push --force origin topic"; true || F=x; ${F:-}', True),
 ('overwrite_prefix_temp', 'F="fixture-tool push --force origin topic"; F=x true; ${F:-}', True),
 ('declare_conditional', 'F="fixture-tool push --force origin topic"; false && declare F=x; ${F:-}', True),
 ('ifs_known_comma_args', 'IFS=,; F=fixture-tool,-C,.; $F push --force origin topic', True),
 ('ifs_known_comma_env', 'IFS=,; F=env,fixture-tool; $F push --force origin topic', True),
 ('ifs_default_known', 'F=fixture-tool; $F push --force origin topic', False),
 ('indirect_bang', 'G="fixture-tool push --force origin topic"; F=G; ${!F}', True),
 ('indirect_bang_ops', 'G="fixture-tool push --force origin topic"; F=G; ${!F:-}', True),
 ('heredoc_then_operator', 'cat <<EOF\nhello\nEOF\nF="fixture-tool push --force origin topic"; ${F:-}', True),
 ('heredoc_quoted_data', "cat <<'EOF'\n$(printf data)\nEOF", False),
 ('heredoc_unquoted_then_cmd', 'cat <<EOF\n$(printf data)\nEOF\necho done', False),
 ('heredoc_tab', 'cat <<-EOF\n\thello\n\tEOF\necho done', False),
 ('fp_home_sync', '$HOME/bin/tool sync', False),
 ('fp_home_force', '"$HOME/.local/bin/tool" --force-color', False),
 ('fp_toplevel_script', '"$(fixture-tool rev-parse --show-toplevel)/scripts/x.sh"', False),
 ('fp_toplevel_args', '"$(fixture-tool rev-parse --show-toplevel)/scripts/x.sh" --verbose', False),
 ('fp_npmbin_edit', '$(npm bin)/tool edit README.md', True),
 ('fp_pwd_delete', '"$PWD/scripts/cleanup" delete tmpfile', True),
 ('fp_env_cmd', '$EDITOR README.md', False),
 ('fp_repo_var', 'R=/opt/x; $R/bin/tool archive out', False),
 ('fp_arith', 'x=1; echo $((x+1))', False),
 ('fp_cd_sub', 'cd "$(fixture-tool rev-parse --show-toplevel)" && ls', False),
 ('fp_git_commit_msg', 'fixture-tool commit -m "guard: push --force check"', False),
 ('fp_var_status', 'G=fixture-tool; $G status', False),
 ('scope_closer_operand',
  'F="fixture-tool push --force origin topic"; if false; then true fi; F=x; fi; ${F:-}',
  True),
 ('declaration_multi_expansion',
  'F="fixture-tool push --force origin topic"; declare F=x G="$F"; ${G:-}',
  True),
 ('prefix_declaration_expansion',
  'F="fixture-tool push --force origin topic"; F=x declare G="$F"; ${G:-}',
  True),
 ('prefix_command_expansion', 'F="fixture-tool push --force origin topic"; F=x ${F:-}', True),
 ('unset_function_args', 'F="fixture-tool push --force origin topic"; unset -f F; ${F:-} status', True),
 ('delimiter_keyword', 'cat <<for\ndata\nfor\nF="fixture-tool push --force origin topic"; ${F:-}', True),
 ('array_data', 'F=($(printf data)); echo "$F"', False),
 ('nested_data',
  'echo "data $([ "$(printf data)" = "$(printf data)" ] && echo "done ($(printf data))" || echo other)"',
  False),
 ('conditional_data', 'F="fixture-tool push --force origin topic"; false && unset F; echo "$F"', False),
 ('persistent_overwrite', 'F="fixture-tool push --force origin topic"; F=fixture-tool; $F status', False),
 ('temporary_guard_does_not_persist',
  'F="fixture-tool push --force origin topic" true; F=fixture-tool; $F status',
  False),
 ('data_keyword_then_overwrite',
  'F="fixture-tool push --force origin topic"; echo if; F=fixture-tool; $F status',
  False),
 ('ifs_literal_prefix', 'IFS=,; R=/opt/x; $R/bin/tool archive out', False),
 ('indirect_data', 'G="fixture-tool push --force origin topic"; F=G; echo "${!F}"', False),
 ('temporary_IFS', 'IFS=, true; F=fixture-tool; $F status', False)]
import json,os,subprocess,sys,unittest,tempfile
from pathlib import Path
ROOT=Path(os.environ.get('GUARD_ROOT',Path(__file__).resolve().parents[4])).resolve()
assert (ROOT/'skills/golem-powers/human-confirm-gate/hooks/human-confirm-pretooluse.py').is_file()
sys.path.append(str(ROOT/'skills/golem-powers/human-confirm-gate/hooks'))
from commands import operations
class Defects(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  parent=Path(os.environ.get('GOLEMS_TEST_HOME_ROOT',Path.home()/'.local/state/golems/f3-defect-fixtures')).resolve();parent.mkdir(parents=True,exist_ok=True)
  assert subprocess.run(['git','-C',str(parent),'rev-parse','--show-toplevel'],capture_output=True,timeout=5).returncode!=0
  cls.temp=tempfile.TemporaryDirectory(prefix='f3-',dir=parent);cls.home=Path(cls.temp.name)/'home';cls.cwd=Path(cls.temp.name)/'cwd';cls.home.mkdir();cls.cwd.mkdir()
  cls.env={k:v for k,v in os.environ.items() if not k.startswith(('GIT_','PYTHON','GOLEM','WEAVE','GUARD'))};cls.env.update(HOME=str(cls.home),GUARD_ROOT=str(ROOT),PYTHONDONTWRITEBYTECODE='1')
 @classmethod
 def tearDownClass(cls):cls.temp.cleanup()
def case(name,command,expected):
 def test(self):
  old=os.environ.get('HOME');os.environ['HOME']=str(self.home)
  try:
   try:deny=bool(operations(command,str(self.cwd),alias_lookup=lambda *_:None))
   except ValueError:deny=True
  finally:
   if old is None:os.environ.pop('HOME',None)
   else:os.environ['HOME']=old
  self.assertEqual(deny,expected,'structural '+name)
  payload=json.dumps(dict(tool_name='Bash',tool_input=dict(command=command),cwd=str(self.cwd),session_id='f3-defect-fixture'))
  r=subprocess.run([sys.executable,'-I','-B',str(ROOT/'scripts/hooks/fail-open.py'),'--fail-closed',str(ROOT/'skills/golem-powers/human-confirm-gate/hooks/human-confirm-pretooluse.py')],input=payload,env=self.env,cwd=self.cwd,text=True,capture_output=True,timeout=20)
  self.assertEqual(r.returncode,2 if expected else 0,'launcher '+name)
  self.assertNotIn('Traceback',r.stderr);self.assertNotIn('golems-fail-open:',r.stderr)
 return test
for name,command,expected in ROWS:setattr(Defects,'test_'+name,case(name,command,expected))
if __name__=='__main__':unittest.main()
