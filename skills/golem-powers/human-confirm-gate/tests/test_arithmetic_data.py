"""Arithmetic data positions: classifier/JSON only, never execute candidates."""
ROWS=[('minimal_length', 'items=(); if ((${#items[@]})); then echo data; fi', False),
 ('standalone_length', 'items=(); ((${#items[@]}))', False),
 ('length_compare', 'items=(); if (( ${#items[@]} > 0 )); then echo data; fi', False),
 ('star_length', 'items=(); if ((${#items[*]})); then echo data; fi', False),
 ('while_length', 'items=(); while ((${#items[@]})); do break; done', False),
 ('until_length', 'items=(); until ((${#items[@]})); do break; done', False),
 ('multiline_length', 'items=(); if ((\n ${#items[@]}\n)); then echo data; fi', False),
 ('scalar_length', 'read -r item; if ((${#item})); then echo data; fi', False),
 ('numeric_control', 'n=1; ((n+=1)); echo "$n"', False),
 ('arithmetic_expansion_data', 'echo "$((1+2))"', False),
 ('quoted_arithmetic_data', 'items=(); echo "(( ${#items[@]} ))"', False),
 ('nested_protected', '(( $(fixture-tool push --force origin topic) ))', True),
 ('length_nested_protected',
  'items=(); (( ${#items[@]} + $(fixture-tool push --force origin topic) ))',
  True),
 ('nested_backtick_protected', '(( `fixture-tool push --force origin topic` ))', True),
 ('hidden_nested_protected', 'F="fixture-tool push --force origin topic"; (( $($F) ))', True),
 ('whole_array', 'F=(fixture-tool push --force origin topic); "${F[@]}"', True),
 ('unknown_array', 'readarray F; "${F[@]}"', True),
 ('spaced_subshell_length', 'items=(); ( ( ${#items[@]} ) )', True),
 ('quoted_arithmetic_binding', 'items=(); F="(( ${#items[@]} ))"; ${F:-}', True),
 ('quoted_arithmetic_binding_args', 'items=(); F="(( ${#items[@]} ))"; $F --version', False),
 ('after_arithmetic_whole',
  'F="fixture-tool push --force origin topic"; items=(); ((${#items[@]})); ${F:-}',
  True)]
import json,os,subprocess,sys,unittest,tempfile
from pathlib import Path
ROOT=Path(os.environ.get('GUARD_ROOT',Path(__file__).resolve().parents[4])).resolve()
assert (ROOT/'skills/golem-powers/human-confirm-gate/hooks/human-confirm-pretooluse.py').is_file()
sys.path.append(str(ROOT/'skills/golem-powers/human-confirm-gate/hooks'))
from commands import operations
class Arithmetic(unittest.TestCase):
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
for name,command,expected in ROWS:setattr(Arithmetic,'test_'+name,case(name,command,expected))
actual=json.loads((ROOT/'skills/golem-powers/human-confirm-gate/tests/fleet_commands.json').read_text())[3062]
assert actual['expected']=='allow'
assert __import__('hashlib').sha256(actual['command'].encode()).hexdigest()=='8e95c6534dae5ef91531e4d063c86a8bbef5299685f0183fb22bdfbae209e1eb'
setattr(Arithmetic,'test_actual_public3062',case('actual_public3062',actual['command'],False))
if __name__=='__main__':unittest.main()
