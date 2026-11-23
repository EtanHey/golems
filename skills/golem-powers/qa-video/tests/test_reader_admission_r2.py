"""Real CLI admission refusal, runnable against a copied baseline script tree."""
import os
from pathlib import Path
import subprocess
import sys

S = Path(os.environ.get('QA_VIDEO_TEST_SCRIPTS', Path(__file__).parents[1]/'scripts'))


def test_helper_requires_whole_run_admission(tmp_path):
    image=tmp_path/'frame.png'; image.write_bytes(b'synthetic')
    bindir=tmp_path/'bin'; bindir.mkdir()
    cli=bindir/'claude'
    cli.write_text('#!'+sys.executable+'\nfrom pathlib import Path\nPath(__file__).with_name("called").touch()\nraise SystemExit(1)\n')
    cli.chmod(0o700)
    env={k:os.environ[k] for k in os.environ if not k.startswith('ANTHROPIC_') and k not in ('QA_VIDEO_ADMISSION','CLAUDE_CODE_OAUTH_TOKEN')}
    env['PATH']=str(bindir)+os.pathsep+env.get('PATH','')
    result=subprocess.run([sys.executable,str(S/'claude-image-helper.py'),'--model','fixture','--question','facts',str(image)],env=env,capture_output=True,text=True,timeout=5)
    assert result.returncode != 0
    assert 'COST_ADMISSION_REQUIRED' in result.stderr
    assert not (bindir/'called').exists()
