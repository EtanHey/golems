import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validate, assess } from './install-receipt.mjs';

const products = {
  brainlayer: 'EtanHey/brainlayer', brainbar: 'EtanHey/brainlayer',
  voicelayer: 'EtanHey/voicelayer', voicebar: 'EtanHey/voicelayer',
  cmuxlayer: 'EtanHey/cmuxlayer', golems: 'EtanHey/golems', narrationlayer: 'EtanHey/narrationlayer',
};
const execute = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 30000,
  maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

// This exact reader also runs on M1; it only reads latest.json under that host's HOME.
export function readLocal(names) {
  return Object.fromEntries(names.map(product => {
    try {
      return [product, JSON.parse(readFileSync(join(process.env.HOME, '.local/state/golems/install-receipts', product, 'latest.json'), 'utf8'))];
    } catch (error) {
      return [product, error.code === 'ENOENT' ? null : { error: 'unreadable-receipt' }];
    }
  }));
}
export function readRemote(names, exec = execute) {
  const source = `import {readFileSync} from 'node:fs'; import {join} from 'node:path';
    console.log(JSON.stringify((${readLocal.toString()})(${JSON.stringify(names)})));`;
  const quoted = "'" + source.replaceAll("'", "'\\''") + "'";
  const snapshot = JSON.parse(exec('ssh', ['-o', 'BatchMode=yes', 'm1', `node --input-type=module -e ${quoted}`]));
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || names.some(name => !Object.hasOwn(snapshot, name))) throw Error('Invalid remote snapshot');
  return snapshot;
}
export function latestRelease(repo, exec = execute) {
  const pages = JSON.parse(exec('gh', ['api', `repos/${repo}/releases`, '--paginate', '--slurp']));
  const releases = pages.flat().filter(r => !r.draft && r.published_at && r.tag_name);
  releases.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const release = releases[0];
  if (!release) throw Error('No published release');
  // The commits endpoint resolves annotated and lightweight tags to the actual commit.
  const commit = JSON.parse(exec('gh', ['api', `repos/${repo}/commits/${encodeURIComponent(release.tag_name)}`]));
  if (!/^[0-9a-f]{40}$/.test(commit.sha)) throw Error('Unresolved release tag');
  return { version: release.tag_name.replace(/^v(?=\d)/, ''), tag: release.tag_name, merge_sha: commit.sha };
}
export function collectStatus({ products: catalog = products, localReader = readLocal,
  remoteReader = readRemote, releaseReader = latestRelease } = {}) {
  const names = Object.keys(catalog), snapshots = {}, releases = new Map();
  for (const [host, reader] of [['mbp', localReader], ['m1', remoteReader]]) {
    try { snapshots[host] = reader(names); } catch { snapshots[host] = null; }
  }
  return names.flatMap(product => {
    const repo = catalog[product];
    if (!releases.has(repo)) {
      try { releases.set(repo, releaseReader(repo)); } catch { releases.set(repo, null); }
    }
    const release = releases.get(repo);
    return ['mbp', 'm1'].map(host => {
      const row = { product, host, status: 'UNKNOWN', activation: 'UNKNOWN', latest: release?.tag ?? null };
      if (!snapshots[host]) return { ...row, status: host === 'm1' ? 'UNREACHABLE' : 'UNKNOWN' };
      const r = snapshots[host][product];
      if (r == null) return { ...row, status: 'NO-RECEIPT' };
      try {
        validate(r);
        if (r.product !== product || r.host.alias !== host) throw Error('Wrong receipt identity');
      } catch { return { ...row, status: 'MISMATCH' }; }
      row.activation = assess(r)[0];
      row.installed = r.installed.version;
      row.commit = r.install_source?.mode === 'worktree-pin' ? r.install_source.pin_sha : r.installed.embedded_commit;
      const owner = r.install_source?.owner_status;
      if (['MISMATCH', 'FAILED'].includes(row.activation) || (owner && (owner.exit !== 0 || owner.drift || owner.settings_drift))) {
        return { ...row, status: 'MISMATCH' };
      }
      const identity = r.installed.embedded_commit === r.target.merge_sha
        || (!r.installed.embedded_commit && r.installed.content_sha256
          && r.installed.content_sha256 === r.target.release_asset?.sha256);
      if (!identity || !release) return row;
      return { ...row, status: r.target.merge_sha === release.merge_sha
        && (r.target.tag ? r.target.tag === release.tag : r.target.version === release.version) ? 'CURRENT' : 'BEHIND' };
    });
  });
}
export function printStatus(args) {
  const selected = {};
  for (const arg of args) {
    const [product, repo = products[product], ...extra] = arg.split('=');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/.test(product) || extra.length
      || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error('Usage: status [product[=owner/repo] ...]');
    selected[product] = repo;
  }
  const rows = collectStatus({ products: args.length ? selected : products });
  process.stdout.write('PRODUCT\tHOST\tSTATUS\tACTIVATION\tINSTALLED\tLATEST\tCOMMIT\n');
  for (const r of rows) process.stdout.write([r.product, r.host, r.status, r.activation, r.installed ?? '-', r.latest ?? '-', r.commit ?? '-'].join('\t') + '\n');
  if (rows.some(r => r.status !== 'CURRENT')) process.exitCode = 1;
}
