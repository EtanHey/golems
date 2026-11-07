import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const handoffPath = output => output.replace(/\.html$/i, '') + '.publish-handoff.json';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const httpsUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u : null; } catch { return null; } };
export function deliveryOrigins(env = process.env) {
  try {
    return env.AUDIO_DASHBOARD_DELIVERY_ORIGINS !== undefined ? JSON.parse(env.AUDIO_DASHBOARD_DELIVERY_ORIGINS)
      : JSON.parse(readFileSync(path.join(env.HOME || os.homedir(), '.config/golems/audio-dashboard.json'), 'utf8')).approvedDeliveryOrigins;
  } catch { return null; }
}
export function hostedDeliveryViolations({ delivery: d, handoff: h, html, sourceHtml, dashboardId, approvedDeliveryOrigins: origins }) {
  const violations = [], fail = (code, evidence) => violations.push({ code, evidence });
  if (!Array.isArray(origins) || !origins.length || !origins.every(o => httpsUrl(o)?.origin === o))
    fail('MISSING_DELIVERY_CONFIG', 'Configure approvedDeliveryOrigins locally; no default delivery origin is trusted.');
  if (!d) { fail('MISSING_HOSTED_DELIVERY', 'tailnet is media fallback only; publish via the NarrationLayer Lakebed handoff'); return violations; }
  if (d.schema !== 'audio-dashboard.delivery.v2' || d.host !== 'lakebed')
    fail('INVALID_DELIVERY_RECEIPT', 'Expected audio-dashboard.delivery.v2 from the Lakebed publisher.');
  const url = httpsUrl(d.url);
  if (!url || !Array.isArray(origins) || !origins.includes(url.origin)) fail('UNAPPROVED_DELIVERY_ORIGIN', 'Delivery URL must use an approved HTTPS origin.');
  const backfilled = d.backfilled === true;
  if (backfilled ? d.staging?.mode !== 'none-backfill' || d.admission?.design !== 'UNKNOWN_BACKFILL'
    : d.staging?.mode === 'none-backfill' || d.admission?.design === 'UNKNOWN_BACKFILL') fail('BACKFILL_MARKERS_MISMATCH', 'Backfill flag, none-backfill staging and UNKNOWN_BACKFILL must occur together.');
  if (!backfilled && (!h || h.schema !== 'audio-dashboard.publish-handoff.v2')) fail('MISSING_PUBLISH_HANDOFF', 'Delivery requires the original publish handoff.');
  if (!dashboardId || d.dashboardId !== dashboardId || (h && h.dashboardId !== dashboardId) || url?.searchParams.get('d') !== dashboardId)
    fail('DELIVERY_ID_MISMATCH', 'Receipt, handoff, route and spec.id must identify the same dashboard.');
  if (typeof sourceHtml !== 'string') fail('MISSING_PREPARED_SOURCE', 'Supply the prepared source directory containing index.html.');
  const sourceHash = typeof sourceHtml === 'string' ? sha256(sourceHtml) : null;
  if (d.sourceHtmlSha256 !== sourceHash || (h && (h.sourceHtmlSha256 !== sourceHash || h.builtHtmlSha256 !== sha256(html))) || !hash(d.servedShellSha256) || !hash(d.artifactSha256) ||
      d.staging?.servedShellSha256 !== d.servedShellSha256)
    fail('DELIVERY_SHA_MISMATCH', 'Bind builtHtmlSha256 to BUILD output and sourceHtmlSha256 to prepared input; preserve the staged served shell hash.');
  const p = d.accountProof;
  if (!p || p.method !== 'note-roundtrip' || !['existing-empty-field', 'dedicated-key'].includes(p.probe) || !['mutationDelta', 'existingRowsPreserved'].every(k => Number.isInteger(p[k]) && p[k] >= 0) ||
      !['signedIn', 'independentClient', 'serverAck', 'markerSaved', 'restoredAfterLocalKeysCleared', 'cleanedUp', 'disposableRecord'].every(k => p[k] === true))
    fail('MISSING_ACCOUNT_SYNC_PROOF', 'Require a signed-in disposable note save, restore after local pending keys are cleared, and cleanup.');
  const a = d.admission;
  if (!a || (backfilled ? a.design !== 'UNKNOWN_BACKFILL' : !['COMPARED', 'REDESIGN_APPROVED', 'FIRST_IN_LINEAGE'].includes(a.design) || a.design !== h?.design?.admission) ||
      !['current', 'deprecated'].includes(a.answerRuntime) || a.answerIdentity !== 'PASS' || a.providerReady !== true || typeof a.gateVersion !== 'string' || !a.gateVersion.trim())
    fail('DELIVERY_ADMISSION_MISMATCH', 'Require the design echo, PASS answer identity, ready provider and a nonempty gate version.');
  return violations;
}
