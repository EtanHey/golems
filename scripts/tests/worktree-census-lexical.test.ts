import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { parseCensusJsonBytes } from '../lib/worktree-census-lexical';
import { validateCensusCoreRelations } from '../lib/worktree-census-core';

const encode = (text: string) => new TextEncoder().encode(text);
const parse = (text: string) => parseCensusJsonBytes(encode(text));
const root = new URL('../lib/contracts/cmux-current-census/v1/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root));
const fixture = (name: string) => parseCensusJsonBytes(read(`fixtures/${name}.json`));
const shape = new Ajv2020({ strictTypes: false }).compile(JSON.parse(read('schema.json').toString()));
function value(result: ReturnType<typeof parse>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected lexical success');
  return result.value;
}
function rejects(text: string, code: string) {
  expect(parse(text)).toEqual({ ok: false, code });
}

test('valid frozen01 parses without a status or digest claim', () => {
  const result = fixture('01-unavailable');
  expect(value(result)).toEqual(JSON.parse(read('fixtures/01-unavailable.json').toString()));
  expect(result).not.toHaveProperty('status');
  expect(result).not.toHaveProperty('digestVerification');
});
test('frozen raw13 rejects duplicate keys before lossy parsing', () => {
  expect(fixture('13-duplicate-keys.raw')).toEqual({ ok: false, code: 'DUPLICATE_KEY' });
});
test('escape aliases compare decoded keys inside each object', () => {
  rejects(String.raw`{"status":1,"\u0073tatus":2}`, 'DUPLICATE_KEY');
  rejects('{"😀":1,"\\ud83d\\ude00":2}', 'DUPLICATE_KEY');
  rejects('{"outer":{"x":1,"x":2}}', 'DUPLICATE_KEY');
  expect(value(parse('{"a":{"x":1},"b":{"x":2}}'))).toEqual({ a: { x: 1 }, b: { x: 2 } });
});
test('escaped backslashes and Unicode normalization do not create aliases', () => {
  const text = String.raw`{"status":1,"\\u0073tatus":2,"é":3,"e\u0301":4}`;
  expect(value(parse(text))).toEqual(JSON.parse(text));
});
test('strings preserve escapes and paired Unicode scalars', () => {
  const text = String.raw`{"\ud83d\ude00":"\u0000\b\f\n\r\t\/\\\"${'é😀'}"}`;
  expect(value(parse(text))).toEqual(JSON.parse(text));
  expect(value(parse(String.raw`"\ud800\udc00"`))).toBe('𐀀');
});
for (const escape of ['\\ud800', '\\udfff', '\\udc00\\ud800', '\\ud800x', '\\ud800\\ud800']) {
  test(`lone/reversed surrogate rejects in keys and values: ${escape}`, () => {
    rejects(`"${escape}"`, 'UNICODE_SCALAR');
    rejects(`{"x":["${escape}"]}`, 'UNICODE_SCALAR');
    rejects(`{"${escape}":0}`, 'UNICODE_SCALAR');
  });
}
test('fatal UTF-8 rejects malformed, overlong, truncated and encoded surrogate bytes', () => {
  for (const bytes of [[0xff], [0xc0, 0xaf], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0x22, 0xff, 0x22]]) {
    expect(parseCensusJsonBytes(new Uint8Array(bytes))).toEqual({ ok: false, code: 'UTF8' });
  }
});
for (const text of ['', ' ', 'undefined', 'NaN', 'Infinity', '-Infinity', '01', '-01', '+1', '.1',
  '1.', '1e', '1e+', '--1', '[1,]', '{"x":1,}', '{x:1}', '{"x" 1}', '[1 2]', '{}{}',
  String.raw`"\x20"`, String.raw`"\u12xz"`, String.raw`"\u{1f600}"`, '"\u0000"', '"\n"', '"unterminated', 'true false', '[}', '{]']) {
  test(`malformed JSON rejects ${JSON.stringify(text)}`, () => rejects(text, 'JSON_SYNTAX'));
}
for (const number of ['1e400', '-1e400']) {
  test(`nonfinite parsed number rejects ${number}`, () => rejects(`[${number}]`, 'NONFINITE_NUMBER'));
}
test('any JSON value and finite numbers remain outside schema bounds', () => {
  for (const text of ['null', 'true', 'false', '"text"', '-0', '1.25e-2', '1e308', '1e-400',
    '9007199254740992', '[]', '{}', ' \t\r\n[1,null,false,{"a":[]}]\n']) {
    expect(value(parse(text))).toEqual(JSON.parse(text));
  }
});
test('exact 16 MiB wire cap accepts minimal JSON plus padding; cap+1 rejects', () => {
  const bytes = new Uint8Array(16_777_216).fill(0x20); bytes[0] = 0x30;
  expect(value(parseCensusJsonBytes(bytes))).toBe(0);
  const larger = new Uint8Array(bytes.length + 1).fill(0x20); larger[0] = 0x30;
  expect(parseCensusJsonBytes(larger)).toEqual({ ok: false, code: 'SIZE' });
});
test('strict local BOM policy exposes and rejects a leading UTF-8 BOM', () => {
  expect(parseCensusJsonBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x30])))
    .toEqual({ ok: false, code: 'BOM' });
  expect(value(parse('"\ufeff"'))).toBe('\ufeff');
  rejects(' \ufeff0', 'JSON_SYNTAX');
});
test('deep bounded arrays and objects parse iteratively; malformed nesting returns diagnostics', () => {
  for (const [open, close] of [['[', ']'], ['{"a":', '}']]) {
    const depth = 30_000, text = open.repeat(depth) + '0' + close.repeat(depth);
    let cursor: any = value(parse(text));
    for (let i = 0; i < depth; i++) cursor = open === '[' ? cursor[0] : cursor.a;
    expect(cursor).toBe(0);
    rejects(text.slice(0, -1), 'JSON_SYNTAX');
    rejects(open.repeat(depth) + '0' + (close === ']' ? '}' : ']'), 'JSON_SYNTAX');
  }
});
test('__proto__ and constructor preserve ordinary own-property semantics', () => {
  const text = '{"__proto__":{"polluted":true},"constructor":1,"toString":2}';
  const object: any = value(parse(text));
  expect(Object.getPrototypeOf(object)).toBe(Object.prototype);
  expect(Object.hasOwn(object, '__proto__')).toBe(true);
  expect(object.__proto__).toEqual({ polluted: true });
  expect(object.polluted).toBeUndefined();
  expect(object).toEqual(JSON.parse(text));
  rejects('{"__proto__":1,"__proto__":2}', 'DUPLICATE_KEY');
});
test('frozen12 passes lexical parsing then fails unchanged schema', () => {
  expect(shape(value(fixture('12-unknown-member')))).toBe(false);
});
test('frozen04 passes lexical and shape boundaries then fails unchanged B core', () => {
  const parsed = value(fixture('04-duplicate-final-identity'));
  expect(shape(parsed)).toBe(true);
  const result = validateCensusCoreRelations(parsed);
  expect(result.valid).toBe(false);
  expect(result.issues.map(issue => issue.code)).toContain('FINAL_IDENTITY');
  expect(result.digestVerification).toBe('UNVERIFIED');
});
test('diagnostics disclose no payload, key, value or parser exception', () => {
  rejects('{"synthetic-private-key":1,"synthetic-private-key":2}', 'DUPLICATE_KEY');
  rejects('{"synthetic-private-key":"synthetic-private-value",}', 'JSON_SYNTAX');
});
