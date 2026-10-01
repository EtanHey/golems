// Varlock owns schema/plugin resolution; repoGolem owns preflight/cache format.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { secretKey, type Resolver } from './repogolem-secrets';
export function varlockResolver(opBin: string, childEnv: Record<string, string | undefined>): Resolver {
  return refs => {
    const scratch = mkdtempSync(join(tmpdir(), 'rgv-'));
    chmodSync(scratch, 0o700);
    try {
      const plugin = join(import.meta.dir, 'repogolem-1password-plugin.ts');
      const schema = [
        `# @plugin(${JSON.stringify(plugin)})`,
        `# @setValuesBulk(repoGolemOpBatch(${JSON.stringify(JSON.stringify(refs))}))`, '# ---',
        ...refs.flatMap(ref => ['# @required @sensitive', `${secretKey(ref)}=`]), '',
      ].join('\n');
      writeFileSync(join(scratch, '.env.schema'), schema, { mode: 0o600 });
      const env = { ...childEnv, TMPDIR: scratch, REPOGOLEM_OP_BIN: opBin.includes('/') ? resolve(opBin) : opBin };
      for (const key of Object.keys(env)) if (key.startsWith('_VARLOCK') || key.startsWith('REPOGOLEM_SECRET_')) delete env[key];
      env.OP_DEBUG = 'false'; env.OP_CACHE = 'false'; env.DEBUG = '';
      const cli = childEnv.REPOGOLEM_VARLOCK_BIN || join(dirname(import.meta.resolve('varlock').replace(/^file:\/\//, '')), '../bin/cli.js');
      const proc = Bun.spawnSync([process.execPath, cli, 'load', '--path', join(scratch, '.env.schema'), '--format', 'json', '--skip-cache'], {
        cwd: scratch, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: 120_000,
      });
      if (proc.exitCode !== 0) {
        const diagnostic = proc.stdout.toString() + proc.stderr.toString();
        if (diagnostic.includes('op returned a masked value')) throw new Error('varlock returned a masked value; nothing written');
        const code = diagnostic.match(/BAD_(VAULT|ITEM|FIELD)_REFERENCE/)?.[1]?.toLowerCase();
        throw new Error(code ? `missing ${code}: 1Password reference; nothing written` : 'varlock resolution failed; nothing written');
      }
      let data: unknown;
      try { data = JSON.parse(proc.stdout.toString()); } catch { throw new Error('varlock returned unreadable output; nothing written'); }
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== refs.length) throw new Error('varlock returned unexpected keys; nothing written');
      return refs.map(ref => (data as Record<string, string>)[secretKey(ref)]);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  };
}
