"""Final re-check regressions, synthetic frames and fake provider only."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

S = Path(__file__).parents[1]/'scripts'


def crop_run(tmp_path, count, crops):
    from test_reader_login import fixture
    home, frame, env = fixture(tmp_path)
    dense=tmp_path/'dense'; dense.mkdir()
    for i in range(count):
        (dense/f'sheet-{i}.png').write_bytes(frame.read_bytes())
    (dense/'index.tsv').write_text(''.join(f'sheet-{i}.png\t0\t1\t1\tfixture\n' for i in range(count)))
    images=[tmp_path/f'crop-{i}.png' for i in range(crops)]
    for image in images:
        image.write_bytes(frame.read_bytes())
    # Crop tile metadata, independent of the whole-run dense index.
    (tmp_path/'index.tsv').write_text(''.join(f'{image.name}\t0\t1\t1\tcrop\n' for image in images))
    plan=subprocess.run(['bash',str(S/'default.sh'),'plan','/unused.mov',str(tmp_path)],
                        env=env,capture_output=True,text=True)
    assert plan.returncode==0,plan.stderr
    env['RUN_STEP_FOREGROUND']='1'
    result=subprocess.run(['bash',str(S/'default.sh'),'gather',str(tmp_path),'','crop-03',*map(str,images)],
                          env=env,capture_output=True,text=True,timeout=15)
    return home,images,result,json.loads((tmp_path/'visual/cost-admission.json').read_text())


def test_explicit_crop_gather_admits_index_and_crop(tmp_path):
    home,images,result,admission=crop_run(tmp_path,4,1)
    assert result.returncode==0,result.stdout+result.stderr
    assert len(admission['sheets'])==5 and str(images[0]) in admission['sheets']
    assert admission['estimated_usd']==.5 and admission['status']=='ADMITTED'
    summary=json.loads((tmp_path/'visual-crop-03/visual/summary.json').read_text())
    assert summary['counts']['READ']==1 and summary['status']=='COMPLETE'
    assert (home/'called').exists()


def test_explicit_crops_still_hold_whole_run_above_five(tmp_path):
    home,images,result,admission=crop_run(tmp_path,49,2)
    assert result.returncode!=0
    assert len(admission['sheets'])==51 and admission['estimated_usd']==5.1
    assert admission['status']=='COST_HOLD'
    assert '51 sheets x $0.10 = $5.10' in result.stderr
    assert not (home/'called').exists()
    assert not (tmp_path/'logs/crop-03.pid').exists()


@pytest.mark.parametrize('plugins,expected',[
    ([{'name':'fixture-reader','version':'1','path':'/synthetic/private/path'}],['fixture-reader']),
    (['fixture-reader'],['fixture-reader']),
])
def test_plugin_names_are_recorded_without_refusal(tmp_path,monkeypatch,plugins,expected):
    spec=importlib.util.spec_from_file_location('reader_r4',S/'claude-image-helper.py')
    h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
    image=tmp_path/'image.png';image.write_bytes(b'synthetic')
    h.visual.policy.begin(tmp_path)
    monkeypatch.setenv('QA_VIDEO_ADMISSION',str(h.visual.policy.admit(tmp_path,[image])))
    events=[dict(type='system',subtype='init',model='fixture',tools=[],mcp_servers=[],skills=[],slash_commands=[],plugins=plugins),
            dict(type='result',is_error=False,result=json.dumps(dict(images=[dict(path=str(image),finding='white pixel')])))]
    monkeypatch.setattr(h,'run_provider',lambda cmd,**kw:subprocess.CompletedProcess(cmd,0,'\n'.join(map(json.dumps,events)),''))
    monkeypatch.setattr(sys,'argv',['helper','--question','facts','--model','fixture',str(image)])
    assert h.main()==0
    receipt=json.loads(next((tmp_path/'helper-receipts').glob('*.json')).read_text())
    assert receipt['startup_inventory']['plugins']==expected
    assert 'private/path' not in json.dumps(receipt['startup_inventory'])
    assert receipt['read_count']==1


@pytest.mark.parametrize('args',[['invalid-mode'],['debrief','--invalid-flag']])
@pytest.mark.parametrize('existing',[False,True])
def test_invalid_plan_leaves_workdir_untouched(tmp_path,args,existing):
    work=tmp_path/'work'
    if existing:
        (work/'visual').mkdir(parents=True)
        (work/'visual/run.json').write_text('{"run_id":"existing-run"}')
        (work/'visual/cost-admission.json').write_text('{"status":"ADMITTED"}')
    before={str(p.relative_to(work)):p.read_bytes() for p in work.rglob('*') if p.is_file()}
    result=subprocess.run(['bash',str(S/'default.sh'),'plan','/unused.mov',str(work),*args],capture_output=True,text=True)
    assert result.returncode==2
    after={str(p.relative_to(work)):p.read_bytes() for p in work.rglob('*') if p.is_file()}
    assert after==before
    assert work.exists()==existing
