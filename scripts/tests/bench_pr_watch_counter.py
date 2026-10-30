"""Counter load comparison: FX10B_BASELINE=<ref> python3 scripts/tests/bench_pr_watch_counter.py.

Runs 200 pair loops per version, half with four CPU burners, four runners total.
Interleaves versions to share host noise. Timing probes add identical output IO
outside the counter section; samples exclude lock acquisition/wait and unlock.
Raw logs, timing samples, and summary remain in docs.local. No deadline changes.
"""
import concurrent.futures, json, os, statistics, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.setdefault('FX10B_OUTPUT', str(ROOT/'docs.local'/('fx10b-'+str(time.time_ns())))))
OUT.mkdir(parents=True, exist_ok=True)
TESTS=['test_pending_polls_reuse_required_manifest_before_settle','test_pending_polls_are_silent']
if len(sys.argv)>1:
    variant=sys.argv[1]
    source=(OUT/'master.py').read_text() if variant=='master' else (ROOT/'scripts/tests/test_pr_watch.py').read_text()
    ns={'__file__':str(ROOT/'scripts/tests/test_pr_watch.py'),'__name__':'bench_tests'}
    exec(compile(source,ns['__file__'],'exec'),ns)
    cls=ns['PrWatchTests']; original=cls.setUp
    def setup(self):
        original(self)
        gh=self.home/'gh'; s=gh.read_text()
        if variant=='master':
            s=s.replace("n = int((p / 'calls').read_text())", "import time\nstarted = time.perf_counter_ns()\nn = int((p / 'calls').read_text())")
            end="(p / 'calls').write_text(str(n + 1))"
            s=s.replace(end,end+'\nelapsed = time.perf_counter_ns() - started')
        else:
            s=s.replace('    n = int(counter.read_text())','    import time\n    started = time.perf_counter_ns()\n    n = int(counter.read_text())')
            s=s.replace('    os.replace(counter_tmp, counter)','    os.replace(counter_tmp, counter)\n    elapsed = time.perf_counter_ns() - started')
        anchor="with (p / 'argv').open('a')"
        s=s.replace("\n"+anchor, f"\n"+f"with open({str(OUT/(variant+'-timing.txt'))!r}, 'a') as timing: timing.write(str(elapsed) + '\\n')\n"+anchor)
        gh.write_text(s)
    cls.setUp=setup
    import unittest
    result=unittest.TextTestRunner().run(unittest.TestSuite(cls(t) for t in TESTS))
    sys.exit(0 if result.wasSuccessful() else 1)
baseline=os.environ.get('FX10B_BASELINE', '060286d35e8f60635b87f34d6c0c73c997aafc4b')
(OUT/'master.py').write_text(subprocess.check_output(
    ['git', 'show', baseline+':scripts/tests/test_pr_watch.py'], cwd=ROOT, text=True))
results=[]
for load in [False,True]:
    burners=[]
    try:
        if load:
            burners=[subprocess.Popen([sys.executable,'-c','while True: pass']) for _ in range(4)]
        def run(item):
            variant,i=item
            p=subprocess.run([sys.executable,str(Path(__file__).resolve()),variant],capture_output=True,text=True)
            row=dict(variant=variant,loop=i,load=load,returncode=p.returncode,output=p.stdout+p.stderr)
            (OUT/f'{variant}-{int(load)}-{i:03d}.log').write_text(row['output'])
            return row
        # Identical mixed load for both versions, two of each per group of four.
        jobs=[(v,i) for i in range(100) for v in ['master','branch']]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for row in pool.map(run,jobs):
                results.append(row)
                if len(results)%20==0:
                    print(json.dumps(dict(completed=len(results),failed_loops=sum(r['returncode']!=0 for r in results))),flush=True)
    finally:
        for p in burners:p.terminate()
        for p in burners:p.wait()
(OUT/'results.json').write_text(json.dumps(results,indent=2))
summary={}
for v in ['master','branch']:
    rows=[r for r in results if r['variant']==v]
    timings=[int(x)/1e6 for x in (OUT/(v+'-timing.txt')).read_text().splitlines()]
    summary[v]=dict(loops=len(rows),test_executions=2*len(rows),failed_loops=sum(r['returncode']!=0 for r in rows),failures=sum(r['output'].count('\nFAIL:')+r['output'].count('\nERROR:') for r in rows),normal_failed_loops=sum(r['returncode']!=0 for r in rows if not r['load']),loaded_failed_loops=sum(r['returncode']!=0 for r in rows if r['load']),counter_hold_ms=dict(samples=len(timings),median=statistics.median(timings),max=max(timings)))
(OUT/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2),flush=True)
