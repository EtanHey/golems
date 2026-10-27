import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validate, assess, bridgePaths, rootsDigest } from './lib/install-receipt-core.mjs';
import { snapshotSkills } from './lib/skills-sync-receipt.mjs';

const products = {
  brainlayer: 'EtanHey/brainlayer', brainbar: 'EtanHey/brainlayer',
  voicelayer: 'EtanHey/voicelayer', voicebar: 'EtanHey/voicelayer',
  cmuxlayer: 'EtanHey/cmuxlayer', golems: 'EtanHey/golems', narrationlayer: 'EtanHey/narrationlayer',
};
const latestSources = {
  brainlayer: 'tags', brainbar: 'tags', voicelayer: 'tags', voicebar: 'tags',
  cmuxlayer: 'tags', golems: 'releases', narrationlayer: 'tags',
};
const tapPaths = {
  brainlayer: 'Formula/brainlayer.rb', brainbar: 'Casks/brainbar.rb',
  voicelayer: 'Formula/voicelayer.rb', voicebar: 'Casks/voicebar.rb', cmuxlayer: 'Formula/cmuxlayer.rb',
};
const execute = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 30000,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' },
  maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
function compareStatus(status) {
  if (!['identical', 'ahead', 'behind', 'diverged'].includes(status)) throw Error('Invalid compare status');
  return status;
}

// Local snapshots and remote bytes are parsed and validated on the calling host.
export function readLocal(names) {
  return Object.fromEntries(names.map(product => {
    try {
      const r = JSON.parse(readFileSync(join(process.env.HOME, '.local/state/golems/install-receipts', product, 'latest.json'), 'utf8'));
      if (product === 'golems' && r?.artifact_kind === 'skills-sync' && r.install_source?.mode === 'release-channel') {
        const record = JSON.parse(readFileSync(join(r.install_source.path, '..', 'release.json'), 'utf8'));
        if (!/^[0-9a-f]{40}$/.test(record.commit)) throw Error('Invalid release identity');
        if (record.commit !== r.installed.embedded_commit) return [product, null];
      }
      return [product, r];
    } catch (error) {
      return [product, error.code === 'ENOENT' ? null : { error: 'unreadable-receipt' }];
    }
  }));
}
export function readRemote(names, exec = execute) {
  return Object.fromEntries(names.map(product => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/.test(product)) throw Error('Invalid product');
    let bytes;
    try {
      bytes = exec('ssh', ['-o', 'BatchMode=yes', 'm1',
        `cat -- "$HOME/.local/state/golems/install-receipts/${product}/latest.json"`]);
    } catch (error) {
      if (error.status === 255 || error.status == null) throw error;
      return [product, error.status === 1 && /No such file or directory/.test(String(error.stderr))
        ? null : { error: 'unreadable-receipt' }];
    }
    let r;
    try { r = JSON.parse(bytes); } catch { return [product, { error: 'unreadable-receipt' }]; }
    if (product === 'golems' && r?.artifact_kind === 'skills-sync' && r.install_source?.mode === 'release-channel') {
      try {
        const record = JSON.parse(exec('ssh', ['-o', 'BatchMode=yes', 'm1', 'cat -- "$HOME/.golems/release.json"']));
        if (!/^[0-9a-f]{40}$/.test(record.commit)) throw Error('Invalid release identity');
        if (record.commit !== r.installed.embedded_commit) return [product, null];
      } catch (error) {
        if (error.status === 255) throw error;
        return [product, { error: 'unreadable-receipt' }];
      }
    }
    return [product, r];
  }));
}

// Strict SemVer; build metadata has no effect on precedence.
function semver(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!match) throw Error('Invalid version');
  const pre = match[4]?.split('.');
  if (pre?.some(id => /^0\d+$/.test(id))) throw Error('Invalid version');
  return { core: match.slice(1, 4).map(BigInt), pre };
}
function compareVersions(a, b) {
  const left = semver(a), right = semver(b);
  const cmp = (x, y) => x < y ? -1 : x > y ? 1 : 0;
  for (let i = 0; i < 3; i++) {
    const order = cmp(left.core[i], right.core[i]);
    if (order) return order;
  }
  if (!left.pre || !right.pre) return cmp(Number(!left.pre), Number(!right.pre));
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i];
    if (x === undefined || y === undefined) return cmp(left.pre.length, right.pre.length);
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    const order = xn && yn ? cmp(BigInt(x), BigInt(y)) : xn !== yn ? (xn ? -1 : 1) : cmp(x, y);
    if (order) return order;
  }
  return 0;
}
export function latestRelease(repo, exec = execute, { source = 'tags', stableOnly = false } = {}) {
  if (source === 'releases') {
    const pages = JSON.parse(exec('gh', ['api', `repos/${repo}/releases`, '--paginate', '--slurp']));
    const releases = pages.flat().filter(r => !r.draft && r.published_at && r.tag_name);
    releases.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
    const release = releases[0];
    if (!release) throw Error('No published release');
    const commit = JSON.parse(exec('gh', ['api', `repos/${repo}/commits/${encodeURIComponent(release.tag_name)}`]));
    if (!/^[0-9a-f]{40}$/.test(commit.sha)) throw Error('Unresolved release tag');
    return { version: release.tag_name.replace(/^v(?=\d)/, ''), tag: release.tag_name, released_sha: commit.sha };
  }
  const refs = new Map();
  for (const line of exec('git', ['ls-remote', '--tags', `https://github.com/${repo}.git`]).trim().split('\n')) {
    const match = /^([0-9a-f]{40})\s+refs\/tags\/(.+?)(\^\{\})?$/.exec(line);
    if (!match) continue;
    const [, sha, tag, peeled] = match, version = tag.replace(/^v(?=\d)/, '');
    try { const parsed = semver(version); if (stableOnly && parsed.pre) continue; } catch { continue; }
    const ref = refs.get(tag) ?? { version, tag };
    ref[peeled ? 'peeled' : 'plain'] = sha;
    refs.set(tag, ref);
  }
  const release = [...refs.values()].sort((a, b) => compareVersions(b.version, a.version)
    || a.tag.localeCompare(b.tag))[0];
  if (!release) throw Error('No version tag');
  return { version: release.version, tag: release.tag, released_sha: release.peeled ?? release.plain };
}
export function readTapVersion(path, exec = execute) {
  const response = JSON.parse(exec('gh', ['api', `repos/EtanHey/homebrew-layers/contents/${path}`]));
  if (response.encoding !== 'base64' || !response.content) throw Error('Unreadable tap version');
  const formula = Buffer.from(response.content, 'base64').toString('utf8');
  const version = formula.match(/^\s*version\s+"([^"]+)"/m)?.[1]
    ?? formula.match(/^\s*url\s+"https:\/\/github\.com\/[^"\s]+\/archive\/refs\/tags\/v?([^"/]+)\.tar\.gz"/m)?.[1]
    ?? formula.match(/^\s*url\s+"https:\/\/(?:registry\.npmjs\.org|files\.pythonhosted\.org)\/[^"\s]+?-(\d[^"/]+)\.(?:tar\.gz|tgz)"/m)?.[1];
  semver(version);
  return version;
}
function tapStatus(path, release, reader) {
  if (!path) return 'TAP-N/A';
  try {
    const order = compareVersions(reader(path), release.version);
    return order === 0 ? 'TAP-OK' : order < 0 ? 'TAP-STALE' : 'TAP-UNKNOWN';
  } catch { return 'TAP-UNKNOWN'; }
}
export function compareInstall(repo, releaseSha, installedSha, exec = execute) {
  const result = JSON.parse(exec('gh', ['api', `repos/${repo}/compare/${releaseSha}...${installedSha}`]));
  return compareStatus(result.status);
}
// GitHub returns files only on the first compare page, capped at 300 even
// when commit pages are paginated. Exactly 300 cannot prove completeness.
export function compareBridge(repo, fromSha, toSha, exec = execute) {
  if (![fromSha, toSha].every(value => /^[0-9a-f]{40}$/.test(value))) throw Error('Bridge comparison requires commit SHAs');
  const pages = JSON.parse(exec('gh', ['api',
    `repos/${repo}/compare/${fromSha}...${toSha}?per_page=100`,
    '--paginate', '--slurp']));
  if (!Array.isArray(pages) || !pages.length) throw Error('Missing bridge comparison');
  const status = compareStatus(pages[0].status);
  if (status !== 'ahead') return { status, files: [] };
  const files = [];
  for (const [index, page] of pages.entries()) {
    if (compareStatus(page.status) !== status) throw Error('Inconsistent compare status');
    if (index === 0 || page.files !== undefined) {
      if (!Array.isArray(page.files)) throw Error('Missing compare files');
      files.push(...page.files);
    }
  }
  if (files.length >= 300) throw Error('Truncated bridge comparison (300-file cap)');
  return { status, files: [...new Set(files.flatMap(file => {
    if (typeof file.filename !== 'string' || !file.filename
      || (file.previous_filename !== undefined && (typeof file.previous_filename !== 'string' || !file.previous_filename))) {
      throw Error('Invalid compare file');
    }
    return file.previous_filename ? [file.filename, file.previous_filename] : [file.filename];
  }))] };
}
export function peelTag(repo, tag, exec = execute) {
  if (!tag) throw Error('Missing release tag');
  const ref = `refs/tags/${tag}`;
  const lookup = suffix => {
    const lines = exec('git', ['ls-remote', '--tags', `https://github.com/${repo}.git`, suffix]).trim().split('\n');
    return lines.map(line => line.split(/\s+/)).find(([sha, name]) => name === suffix && /^[0-9a-f]{40}$/.test(sha))?.[0];
  };
  const sha = lookup(`${ref}^{}`) ?? lookup(ref);
  if (!sha) throw Error('Unresolved release tag');
  return sha;
}
export function hostAlias(name) {
  const normalized = name.toLowerCase().replace(/\.local$/, '');
  if (/(^|[-_])mbp($|[-_])/.test(normalized) || /^macbook-pro$/.test(normalized)) return 'mbp';
  if (/(^|[-_])m1($|[-_])/.test(normalized) || normalized === 'locals-macbook-pro') return 'm1';
  throw Error('Unknown local host alias');
}
export function collectStatus({ products: catalog = products, localReader = readLocal,
  remoteReader = readRemote, releaseReader = (repo, options) => latestRelease(repo, execute, options), localHostname = hostname(), comparisonReader = compareInstall,
  resolver = { peelTag, compareAncestry: compareInstall, compareBridge }, tapReader = readTapVersion, tapPaths: paths = tapPaths,
  skillsReader = (host, r) => host === hostAlias(localHostname)
    ? snapshotSkills({ mode: r.install_source.mode, source: r.install_source.path })
    : JSON.parse(execute('ssh', ['-o', 'BatchMode=yes', 'm1', 'node "$HOME/.golems/current/scripts/skills-sync-receipt.mjs" snapshot'])) } = {}) {
  const names = Object.keys(catalog), snapshots = {}, releases = new Map();
  const localHost = hostAlias(localHostname);
  const readers = localHost === 'mbp' ? [['mbp', localReader], ['m1', remoteReader]] : [['m1', localReader]];
  for (const [host, reader] of readers) {
    try { snapshots[host] = reader(names); } catch { snapshots[host] = null; }
  }
  return names.flatMap(product => {
    const repo = catalog[product];
    const lookup = (source, stableOnly = false) => {
      const key = `${repo}:${source}:${stableOnly}`;
      if (!releases.has(key)) {
        try { releases.set(key, releaseReader(repo, { source, stableOnly })); } catch { releases.set(key, null); }
      }
      return releases.get(key);
    };
    const release = lookup(latestSources[product] ?? 'tags');
    const path = paths[product];
    const override = paths === tapPaths && repo !== products[product];
    const tap = path && override ? 'TAP-UNKNOWN' : tapStatus(path, path ? lookup('tags', true) : null, tapReader);
    return ['mbp', 'm1'].map(host => {
      const row = { product, host, status: 'UNKNOWN', activation: 'UNKNOWN', tap, latest: release?.tag ?? null };
      if (!snapshots[host]) return { ...row, status: host === 'm1' && localHost !== 'm1' ? 'UNREACHABLE' : 'UNKNOWN' };
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
      const identity = r.installed.embedded_commit === r.target.released_sha
        || (!r.installed.embedded_commit && r.installed.content_sha256
          && r.installed.content_sha256 === r.target.release_asset?.sha256);
      if (release && r.target.tag === release.tag && r.target.released_sha !== release.released_sha) {
        return { ...row, status: 'MISMATCH', verification: {
          released_sha: { claimed: r.target.released_sha, observed: release.released_sha } } };
      }
      if (!identity) return row;
      if (row.activation === 'LIVE') {
        row.verification = {};
        let skills;
        if (r.artifact_kind === 'skills-sync') {
          try {
            skills = skillsReader(host, r);
            if (skills.commit !== r.target.released_sha || rootsDigest(skills.roots) !== r.installed.content_sha256 ||
              (r.install_source.mode === 'checkout' && skills.root_commits.some(x => x.unresolved || x.commits.length !== 1 || x.commits[0] !== skills.commit))) {
              return { ...row, status: 'MISMATCH' };
            }
          } catch { return { ...row, status: 'LIVE-UNVERIFIED' }; }
        }
        try {
          const observed = r.install_source?.mode === 'checkout' && skills ? skills.commit : resolver.peelTag(repo, r.target.tag);
          if (!/^[0-9a-f]{40}$/.test(observed)) throw Error('Unresolved release tag');
          row.verification.released_sha = { claimed: r.target.released_sha, observed };
          if (observed !== r.target.released_sha) return { ...row, status: 'MISMATCH' };
          const ancestry = compareStatus(resolver.compareAncestry(repo, r.target.merge_sha, observed));
          row.verification.ancestry = { claimed: r.target.ancestry.status, observed: ancestry ?? null };
          if (!['identical', 'ahead'].includes(ancestry) || ancestry !== r.target.ancestry.status) {
            return { ...row, status: 'MISMATCH' };
          }
        } catch { return { ...row, status: 'LIVE-UNVERIFIED' }; }
        if (r.activation.seat_scan?.method === 'client-processes') {
          const diff = r.activation.seat_scan.bridge_diff;
          try {
            const fromSha = resolver.peelTag(repo, diff.from_tag);
            if (!/^[0-9a-f]{40}$/.test(fromSha)) throw Error('Unresolved prior release tag');
            const comparison = resolver.compareBridge(repo, fromSha, diff.to_sha);
            const status = compareStatus(comparison?.status);
            row.verification.bridge_diff = { claimed: { changed: diff.changed, paths: diff.paths },
              ancestry: { claimed: 'ahead', observed: status } };
            if (status !== 'ahead') return { ...row, status: 'MISMATCH' };
            const files = comparison.files;
            if (!Array.isArray(files) || files.some(path => typeof path !== 'string' || !path)) {
              throw Error('Invalid bridge comparison');
            }
            const paths = bridgePaths(product);
            const observed = [...new Set(files.filter(file => paths.some(path =>
              path.endsWith('/') ? file.startsWith(path) : file === path)))];
            row.verification.bridge_diff = {
              ...row.verification.bridge_diff,
              observed: { changed: observed.length > 0, paths: observed },
            };
            if (!diff.changed && observed.length) return { ...row, status: 'MISMATCH' };
            if (diff.changed && !observed.length) {
              row.verification.bridge_diff.note = 'Claimed changed=true is stricter than observed; no downgrade';
            }
          } catch (error) {
            row.verification.bridge_diff = { claimed: { changed: diff.changed, paths: diff.paths },
              error: error.message };
            return { ...row, status: 'LIVE-UNVERIFIED' };
          }
        }
        if (!release) return { ...row, status: 'LIVE-UNVERIFIED' };
      }
      if (row.activation !== 'LIVE' && r.target.ancestry.status === 'ahead') {
        return { ...row, status: row.activation };
      }
      if (!release) return row;
      if (r.target.released_sha === release.released_sha) {
        return { ...row, status: (r.install_source?.mode === 'checkout' || (r.target.tag ? r.target.tag === release.tag : r.target.version === release.version))
          ? (row.activation === 'LIVE' ? 'CURRENT' : row.activation) : 'BEHIND' };
      }
      try {
        const comparison = comparisonReader(repo, release.released_sha, r.target.released_sha);
        return { ...row, status: comparison === 'ahead' ? 'AHEAD' : comparison === 'behind' ? 'BEHIND' : 'UNKNOWN' };
      } catch { return row; }
    });
  });
}
export function printStatus(args, options = {}) {
  const selected = {};
  for (const arg of args) {
    const [product, repo = products[product], ...extra] = arg.split('=');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/.test(product) || extra.length
      || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error('Usage: status [product[=owner/repo] ...]');
    selected[product] = repo;
  }
  const rows = collectStatus({ ...options, products: args.length ? selected : products });
  process.stdout.write('PRODUCT\tHOST\tSTATUS\tACTIVATION\tINSTALLED\tLATEST\tTAP\tCOMMIT\tVERIFICATION\n');
  for (const r of rows) process.stdout.write([r.product, r.host, r.status, r.activation, r.installed ?? '-', r.latest ?? '-', r.tap, r.commit ?? '-', r.verification ? JSON.stringify(r.verification) : '-'].join('\t') + '\n');
  if (rows.some(r => r.status !== 'CURRENT' || r.tap === 'TAP-STALE')) process.exitCode = 1;
}
