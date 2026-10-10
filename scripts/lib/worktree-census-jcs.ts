import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { types } from 'node:util';

export type CensusJcsIssue = { code: 'NON_JSON_INPUT' | 'JCS_ERROR' | 'DIGEST_FORMAT' | 'DIGEST_MISMATCH'; path: string };
type Payload = { ok: true; canonicalBytes: Uint8Array; computedDigest: string } |
  { ok: false; issues: CensusJcsIssue[] };
const reject = (code: CensusJcsIssue['code'], path = ''): Payload => ({ ok: false, issues: [{ code, path }] });

// Precondition: lexically clean, shape-validated parsed v1 JSON. This defensive
// snapshot prevents library getter/toJSON execution; it does not validate shape,
// original wire keys, resource bounds, relations, provenance or completeness.
// Null prototypes also prevent inherited toJSON hooks in the library's input.
function snapshot(input: unknown): Record<string, unknown> {
  const seen = new Set<object>();
  const pending: { source: object; target: any }[] = [];
  function copy(value: unknown): any {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string' && value.isWellFormed()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || value === null || types.isProxy(value) || seen.has(value))
      throw new Error('non-JSON input');
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null)
      throw new Error('non-JSON prototype');
    seen.add(value);
    const target = array ? Object.setPrototypeOf([], null) : Object.create(null);
    pending.push({ source: value, target });
    return target;
  }
  const root = copy(input);
  if (root === null || typeof root !== 'object' || Array.isArray(root)) throw new Error('object required');
  while (pending.length) {
    const { source, target } = pending.pop()!;
    const descriptors = Object.getOwnPropertyDescriptors(source), array = Array.isArray(source);
    const keys = Reflect.ownKeys(descriptors);
    if (array && keys.length !== descriptors.length.value + 1) throw new Error('sparse/extended array');
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || !key.isWellFormed()) throw new Error('non-JSON key');
      const descriptor = descriptors[key];
      if (!('value' in descriptor) || !descriptor.enumerable) throw new Error('non-JSON descriptor');
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= descriptors.length.value))
        throw new Error('non-JSON array member');
      Object.defineProperty(target, key, { value: copy(descriptor.value), enumerable: true,
        writable: true, configurable: true });
    }
  }
  return root;
}
function prepare(envelope: unknown): { payload: Payload; suppliedDigest?: unknown } {
  let value: Record<string, unknown>;
  try { value = snapshot(envelope); } catch { return { payload: reject('NON_JSON_INPUT') }; }
  const suppliedDigest = value.payload_digest;
  delete value.payload_digest; // Only this top-level member is excluded.
  try {
    const text = canonicalize(value);
    if (typeof text !== 'string') return { payload: reject('JCS_ERROR') };
    const canonicalBytes = new TextEncoder().encode(text);
    const computedDigest = `sha256:${createHash('sha256').update(canonicalBytes).digest('hex')}`;
    return { payload: { ok: true, canonicalBytes, computedDigest }, suppliedDigest };
  } catch { return { payload: reject('JCS_ERROR') }; }
}

/** Shape-preconditioned canonical payload bytes; no schema/core/GC decision. */
export function canonicalizeCensusPayload(envelope: unknown): Payload {
  return prepare(envelope).payload;
}
/** Integrity only. Lexical/schema/core/ESRCH gates remain required upstream. */
export function verifyCensusPayloadDigest(envelope: unknown) {
  const { payload, suppliedDigest } = prepare(envelope);
  const scope = 'payload-digest' as const;
  if (!payload.ok) return { valid: false, scope, digestVerification: 'REFUSED' as const, issues: payload.issues };
  const code: CensusJcsIssue['code'] | null = typeof suppliedDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(suppliedDigest)
    ? 'DIGEST_FORMAT' : suppliedDigest !== payload.computedDigest ? 'DIGEST_MISMATCH' : null;
  return { valid: code === null, scope, digestVerification: code === null ? 'VERIFIED' as const : 'REFUSED' as const,
    canonicalBytes: payload.canonicalBytes, computedDigest: payload.computedDigest,
    issues: code === null ? [] : [{ code, path: '/payload_digest' }] };
}
