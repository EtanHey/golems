import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import Ajv2020 from 'ajv/dist/2020';
import { parseCensusJsonBytes } from '../lib/worktree-census-lexical';
import { canonicalizeCensusPayload, verifyCensusPayloadDigest } from '../lib/worktree-census-jcs';

const root = new URL('../lib/contracts/cmux-current-census/v1/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const shape = new Ajv2020({ strictTypes: false }).compile(JSON.parse(read('schema.json').toString()));
function parsed(bytes: Uint8Array): any {
  const result = parseCensusJsonBytes(bytes);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('lexical refusal');
  return result.value;
}
function envelope() {
  const value = parsed(read('fixtures/16-partial-kernel-identity.json'));
  expect(shape(value)).toBe(true);
  return value;
}
// Derivative test inputs only: these are not independent producer golden bytes.
function signed() {
  const value = envelope(), { payload_digest: _, ...payload } = value;
  value.payload_digest = `sha256:${hash(Buffer.from(canonicalize(payload)!))}`;
  return value;
}
function bytes(value: any) {
  const result = canonicalizeCensusPayload(value);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('canonicalization refusal');
  return result.canonicalBytes;
}
function reversed(value: any): any {
  if (Array.isArray(value)) return value.map(reversed);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reversed(child)]));
  return value;
}

test('frozen RFC 8785 bytes/hash are independent expected output, outside envelope shape', () => {
  const input = parsed(read('vectors/rfc8785-3.2.2.input.json'));
  expect(shape(input)).toBe(false);
  const actual = Buffer.from(canonicalize(input)!);
  expect(actual).toEqual(read('vectors/rfc8785-3.2.4.canonical.bin'));
  expect(actual.length).toBe(118);
  expect(hash(actual)).toBe('2d5e01a318d0f0879ab568c4be289c8b1f64ef8921a53c6277d5e069978baacb');
});
// RFC8785 Appendix B: expected spellings copied from the published table.
const numbers = [
  ['0000000000000000', '0'], ['8000000000000000', '0'],
  ['0000000000000001', '5e-324'], ['8000000000000001', '-5e-324'],
  ['7fefffffffffffff', '1.7976931348623157e+308'], ['ffefffffffffffff', '-1.7976931348623157e+308'],
  ['4340000000000000', '9007199254740992'], ['c340000000000000', '-9007199254740992'],
  ['4430000000000000', '295147905179352830000'],
  ['44b52d02c7e14af5', '9.999999999999997e+22'], ['44b52d02c7e14af6', '1e+23'],
  ['44b52d02c7e14af7', '1.0000000000000001e+23'],
  ['444b1ae4d6e2ef4e', '999999999999999700000'], ['444b1ae4d6e2ef4f', '999999999999999900000'],
  ['444b1ae4d6e2ef50', '1e+21'], ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
  ['3eb0c6f7a0b5ed8d', '0.000001'], ['41b3de4355555553', '333333333.3333332'],
  ['41b3de4355555554', '333333333.33333325'], ['41b3de4355555555', '333333333.3333333'],
  ['41b3de4355555556', '333333333.3333334'], ['41b3de4355555557', '333333333.33333343'],
  ['becbf647612f3696', '-0.0000033333333333333333'], ['43143ff3c1cb0959', '1424953923781206.2'],
];
for (const [hex, expected] of numbers) test(`RFC number ${hex}: ${expected}`, () => {
  expect(canonicalize(Buffer.from(hex, 'hex').readDoubleBE())).toBe(expected);
});
test('RFC UTF16 sorting orders supplementary characters before higher BMP keys', () => {
  const input = JSON.parse('{"€":"Euro Sign","\\r":"Carriage Return","דּ":"Hebrew Letter Dalet With Dagesh","1":"One","😀":"Emoji: Grinning Face","\\u0080":"Control","ö":"Latin Small Letter O With Diaeresis"}');
  expect(canonicalize(input)).toBe('{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}');
});
for (const input of [NaN, Infinity, -Infinity, '\ud800', { '\udfff': 1 }])
  test('RFC invalid scalar errors explicitly', () => expect(() => canonicalize(input)).toThrow());

test('valid envelope digest proves only payload integrity and preserves input', () => {
  const value = signed(), before = JSON.stringify(value);
  const result = verifyCensusPayloadDigest(value);
  expect(result.valid).toBe(true);
  expect(result.digestVerification).toBe('VERIFIED');
  expect(result.scope).toBe('payload-digest');
  expect(result.issues).toEqual([]);
  expect(result).not.toHaveProperty('eligible');
  expect(result).not.toHaveProperty('status');
  expect(JSON.stringify(value)).toBe(before);
  expect(Buffer.from(result.canonicalBytes).toString()).not.toContain('"payload_digest":');
});
test('recursive object-key permutation preserves canonical bytes/digest', () => {
  const value = signed(), permuted = reversed(value);
  expect(shape(permuted)).toBe(true);
  expect(bytes(permuted)).toEqual(bytes(value));
  expect(verifyCensusPayloadDigest(permuted).valid).toBe(true);
});
test('distinguishable array order stays bound', () => {
  const value = signed(), before = bytes(value);
  expect(value.missing_evidence.length).toBeGreaterThan(1);
  value.missing_evidence.reverse();
  expect(shape(value)).toBe(true);
  expect(bytes(value)).not.toEqual(before);
  expect(verifyCensusPayloadDigest(value).issues).toEqual([{ code: 'DIGEST_MISMATCH', path: '/payload_digest' }]);
});
for (const mutation of ['included', 'null', 'decimal-string', 'unicode']) test(`${mutation} tamper refuses digest`, () => {
  const value = signed();
  if (mutation === 'included') value.consumer_nonce = 'synthetic-other-nonce';
  if (mutation === 'null') value.host_id = 'synthetic-host';
  if (mutation === 'decimal-string') value.collection_started_us = '9007199254740993';
  if (mutation === 'unicode') value.missing_evidence[0].reason = 'é e\u0301 😀';
  expect(shape(value)).toBe(true);
  expect(verifyCensusPayloadDigest(value).digestVerification).toBe('REFUSED');
  expect(verifyCensusPayloadDigest(value).issues).toEqual([{ code: 'DIGEST_MISMATCH', path: '/payload_digest' }]);
});
test('wrong and all-zero placeholder digests fail actual comparison', () => {
  for (const digit of ['0', 'f']) {
    const value = envelope(); value.payload_digest = `sha256:${digit.repeat(64)}`;
    expect(verifyCensusPayloadDigest(value).valid).toBe(false);
    expect(verifyCensusPayloadDigest(value).issues).toEqual([{ code: 'DIGEST_MISMATCH', path: '/payload_digest' }]);
  }
});
test('exclude ONLY top-level digest; nested digest is bound in boundary stress input', () => {
  const value = parsed(Buffer.from('{"payload_digest":"top","nested":{"payload_digest":"nested"},"null":null,"decimal":"9007199254740993","unicode":"é e\\u0301"}'));
  expect(shape(value)).toBe(false);
  expect(Buffer.from(bytes(value)).toString()).toBe('{"decimal":"9007199254740993","nested":{"payload_digest":"nested"},"null":null,"unicode":"é é"}');
  const before = bytes(value); value.payload_digest = 'changed'; expect(bytes(value)).toEqual(before);
  value.nested.payload_digest = 'changed'; expect(bytes(value)).not.toEqual(before);
});
for (const digest of [undefined, null, 1, 'sha256:bad', `sha256:${'A'.repeat(64)}`])
  test('malformed/missing digest refuses explicitly', () => {
    const value = envelope(); value.payload_digest = digest;
    expect(verifyCensusPayloadDigest(value).valid).toBe(false);
    expect(verifyCensusPayloadDigest(value).issues.length).toBeGreaterThan(0);
  });
test('boundary refuses non-JSON values, sparse arrays, cycles, aliases and classes', () => {
  const cycle: any = {}; cycle.self = cycle;
  const shared = {};
  for (const value of [null, [], 1, undefined, { x: undefined }, { x: 1n }, { x: Symbol() },
    { x: () => 1 }, { x: NaN }, { x: Infinity }, { x: '\udfff' }, { '\ud800': 1 },
    { x: new Date() }, { x: new Number(1) }, { x: Array(1) }, cycle, { a: shared, b: shared },
    { [Symbol()]: 1 }, Object.defineProperty({}, 'hidden', { value: 1 })]) {
    expect(canonicalizeCensusPayload(value).ok).toBe(false);
    expect(verifyCensusPayloadDigest(value).valid).toBe(false);
  }
});
test('getters/toJSON/proxies are refused without execution, including excluded digest', () => {
  let calls = 0;
  const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { calls++; return 1; } });
  const digestGetter = Object.defineProperty({}, 'payload_digest', { enumerable: true, get() { calls++; return 'x'; } });
  const proxy = new Proxy({}, { ownKeys() { calls++; return []; }, getPrototypeOf() { calls++; return null; } });
  for (const value of [getter, digestGetter, { x: getter }, proxy, { x: proxy },
    { toJSON() { calls++; return {}; } }]) {
    expect(canonicalizeCensusPayload(value).ok).toBe(false);
    expect(verifyCensusPayloadDigest(value).valid).toBe(false);
  }
  expect(calls).toBe(0);
});
test('parsed prototype-like names and nonfunction toJSON remain ordinary data', () => {
  const value = parsed(Buffer.from('{"__proto__":{"safe":true},"constructor":"data","toJSON":{"x":1},"payload_digest":"omit"}'));
  expect(Buffer.from(bytes(value)).toString()).toBe('{"__proto__":{"safe":true},"constructor":"data","toJSON":{"x":1}}');
});
test('consumer snapshot preserves the frozen RFC bytes and deep-frozen parsed input', () => {
  const value = parsed(read('vectors/rfc8785-3.2.2.input.json'));
  Object.freeze(value.numbers); Object.freeze(value.literals); Object.freeze(value);
  expect(bytes(value)).toEqual(read('vectors/rfc8785-3.2.4.canonical.bin'));
  const valid = signed();
  const freeze = (value: any) => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  };
  freeze(valid);
  expect(verifyCensusPayloadDigest(valid).valid).toBe(true);
});
test('inherited toJSON getters never reach the library snapshot', () => {
  const value = signed();
  let calls = 0, result;
  const saved = [Object.prototype, Array.prototype].map(proto => Object.getOwnPropertyDescriptor(proto, 'toJSON'));
  try {
    for (const proto of [Object.prototype, Array.prototype])
      Object.defineProperty(proto, 'toJSON', { configurable: true, get() { calls++; throw new Error('executed'); } });
    result = verifyCensusPayloadDigest(value);
  } finally {
    [Object.prototype, Array.prototype].forEach((proto, i) => {
      if (saved[i]) Object.defineProperty(proto, 'toJSON', saved[i]!);
      else delete (proto as any).toJSON;
    });
  }
  expect(result!.valid).toBe(true);
  expect(calls).toBe(0);
});
