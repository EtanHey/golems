import { test, expect } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { scanData } from './scan-content.mjs';

// The generic-assignment rule judges the VALUE's shape, never the file type.
const shapes = async text => (await scanData(Buffer.from(text), 'page.html')).shapes;

test.each([
  ['minified pre-increment', 'function f(){let n=0;for(const e of l){token=++n,i=r.slice(0);}}'],
  ['minified property read', 'addEventListener("keydown",e=>{const apiKey=e.key;if(apiKey==="Enter")go()})'],
  ['object property expression', 'var o={secret:a.b,token:t[0],password:p(),api_key:k+1};'],
  ['keywords and numbers', 'const s={token:null,secret:false,pwd:true,access_key:1234567890123456789};'],
  ['long identifier call', 'token=someVeryLongHelperName(n);secret=anotherLongPropertyRoot.child;'],
  ['short quoted code strings', 'if(e.key==="Escape"){token="";secret="a.b"}'],
])('code expression is not a secret: %s', async (_, text) => {
  expect(await shapes(text)).not.toContain('generic-assignment');
});

test.each([
  ['names-only env template', 'ANTHROPIC_API_KEY=\nOPENAI_API_KEY=\nGITHUB_TOKEN=\n'],
  ['export with no value', 'export BAR_TOKEN=\nAPP_ENVIRONMENT=staging\n'],
  ['name list', 'Set FOO_API_KEY, BAR_TOKEN and BAZ_SECRET in your shell.\n'],
  ['clips json of names', JSON.stringify({ needs: ['FOO_API_KEY=', 'BAR_TOKEN='] })],
])('names without a value are not a secret: %s', async (_, text) => {
  expect(await shapes(text)).not.toContain('generic-assignment');
});

test.each([
  ['double quoted', v => `api_key="${v}"`],
  ['single quoted', v => `const cfg = { secret: '${v}' }`],
  ['bare env line', v => `export SERVICE_TOKEN=${v}`],
  ['minified page', v => `!function(){var n=0;token=++n;var k={api_key:"${v}"}}()`],
])('real-shaped synthetic secret still holds: %s', async (_, line) => {
  const value = randomBytes(30).toString('base64url'); // 40 chars, generated per run
  expect(value).toHaveLength(40);
  expect(await shapes(line(value))).toContain('generic-assignment');
});

test('hex secret holds', async () => {
  expect(await shapes(`access_key=${randomBytes(20).toString('hex')}`)).toContain('generic-assignment');
});
test('quoted password with mixed character classes holds', async () => {
  expect(await shapes('db_password: "Sup3rS3cret!"')).toContain('generic-assignment');
});

// Fix round 1 (w271): every key here is credential-named, so a short or symbol
// literal is a password, as master held it. Synthetic values only.
test.each([
  ['bare short password with &', 'password=Tr0ub4dor&3'],
  ['quoted symbol password', 'DB_PASSWORD="p@ss!w0rd#2024"'],
  ['yaml quoted 14 chars, two classes', "secret: 'hunter2hunter2'"],
  ['spaced quoted password', 'pwd = "Summer2024!"'],
  ['quoted 9-char key', "api_key='abc123XYZ'"],
  ['bare 7-char env value', 'password=hunter2'],
  ['bare numeric env value', 'password=12345678'],
  ['exported symbol password', 'export DB_PASSWORD=p@ss!w0rd'],
  ['url query value', 'curl "https://x.example/api?token=abc123def&x=1"'],
  ['cli flag value', 'run --password=Tr0ub4dor'],
  ['yaml list bare value', '- secret: hunter2hunter2'],
  ['symbol literal inside code', 'x;pwd=p@ss!w0rd#2024;'],
])('short or symbol password holds: %s', async (_, text) => {
  expect(await shapes(text)).toContain('generic-assignment');
});

test.each([
  ['pre-increment', 'token=++n'],
  ['member access', 'key=e.key'],
  ['empty env name', 'FOO_API_KEY='],
  ['empty export', 'export BAR_TOKEN='],
  ['call at line start', 'token = getToken()'],
  ['settings member at line start', 'api_key = settings.API_KEY'],
  ['shell expansion', 'TOKEN=${OTHER_TOKEN}'],
  ['shell variable', 'export TOKEN=$OTHER'],
  ['process.env read', 'password=process.env.PW'],
  ['masked placeholder', 'password: ********'],
  ['minified identifiers and operators', 'let token=n,secret=!0,pwd=-1,api_key=a?b:c;'],
  ['quoted prose', 'password: "Enter your password"'],
])('code or reference is not a secret: %s', async (_, text) => {
  expect(await shapes(text)).not.toContain('generic-assignment');
});
