// Bun-only local varlock plugin. One root bulk resolver means no timer, per-ref
// retry, WASM, persistent provider cache, or upstream app-auth env filtering.
import { plugin } from 'varlock/plugin-lib';
import { opResolver, resolveRefs, secretKey } from './repogolem-secrets';
plugin.name = 'repogolem-1password';
plugin.registerResolverFunction({
  name: 'repoGolemOpBatch',
  argsSchema: { type: 'array', arrayMinLength: 1, arrayMaxLength: 1 },
  process() {
    if (!this.arrArgs[0].isStatic) throw new Error('repoGolem batch must be static');
    const refs = JSON.parse(Buffer.from(String(this.arrArgs[0].staticValue), 'base64').toString('utf8'));
    if (!Array.isArray(refs) || refs.some(ref => typeof ref !== 'string' || !ref.startsWith('op://'))) throw new Error('invalid repoGolem batch');
    return refs as string[];
  },
  resolve(refs: string[]) {
    const env = { ...process.env, TMPDIR: process.env.REPOGOLEM_ORIGINAL_TMPDIR, OP_CACHE: 'false', OP_DEBUG: 'false' };
    delete env.REPOGOLEM_ORIGINAL_TMPDIR;
    const values = resolveRefs(refs, opResolver(process.env.REPOGOLEM_OP_BIN || 'op', env));
    return JSON.stringify(Object.fromEntries([...values].map(([ref, value]) => [secretKey(ref), value])));
  },
});
