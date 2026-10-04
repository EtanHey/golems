// Copy privately, implement fetchBatch, bundle external dependencies, then set
// secrets.backend: plugin:/absolute/path/to/plugin.cjs (varlock supplies its plugin context).
const { createHash } = require('node:crypto');
const { plugin } = require('varlock/plugin-lib');
plugin.name = 'my-repogolem-backend';
plugin.registerResolverFunction({
  name: 'repoGolemBatch',
  argsSchema: { type: 'array', arrayMinLength: 1, arrayMaxLength: 1 },
  process() { return JSON.parse(Buffer.from(String(this.arrArgs[0].staticValue), 'base64').toString('utf8')); },
  async resolve(request) {
    // Implement ONE provider batch; throw value-free errors, never log/cache.
    const byRef = await fetchBatch(request.refs);
    return JSON.stringify(Object.fromEntries(request.refs.map(ref => {
      const key = ref.startsWith('varlock://') ? ref.slice(10)
        : `REPOGOLEM_SECRET_${createHash('sha256').update(ref).digest('hex').slice(0, 32)}`;
      return [key, byRef[ref]];
    })));
  },
});
async function fetchBatch(_refs) {
  throw new Error('implement provider batch before using this template');
}
