"""Conditional path-prefix fixtures: classify/JSON only; never execute candidates."""
ROWS=[('minimal_quoted', 'q=/opt/fixture && "$q/tool.sh"', False),
 ('minimal_unquoted', 'q=/opt/fixture && $q/tool.sh', False),
 ('prior_and', 'true && q=/opt/fixture && "$q/tool.sh"', False),
 ('middle_commands',
  'true && q=/opt/fixture && mkdir -p "$q" && cat > "$q/tool.sh" <<\'DATA\'\n'
  'literal data\n'
  'DATA\n'
  'chmod +x "$q/tool.sh" && "$q/tool.sh"',
  False),
 ('braced_prefix', 'q=/opt/fixture && "${q}/tool.sh"', False),
 ('unconditional_prefix', 'q=/opt/fixture; "$q/tool.sh"', False),
 ('chain_newline', 'q=/opt/fixture && true; "$q/tool.sh"', False),
 ('prior_unknown', 'read -r q; q=/opt/fixture && "$q/tool.sh"', True),
 ('guarded_args', 'q=/opt/fixture && "$q/tool.sh" push --force origin topic', True),
 ('old_guarded_value',
  'q="fixture-tool push --force origin topic"; false && q=/opt/fixture && "$q/tool.sh"',
  True),
 ('whole_value', 'q=/opt/fixture && "$q"', True),
 ('unknown_value', 'read -r q; "$q/tool.sh"', True),
 ('conditional_unknown', 'true && q=$(printf data) && "$q/tool.sh"', True),
 ('operator_prefix', 'q=/opt/fixture && "${q:-}/tool.sh"', True),
 ('or_chain', 'false && q=/opt/fixture || "$q/tool.sh"', True),
 ('semicolon_boundary', 'read -r q; false && q=/opt/fixture; "$q/tool.sh"', True),
 ('background_boundary', 'q=/opt/fixture & "$q/tool.sh"', True),
 ('pipeline_boundary', 'q=/opt/fixture | "$q/tool.sh"', True),
 ('scope_boundary', 'if true; then q=/opt/fixture; fi; "$q/tool.sh"', True),
 ('temporary_assignment', 'read -r q; q=/opt/fixture true && "$q/tool.sh"', True),
 ('dynamic_writer', 'q=/opt/fixture && read -r q && "$q/tool.sh"', True),
 ('unmodelled_middle', 'q=/opt/fixture && fixture-writer && "$q/tool.sh"', True),
 ('unknown_ifs', 'read IFS; q=/opt/fixture && "$q/tool.sh"', True),
 ('splitting_ifs', 'IFS=/; q=/opt/fixture && "$q/tool.sh"', True),
 ('space_value', 'q="/opt/fixture data" && "$q/tool.sh"', True),
 ('unknown_guarded_args', 'read -r q; "$q/tool.sh" push --force origin topic', True)]
import json,os,subprocess,sys,unittest,tempfile
from pathlib import Path
ROOT=Path(os.environ.get('GUARD_ROOT',Path(__file__).resolve().parents[4])).resolve()
assert (ROOT/'skills/golem-powers/human-confirm-gate/hooks/human-confirm-pretooluse.py').is_file()
sys.path.append(str(ROOT/'skills/golem-powers/human-confirm-gate/hooks'))
from commands import operations
class Prefixes(unittest.TestCase):
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
  with self.subTest(path='classifier'):self.assertEqual(deny,expected,'structural '+name)
  payload=json.dumps(dict(tool_name='Bash',tool_input=dict(command=command),cwd=str(self.cwd),session_id='f3-defect-fixture'))
  r=subprocess.run([sys.executable,'-I','-B',str(ROOT/'scripts/hooks/fail-open.py'),'--fail-closed',str(ROOT/'skills/golem-powers/human-confirm-gate/hooks/human-confirm-pretooluse.py')],input=payload,env=self.env,cwd=self.cwd,text=True,capture_output=True,timeout=20)
  with self.subTest(path='launcher'):self.assertEqual(r.returncode,2 if expected else 0,'launcher '+name)
  self.assertNotIn('Traceback',r.stderr);self.assertNotIn('golems-fail-open:',r.stderr)
 return test
for name,command,expected in ROWS:setattr(Prefixes,'test_'+name,case(name,command,expected))
if __name__=='__main__':unittest.main()
