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
export function snapshotSkills({ mode, source, home = process.env.HOME, prefix = resolve(source, '..') }) {
  const result = run('python3', ['-B', resolve(scripts, 'ratchet/skills-receipt.py'), mode, source, home, prefix]);
  if (result.status !== 0) throw Error('skills snapshot unavailable: ' + result.stderr);
  return JSON.parse(result.stdout);
}
export function buildSkillsReceipt({ mode, source, alias, owner, parity, snapshot, version }) {
  const now = new Date().toISOString(), identities = snapshot.root_commits;
  const commits = new Set(identities.flatMap(r => r.commits));
  const mixed = mode === 'checkout' && (commits.size !== 1 || identities.some(r => r.unresolved));
  const sha = mode === 'checkout' && !mixed ? [...commits][0] : snapshot.commit;
  version ??= 'checkout-' + sha.slice(0, 12);
  const r = { schema: 'install-receipt/v1', receipt_id: randomUUID(), written_at: now,
    writer: { agent: 'skills-sync', thread_or_session: process.env.CODEX_THREAD_ID || `installer-${process.pid}` },
    host: { alias, hostname: hostname(), user: userInfo().username }, product: 'golems', artifact_kind: 'skills-sync',
    target: { version, ...(mode === 'release-channel' ? { tag: 'v' + version } : {}), merge_sha: sha, released_sha: sha,
      ancestry: { method: 'git-merge-base', status: 'identical', checked_at: now } },
    installed: { version, path: source, embedded_commit: sha, content_sha256: rootsDigest(snapshot.roots), install_finished_at: now },
    install_source: { mode, path: source, roots: snapshot.roots, root_commits: identities, owner_status: owner },
    activation: { method: 'none', processes: [], skill_parity: parity },
    verdict: mixed ? 'MISMATCH' : 'LIVE', reasons: mixed ? ['Mixed/unresolved checkout roots: ' + JSON.stringify(identities)] : [] };
  const [verdict, reason] = assess(r); r.verdict = verdict; if (reason) r.reasons.push(reason);
  return r;
}
export function emitSkillsReceipt({ mode, source, alias, ownerArgs = [], prefix = resolve(source, '..') }) {
  const status = run(process.execPath, [resolve(scripts, 'hooks/install-hooks.mjs'), ...ownerArgs, '--status']);
  const text = status.stdout ?? '', drift = text.match(/\bdrift=(\d+)/)?.[1], settings = text.match(/settings-drift=(\d+)/)?.[1];
  const pin = text.match(/hooks-live=([0-9a-f]{40})\b/)?.[1];
  const owner = { command: 'install-hooks.mjs ' + [...ownerArgs, '--status'].join(' '), exit: status.status ?? 1,
    drift: drift !== '0', settings_drift: settings !== '0', ...(pin ? { pin_sha: pin } : {}) };
  const probe = run('python3', ['-B', resolve(scripts, 'ratchet/installed-skills.py')]);
  let measured; try { measured = JSON.parse(probe.stdout); } catch { measured = {}; }
  const parity = { command: 'python3 -B scripts/ratchet/installed-skills.py', exit: probe.status ?? 1,
    measurement: measured.measurement === 'live' ? 'live' : 'fixture',
    pass: probe.status === 0 && measured.host_identity_valid === true && measured.name_content_parity === true && measured.required_readable_valid === true };
  const version = mode === 'release-channel' ? JSON.parse(readFileSync(resolve(prefix, 'release.json'))).version : undefined;
  const receipt = buildSkillsReceipt({ mode, source, alias, owner, parity, version, snapshot: snapshotSkills({ mode, source, prefix }) });
  const written = run(process.execPath, [resolve(scripts, 'install-receipt.mjs'), 'write', '-'], { input: JSON.stringify(receipt) });
  if (written.status !== 0) throw Error('receipt write failed: ' + written.stderr);
  console.log('skills-sync receipt: ' + JSON.parse(written.stdout).verdict);
  return receipt;
}
