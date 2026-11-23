"""Login-preserving CLI flags and honest auth-source receipts; fake model boundary."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

S = Path(os.environ.get('QA_VIDEO_TEST_SCRIPTS', Path(__file__).parents[1]/'scripts'))
spec = importlib.util.spec_from_file_location('reader_r3', S/'claude-image-helper.py')
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)


def test_reader_keeps_user_settings_login(tmp_path):
    cmd = h.command('fixture', tmp_path/'settings.json')
    # Both flags drop the user-settings env block that supplies this host login.
    assert '--setting-sources' not in cmd
    assert '--restricted' not in cmd
    assert '--safe-mode' in cmd
    assert cmd[cmd.index('--tools')+1] == ''
    assert '--strict-mcp-config' in cmd and '--disable-slash-commands' in cmd


@pytest.mark.parametrize('source', ['none', 'user', None])
def test_receipt_preserves_observed_auth_source(tmp_path, monkeypatch, source):
    for key in ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'):
        monkeypatch.delenv(key, raising=False)
    image=tmp_path/'frame.png'; image.write_bytes(b'synthetic')
    h.visual.policy.begin(tmp_path)
    monkeypatch.setenv('QA_VIDEO_ADMISSION', str(h.visual.policy.admit(tmp_path, [image])))
    events=[dict(type='system',subtype='init',model='fixture',apiKeySource=source,
                 tools=[],mcp_servers=[],skills=[],slash_commands=[]),
            dict(type='result',is_error=False,result=json.dumps(dict(images=[dict(path=str(image),finding='white pixel')])))]
    monkeypatch.setattr(h,'run_provider',lambda cmd,**kw:subprocess.CompletedProcess(cmd,0,'\n'.join(map(json.dumps,events)),''))
    monkeypatch.setattr(sys,'argv',['helper','--question','facts','--model','fixture',str(image)])
    assert h.main()==0
    receipt=json.loads(next((tmp_path/'helper-receipts').glob('*.json')).read_text())
    assert 'apiKeySource' in receipt and receipt['apiKeySource'] == source
    assert receipt['auth_route'] == 'cli-session'


@pytest.mark.parametrize('field',['tools','mcp_servers','skills','slash_commands'])
def test_nonempty_init_inventory_is_still_refused(tmp_path,field):
    image=tmp_path/'frame.png'
    init=dict(type='system',subtype='init',tools=[],mcp_servers=[],skills=[],slash_commands=[])
    init[field]=['unexpected']
    with pytest.raises(h.ReaderFailure,match='INIT_INVENTORY'):
        h.observation(json.dumps(init),[image])
