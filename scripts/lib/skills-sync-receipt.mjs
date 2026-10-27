import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { assess, rootsDigest } from './install-receipt-core.mjs';

const scripts = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (file, args, options = {}) => spawnSync(file, args, { encoding: 'utf8', timeout: 90000,
  maxBuffer: 16 * 1024 * 1024, ...options });
export function parseOwnerStatus(text, exit, command) {
  const drift = text.match(/(?:^|\s)drift=(\d+)/)?.[1], settings = text.match(/settings-drift=(\d+)/)?.[1];
  const pin = text.match(/hooks-live=([0-9a-f]{40})\b/)?.[1];
  return { command, exit, drift: drift !== '0', settings_drift: settings !== '0', ...(pin ? { pin_sha: pin } : {}) };
}
export function probeOwnerStatus(args) {
  const status = run(process.execPath, [resolve(scripts, 'hooks/install-hooks.mjs'), ...args, '--status']);
  return parseOwnerStatus(status.stdout ?? '', status.status ?? 1, 'install-hooks.mjs ' + [...args, '--status'].join(' '));
}
export function snapshotSkills({ mode, source, home = process.env.HOME, prefix = resolve(source, '..') }) {
  const result = run('python3', ['-B', resolve(scripts, 'ratchet/skills-receipt.py'), mode, source, home, prefix]);
  if (result.status !== 0) throw Error('skills snapshot unavailable: ' + result.stderr);
  return JSON.parse(result.stdout);
}
function base(kind, source, alias, sha, owner, mode, version) {
  const now = new Date().toISOString();
  version ??= `${kind}-${sha.slice(0, 12)}`;
  return { schema: 'install-receipt/v1', receipt_id: randomUUID(), written_at: now,
    writer: { agent: kind, thread_or_session: process.env.CODEX_THREAD_ID || `installer-${process.pid}` },
    host: { alias, hostname: hostname(), user: userInfo().username }, product: 'golems', artifact_kind: kind,
    target: { version, ...(mode === 'release-channel' ? { tag: 'v' + version } : {}), merge_sha: sha, released_sha: sha },
    installed: { version, path: source, embedded_commit: sha, install_finished_at: now },
    install_source: { mode, path: source, owner_status: owner },
    activation: { method: 'none', processes: [] }, verdict: 'LIVE', reasons: [] };
}
function assessed(r) {
  const [verdict, reason] = assess(r); r.verdict = verdict; if (reason) r.reasons.push(reason);
  return r;
}
export function buildSkillsReceipt({ mode, source, alias, owner, parity, snapshot, version }) {
  const identities = snapshot.root_commits, commits = new Set(identities.flatMap(r => r.commits));
  const mixed = mode === 'checkout' && (commits.size !== 1 || identities.some(r => r.unresolved));
  const sha = mode === 'checkout' && !mixed ? [...commits][0] : snapshot.commit;
  const { pin_sha, ...status } = owner; // The hook pin belongs to the hooks artifact.
  const r = base('skills-sync', source, alias, sha, status, mode, version);
  r.installed.content_sha256 = rootsDigest(snapshot.roots);
  Object.assign(r.install_source, { roots: snapshot.roots, root_commits: identities, excluded: snapshot.excluded ?? [] });
  r.activation.skill_parity = parity;
  if (mixed) { r.verdict = 'MISMATCH'; r.reasons.push('Mixed/unresolved golems-owned roots: ' +
    JSON.stringify(identities.filter(root => !commits.size || root.unresolved || root.commits.some(commit => commit !== sha)))); }
  return assessed(r);
}
export function buildHooksReceipt({ source, alias, owner }) {
  if (!/^[0-9a-f]{40}$/.test(owner.pin_sha ?? '')) throw Error('Owner status has no verified hooks-live pin');
  const r = base('hooks-sync', source, alias, owner.pin_sha, owner, 'worktree-pin');
  r.install_source.pin_sha = owner.pin_sha;
  return assessed(r);
}
function writeReceipt(receipt) {
  const written = run(process.execPath, [resolve(scripts, 'install-receipt.mjs'), 'write', '-'], { input: JSON.stringify(receipt) });
  if (written.status !== 0) throw Error('receipt write failed: ' + written.stderr);
  console.log(`${receipt.artifact_kind} receipt: ` + JSON.parse(written.stdout).verdict);
  return receipt;
}
export function emitHooksReceipt({ source, alias, ownerArgs, owner }) {
  return writeReceipt(buildHooksReceipt({ source: resolve(source, '.worktrees/hooks-live'), alias, owner: owner ?? probeOwnerStatus(ownerArgs) }));
}
export function emitSkillsReceipt({ mode, source, alias, ownerArgs = [], owner, prefix = resolve(source, '..') }) {
  if (mode === 'release-channel') {
    const record = JSON.parse(readFileSync(resolve(prefix, 'release.json'))), manifest = JSON.parse(readFileSync(resolve(source, 'MANIFEST.json')));
    if (record.commit !== manifest.commit || record.version !== manifest.version) throw Error('receipt writer/content release identity mismatch');
  }
  owner ??= probeOwnerStatus(ownerArgs);
  const probe = run('python3', ['-B', resolve(scripts, 'ratchet/installed-skills.py')]);
  if (probe.status === 255) throw Error('Parity SSH unavailable (strict host-key verification)');
  let measured; try { measured = JSON.parse(probe.stdout); } catch { measured = {}; }
  const parity = { command: 'python3 -B scripts/ratchet/installed-skills.py', exit: probe.status ?? 1,
    measurement: measured.measurement === 'live' ? 'live' : 'fixture',
    pass: probe.status === 0 && measured.host_identity_valid === true && measured.name_content_parity === true && measured.required_readable_valid === true };
  const version = mode === 'release-channel' ? JSON.parse(readFileSync(resolve(prefix, 'release.json'))).version : undefined;
  return writeReceipt(buildSkillsReceipt({ mode, source, alias, owner, parity, version, snapshot: snapshotSkills({ mode, source, prefix }) }));
}
