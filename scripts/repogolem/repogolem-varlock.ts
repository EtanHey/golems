// Varlock owns schema/plugin resolution; repoGolem owns preflight/cache format.
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedVarlock } from './repogolem-varlock-package';
import { secretKey, type Resolver } from './repogolem-secrets';
export type BackendSettings = { pluginBase?: string; secrets?: { backend: string; valuesFile?: string; resolver?: string; pluginVersion?: string }; values?: Record<string, { sensitive: boolean; source?: string }> };
const keyFor = (ref: string) => ref.startsWith('varlock://') ? ref.slice(10) : secretKey(ref);
export function opRefsFor(refs: string[], settings: BackendSettings): string[] {
  if ((settings.secrets?.backend ?? '1password') !== '1password') return [];
  return [...new Set([...refs.filter(ref => ref.startsWith('op://')), ...Object.values(settings.values ?? {}).flatMap(value => value.source ? [value.source] : [])])].sort();
}
// Resolve only installed package bytes; Bun.resolveSync can invoke its installer.
function installedPlugin(target: string, base: string, version?: string): string {
  if (target.startsWith('.') || target.startsWith('/')) return resolve(base, target);
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(target)) throw new Error('invalid plugin package');
  for (let dir = resolve(base); ; dir = dirname(dir)) {
    const root = join(dir, 'node_modules', target), metadata = join(root, 'package.json');
    if (existsSync(metadata)) {
      const pkg = JSON.parse(readFileSync(metadata, 'utf8'));
      if (version && pkg.version !== version) throw new Error('plugin version differs');
      const exported = pkg.exports?.['./plugin'];
      const entry = typeof exported === 'string' ? exported : exported?.require ?? exported?.default;
      if (typeof entry !== 'string' || !entry.startsWith('./')) throw new Error('plugin export missing');
      const packageDir = realpathSync(root), file = realpathSync(resolve(root, entry));
      if (!file.startsWith(packageDir + '/')) throw new Error('plugin export escapes package');
      return file;
    }
    if (dir === dirname(dir)) throw new Error('plugin not installed');
  }
}
export function varlockResolver(opBin: string, childEnv: Record<string, string | undefined>, settings: BackendSettings = {}): Resolver {
  return refs => {
    const scratch = mkdtempSync(join(tmpdir(), 'rgv-'));
    chmodSync(scratch, 0o700);
    try {
      const backend = settings.secrets?.backend ?? '1password';
      const values = settings.values ?? {};
      const opRefs = opRefsFor(refs, settings);
      const aliases = Object.fromEntries(Object.entries(values).filter(([, item]) => item.source).map(([name, item]) => [name, item.source!]));
      const roots: string[] = [];
      const loadPlugin = (path: string) => {
        const name = `p${roots.length}${extname(path)}`;
        symlinkSync(path, join(scratch, name));
        roots.push(`# @plugin("./${name}")`);
      };
      if (backend === '1password' && opRefs.length) {
        loadPlugin(join(import.meta.dir, 'repogolem-1password-plugin.ts'));
        roots.push(`# @setValuesBulk(repoGolemOpBatch(${JSON.stringify(Buffer.from(JSON.stringify({ refs: opRefs, aliases })).toString('base64'))}),format=json)`);
      } else if (backend.startsWith('plugin:')) {
        const target = backend.slice(7);
        const base = settings.pluginBase ?? import.meta.dir;
        let installed: string;
        try { installed = installedPlugin(target, base, settings.secrets?.pluginVersion); if (extname(installed) !== '.cjs') throw new Error('adapter must be CJS'); }
        catch { throw new Error('BYO varlock plugin is not installed; nothing written'); }
        loadPlugin(installed);
        roots.push(`# @setValuesBulk(${settings.secrets?.resolver ?? 'repoGolemBatch'}(${JSON.stringify(Buffer.from(JSON.stringify({ refs, values })).toString('base64'))}),format=json)`);
      }
      const fileNames = Object.keys(values).filter(name => backend === 'file' || (backend === '1password' && !values[name].source));
      if (backend === 'file' && (refs.some(ref => ref.startsWith('op://')) || Object.values(values).some(value => value.source))) throw new Error('file backend requires named varlock references; nothing written');
      if (fileNames.length) {
        loadPlugin(join(import.meta.dir, 'repogolem-file-plugin.ts'));
        const path = settings.secrets?.valuesFile ?? join(homedir(), '.config/repogolem/values.env');
        roots.push(`# @setValuesBulk(repoGolemFile(${JSON.stringify(Buffer.from(resolve(path)).toString('base64'))}),format=env,pick=${JSON.stringify(fileNames)})`);
      }
      const schema = [...roots, '# ---', ...refs.flatMap(ref => [
        `# @required @type=string @sensitive=${ref.startsWith('varlock://') ? values[ref.slice(10)]?.sensitive !== false : true}`,
        `${keyFor(ref)}=`,
      ]), ''].join('\n');
      writeFileSync(join(scratch, '.env.schema'), schema, { mode: 0o600 });
      const env: Record<string, string | undefined> = backend === '1password' ? { ...childEnv, REPOGOLEM_ORIGINAL_TMPDIR: childEnv.TMPDIR, REPOGOLEM_OP_BIN: opBin.includes('/') ? resolve(opBin) : opBin } : Object.fromEntries(['HOME', 'PATH', 'LANG', 'USER'].map(key => [key, childEnv[key]]));
      env.TMPDIR = scratch;
      for (const key of Object.keys(env)) if (/^_*VARLOCK/.test(key) || key.startsWith('REPOGOLEM_SECRET_') || refs.some(ref => keyFor(ref) === key)) delete env[key];
      env.VARLOCK_TELEMETRY_DISABLED = '1'; env.DO_NOT_TRACK = '1';
      if (backend === '1password') { env.OP_DEBUG = 'false'; env.OP_CACHE = 'false'; }
      env.DEBUG = '';
      const cli = (childEnv.REPOGOLEM_TEST_MODE === '1' ? childEnv.REPOGOLEM_VARLOCK_BIN : undefined) || join(installedVarlock(dirname(fileURLToPath(import.meta.url))), 'bin/cli.js');
      const proc = Bun.spawnSync([process.execPath, '--no-install', cli, 'load', '--path', join(scratch, '.env.schema'), '--format', 'json', '--skip-cache'], {
        cwd: scratch, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: 120_000,
      });
      if (proc.exitCode !== 0) {
        const diagnostic = proc.stdout.toString() + proc.stderr.toString();
        if (diagnostic.includes('op returned a masked value')) throw new Error('varlock returned a masked value; nothing written');
        const fileError = diagnostic.match(/REPOGOLEM_VALUES_(PATH|GIT|FILE)/)?.[1];
        if (fileError) throw new Error(({ PATH: 'private values file must be owned 0600 with trusted parents', GIT: 'private values file must be outside every git work tree', FILE: 'private values file cannot be read safely' } as Record<string,string>)[fileError] + '; nothing written');
        if (diagnostic.includes('env format does not support function calls')) throw new Error('private values file cannot use interpolation or function calls; single-quote literal values; nothing written');
        throw new Error('varlock resolution failed; nothing written');
      }
      let data: unknown;
      try { data = JSON.parse(proc.stdout.toString()); } catch { throw new Error('varlock returned unreadable output; nothing written'); }
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== refs.length) throw new Error('varlock returned unexpected keys; nothing written');
      return refs.map(ref => (data as Record<string, string>)[keyFor(ref)]);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  };
}
