import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/verify-section.mjs', import.meta.url));
const key = 'SYNTHETIC_' + 'RESEARCH_VERIFIER_KEY_123456789';
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
for (const mode of ['success', 'wrong-source', 'missing-init', 'nonzero', 'escaped', 'literal-escape', 'cell-leak', 'key-path', 'symlink', 'fast', 'missing-key']) {
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
if(mode==='nonzero'){process.stdout.write(key);process.stderr.write(key);process.exit(9);}
if(mode==='cell-leak')fs.writeFileSync(p.join(process.env.HOME,'leak.json'),JSON.stringify({value:key}));
if(mode==='key-path')fs.mkdirSync(p.join(process.env.HOME,key));
if(mode==='symlink')fs.symlinkSync('/dev/null',p.join(process.env.HOME,'link'));
const init={type:'system',subtype:'init',fast_mode_state:mode==='fast'?'on':'off',apiKeySource:mode==='wrong-source'?'none':'ANTHROPIC_API_KEY',model:args[args.indexOf('--model')+1]};
let result={type:'result',subtype:'success',is_error:false,result:mode==='literal-escape'?String.fromCharCode(92)+'u0041':mode==='escaped'?key:'verified C1',modelUsage:{[init.model]:{costUSD:0}}};
let text=JSON.stringify([...(mode==='missing-init'?[]:[init]),result]);
if(mode==='escaped')text=text.replace(key,[...key].map(c=>'\\\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''));
process.stdout.write(text);
`, { mode: 0o700 });
      const env = { ...process.env, HOME: home, PATH: bin + path.delimiter + process.env.PATH,
        ANTHROPIC_API_KEY: key, CLAUDE_CODE_OAUTH_TOKEN: 'must-not-reach-child', ANTHROPIC_AUTH_TOKEN: 'must-not-reach-child' };
      if (mode === 'missing-key') delete env.ANTHROPIC_API_KEY;
      const result = spawnSync(process.execPath, [script, '--prompt-file', prompt, '--out', out,
        '--role', 'claude.research.verifier', '--budget-usd', '1'], { env, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, ['success', 'escaped', 'literal-escape'].includes(mode) ? 0 : 1, result.stderr);
      assert.ok(!(result.stdout + result.stderr).includes(key));
      for (const file of files(root)) assert.ok(!readFileSync(file, 'utf8').includes(key), 'key leaked into a kept file');
      if (result.status === 0) {
        const record = JSON.parse(readFileSync(out));
        assert.equal(record.apiKeySource, 'ANTHROPIC_API_KEY');
        assert.equal(record.result.result, mode === 'literal-escape' ? String.fromCharCode(92)+'u0041' : mode === 'escaped' ? '[REDACTED_API_KEY]' : 'verified C1');
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
