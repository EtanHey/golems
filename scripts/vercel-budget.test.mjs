import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBudget } from './vercel-budget.mjs';
const now = 1800000000000;
const deployments = n => Array.from({length:n}, (_, i) => ({uid:`d${i}`,name:i%2?'beta':'alpha'}));
const page = (n, next=null) => ({deployments:deployments(n),pagination:{next}});
async function run(pages) {
  const calls=[], output=[];
  const code=await runBudget({token:'fixture-token',now,fetch:async (url, options)=>{
    calls.push([new URL(url),options]);
    const body=pages.shift();
    return {ok:body!==null,status:503,json:async()=>body};
  },log:s=>output.push(s)});
  return {code,calls,output};
}
for (const [n,code,status] of [[0,0,'OK'],[59,0,'OK'],[60,3,'SOFT-LIMIT'],[99,3,'SOFT-LIMIT'],[100,4,'AT-CAP'],[101,4,'AT-CAP']]) {
  test(`budget ${n}`,async()=>{
    const r=await run([page(n)]);
    assert.equal(r.code,code);
    assert.equal(r.output[0],`vercel-budget: ${n}/100 (soft 60) ${status}`);
  });
}
test('pagination keeps fixed window and counts projects including duplicates once',async()=>{
  const r=await run([page(2,now-1000),{deployments:[{uid:'d2',name:'alpha'},{uid:'d1',name:'beta'}],pagination:{next:null}}]);
  assert.equal(r.code,0);
  assert.equal(r.output[0],'vercel-budget: 3/100 (soft 60) OK');
  assert.deepEqual(r.output.slice(1),['  alpha: 2','  beta: 1']);
  assert.equal(r.calls.length,2);
  for(const [url,options] of r.calls){
    assert.equal(url.pathname,'/v6/deployments');
    assert.equal(url.searchParams.get('since'),String(now-86400000));
    assert.equal(url.searchParams.get('teamId'),'team_QUz2CYVyqnNzeuj3h9lfY3tF');
    assert.equal(options.method,'GET');
  }
  assert.equal(r.calls[1][0].searchParams.get('until'),String(now-1000));
});
for(const [name,pages] of [['API error',[null]],['partial API error',[page(2,now-1),null]],['malformed',[{}]],['bad cursor',[page(1,now+1)]],['repeated cursor',[page(1,now-1),page(1,now-1)]]]) {
  test(name,async()=>{const r=await run(pages);assert.equal(r.code,2);assert.match(r.output[0],/^vercel-budget: ERROR/);assert.ok(!r.output.join('').includes('fixture-token'));});
}
