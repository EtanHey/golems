"""Frozen conditional-path writer rows: classify/JSON only; never execute candidates."""
import hashlib,json,os,subprocess,sys,unittest,tempfile
from pathlib import Path
ROOT=Path(os.environ.get('GUARD_ROOT',Path(__file__).resolve().parents[4])).resolve()
assert (ROOT/'skills/golem-powers/human-confirm-gate/hooks/human-confirm-pretooluse.py').is_file()
sys.path.append(str(ROOT/'skills/golem-powers/human-confirm-gate/hooks'))
from commands import operations
FIXTURE=Path(__file__).resolve().parent/'fixtures/f3-conditional-path-writer.json'
assert hashlib.sha256(FIXTURE.read_bytes()).hexdigest()=='a4a7b877789f94d5dd2ee9673bd640f393d22667ff8faafe499ef5fcf833204f'
ROWS=[(r['id'],r['command'],r['deny']) for r in json.loads(FIXTURE.read_text())['rows']]
assert len(ROWS)==7 and {'data_word_default_writer','data_word_unset_writer'}<={r[0] for r in ROWS}
class Writers(unittest.TestCase):
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
for name,command,expected in ROWS:setattr(Writers,'test_'+name,case(name,command,expected))
if __name__=='__main__':unittest.main()
