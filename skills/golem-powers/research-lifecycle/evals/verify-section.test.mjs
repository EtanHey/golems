import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/verify-section.mjs', import.meta.url));
const key = 'SYNTHETIC_' + 'RESEARCH_VERIFIER_KEY_123456789';
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
for (const mode of ['success', 'symlink-launch', 'auxiliary', 'unknown-auxiliary', 'wrong-primary', 'key-denied', 'wrong-source', 'missing-init', 'nonzero', 'escaped', 'literal-escape', 'cell-leak', 'key-path', 'symlink', 'fast', 'missing-key']) {
  test('API-key verifier boundary: ' + mode, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'research-auth-test-'));
    try {
      const bin = path.join(root, 'bin'), home = path.join(root, 'home');
      mkdirSync(bin); mkdirSync(home);
      const prompt = path.join(root, 'prompt.md'), out = path.join(root, 'out', 'section.json');
      writeFileSync(prompt, 'Check fixed claims C1 and C2 with the section rubric.');
      writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env node
const fs=require('node:fs'),p=require('node:path');
const mode=${JSON.stringify(mode)}, key=process.env.ANTHROPIC_API_KEY, args=process.argv.slice(2);
if(process.env.CLAUDE_CODE_OAUTH_TOKEN||process.env.ANTHROPIC_AUTH_TOKEN)process.exit(12);
if(args[args.indexOf('--allowedTools')+1]!=='Read,Grep,Glob,WebSearch,WebFetch'||!args.includes('--strict-mcp-config')||!args.includes('--restricted'))process.exit(13);
const settings=JSON.parse(fs.readFileSync(args[args.indexOf('--settings')+1]));
const realHome=${JSON.stringify(home)}, cell=process.env.HOME;
for(const tool of ['Read','Grep','Glob'])for(const target of ['.config/**','.ssh/**','.codex/**','.claude/**','.claude.json','.config/golems/anthropic-api.env'])if(!settings.permissions?.deny?.includes(tool+'(/'+p.join(realHome,target)+')'))process.exit(14);
for(const tool of ['Read','Grep','Glob'])if(!settings.permissions.deny.includes(tool+'(/'+p.join(cell,'**')+')'))process.exit(15);
if(process.cwd()!==fs.realpathSync(cell))process.exit(16);
if(mode==='nonzero'){process.stdout.write(key);process.stderr.write(key);process.exit(9);}
if(mode==='cell-leak')fs.writeFileSync(p.join(process.env.HOME,'leak.json'),JSON.stringify({value:key}));
if(mode==='key-path')fs.mkdirSync(p.join(process.env.HOME,key));
if(mode==='symlink')fs.symlinkSync('/dev/null',p.join(process.env.HOME,'link'));
const init={type:'system',subtype:'init',fast_mode_state:mode==='fast'?'on':'off',apiKeySource:mode==='wrong-source'?'none':'ANTHROPIC_API_KEY',model:args[args.indexOf('--model')+1]};
let result={type:'result',subtype:'success',is_error:false,result:mode==='literal-escape'?String.fromCharCode(92)+'u0041':mode==='escaped'?key:'verified C1',modelUsage:{[init.model]:{costUSD:0}}};
if(mode==='auxiliary'||mode==='unknown-auxiliary')result.modelUsage[mode==='auxiliary'?'claude-haiku-5-5':'unapproved-helper']={costUSD:0};
const assistant={type:'assistant',message:{model:mode==='wrong-primary'?'unapproved-primary':init.model,content:[{type:'text',text:'checked'}]}};
if(mode==='key-denied')result.permission_denials=[{tool_name:'Read',tool_input:{file_path:p.join(realHome,'.config/golems/anthropic-api.env')}}];
let text=JSON.stringify([...(mode==='missing-init'?[]:[init]),assistant,result]);
if(mode==='escaped')text=text.replace(key,[...key].map(c=>'\\\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''));
process.stdout.write(text);
`, { mode: 0o700 });
      const env = { ...process.env, HOME: home, PATH: bin + path.delimiter + process.env.PATH,
        ANTHROPIC_API_KEY: key, CLAUDE_CODE_OAUTH_TOKEN: 'must-not-reach-child', ANTHROPIC_AUTH_TOKEN: 'must-not-reach-child' };
      if (mode === 'missing-key') delete env.ANTHROPIC_API_KEY;
      const entry=mode==='symlink-launch'?path.join(root,'verify-link.mjs'):script;
      if(mode==='symlink-launch')symlinkSync(script,entry);
      const result = spawnSync(process.execPath, [entry, '--prompt-file', prompt, '--out', out,
        '--role', mode==='auxiliary'||mode==='unknown-auxiliary'?'claude.judgment':'claude.research.verifier', '--budget-usd', '1'], { env, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, ['success', 'symlink-launch', 'auxiliary', 'escaped', 'literal-escape', 'key-denied'].includes(mode) ? 0 : 1, result.stderr);
      assert.ok(!(result.stdout + result.stderr).includes(key));
      const cells=path.join(home,'.local/share/research-verifier-cells');
      assert.deepEqual(existsSync(cells)?readdirSync(cells):[], [], 'owned cell not cleaned');
      for (const file of files(root)) assert.ok(!readFileSync(file, 'utf8').includes(key), 'key leaked into a kept file');
      if (result.status === 0) {
        const record = JSON.parse(readFileSync(out));
        if(mode==='key-denied')assert.equal(record.result.permission_denials[0].tool_name,'Read');
        assert.equal(record.apiKeySource, 'ANTHROPIC_API_KEY');
        assert.equal(record.result.result, mode === 'literal-escape' ? String.fromCharCode(92)+'u0041' : mode === 'escaped' ? '[REDACTED_API_KEY]' : 'verified C1');
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

// A copied skill must fail by name rather than silently skipping its entry point.
test('copied install requires the checkout registry', () => {
  const root=mkdtempSync(path.join(tmpdir(),'research-copy-test-'));
  try {
    const entry=path.join(root,'verify-section.mjs');copyFileSync(script,entry);
    const result=spawnSync(process.execPath,[entry,'--role','claude.research.verifier','--prompt-file',path.join(root,'prompt'),'--out',path.join(root,'out.json'),'--budget-usd','1'],{env:{...process.env,ANTHROPIC_API_KEY:key},encoding:'utf8'});
    assert.equal(result.status,1);
    assert.equal(result.stderr.trim(),'research verifier failed: GOLEMS_CHECKOUT_REQUIRED');
    assert.ok(!existsSync(path.join(root,'out.json')));
  } finally {rmSync(root,{recursive:true,force:true});}
});
