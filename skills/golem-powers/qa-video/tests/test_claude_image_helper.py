"""No model calls: exercise the attached-image adapter and batch contract."""
import importlib.util
import json
from pathlib import Path
import pytest
S=Path(__file__).parents[1]/'scripts'
def load(name,file):
 s=importlib.util.spec_from_file_location(name,S/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
helper=load('claude_helper','claude-image-helper.py');batch=load('batch_claude','visual-batch.py')
def events(image,tools=None,tool=False,error=False):
 return '\n'.join(json.dumps(x) for x in [
  {'type':'system','subtype':'init','tools':tools or [],'mcp_servers':[],'skills':[],'slash_commands':[]},
  {'type':'assistant','message':{'content':[{'type':'tool_use'}] if tool else []}},
  {'type':'result','is_error':error,'result':json.dumps({'images':[{'path':str(image),'finding':'tile 0: blue square'}]})}])
def test_attached_payload_has_no_read_or_auth(tmp_path):
 image=tmp_path/'a.png';image.write_bytes(b'png')
 data=json.loads(helper.payload([image],'facts'));assert data['message']['content'][0]['source']['data']=='cG5n'
 cmd=helper.command('claude-haiku-5-5',tmp_path/'settings.json')
 assert cmd[cmd.index('--tools')+1]=='' and '--no-session-persistence' not in cmd
 assert 'Read' not in cmd
@pytest.mark.parametrize('tools,tool,error',[(['Read'],False,False),([],True,False),([],False,True)])
def test_offered_or_called_tools_and_error_fail(tmp_path,tools,tool,error):
 with pytest.raises(ValueError):helper.observation(events(tmp_path/'a.png',tools,tool,error),[tmp_path/'a.png'])
def test_output_uses_batch_contract(tmp_path):
 image=tmp_path/'a.png'
 init,result,found=helper.observation(events(image),[image])
 assert init['tools']==[]
 text='Coverage: 1/1; complete; 0 image findings omitted by output cap.\n'+str(image)+': '+found[str(image)]
 assert batch.validate({'sheet':str(image),'finding':text,'ok':True},1)['state']=='READ'

def test_cli_success_retains_receipt_and_private_temp(tmp_path,monkeypatch,capsys):
 import subprocess
 image=tmp_path/'a.png';image.write_bytes(b'synthetic PNG bytes')
 model='claude-haiku-5-5'
 seen=[]
 def fake_run(cmd,**kw):
  seen.append((cmd,kw))
  assert kw['env']['CLAUDE_CODE_TMPDIR']==kw['env']['TMPDIR']
  assert str(tmp_path) in kw['env']['HOME']
  ev=[json.loads(x) for x in events(image).splitlines()]
  ev[0]['model']=model
  return subprocess.CompletedProcess(cmd,0,'\n'.join(json.dumps(x) for x in ev),'')
 monkeypatch.setattr(helper,'run_provider',fake_run)
 monkeypatch.setattr(helper.sys,'argv',['helper','--question','facts','--model',model,str(image)])
 assert helper.main()==0
 output=capsys.readouterr()
 assert 'Coverage: 1/1; complete;' in output.out
 receipt=json.loads(next((tmp_path/'helper-receipts').glob('*.json')).read_text())
 assert receipt['init']['tools']==[] and receipt['exit_code']==0
 assert len(seen)==1

def test_cli_failed_provider_is_not_a_read(tmp_path,monkeypatch,capsys):
 import subprocess
 image=tmp_path/'a.png';image.write_bytes(b'png')
 monkeypatch.setattr(helper,'run_provider',lambda *a,**k:subprocess.CompletedProcess([],1,'','auth failed'))
 monkeypatch.setattr(helper.sys,'argv',['helper','--question','facts','--model','claude-haiku-5-5',str(image)])
 assert helper.main()==2
 assert 'Coverage: 0/1; partial;' in capsys.readouterr().out
 receipt=json.loads(next((tmp_path/'helper-receipts').glob('*.json')).read_text())
 assert receipt['exit_code']==1 and receipt['failure']=='PROVIDER_EXIT'
