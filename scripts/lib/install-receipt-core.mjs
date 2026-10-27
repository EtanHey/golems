import Ajv from 'ajv';
import schema from '../schemas/install-receipt-v1.mjs';

const ajv = new Ajv({ strict: false });
ajv.addFormat('utc-time', value => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19));
const valid = ajv.compile(schema);
export function validate(receipt) {
  if (typeof receipt?.target?.released_sha === 'string') receipt.target.released_sha = receipt.target.released_sha.toLowerCase();
  if (!valid(receipt)) throw new Error(ajv.errorsText(valid.errors));
}
export function assess(r) {
  const commits = [r.installed.embedded_commit, r.install_source?.pin_sha, r.install_source?.owner_status?.pin_sha, r.activation.self_report?.commit];
  const mismatch = !['identical', 'ahead'].includes(r.target.ancestry?.status)
    || commits.some(commit => commit !== undefined && commit !== r.target.released_sha)
    || (!r.installed.embedded_commit && r.installed.content_sha256 && r.target.release_asset
      && r.installed.content_sha256 !== r.target.release_asset.sha256);
  if (mismatch && r.verdict !== 'FAILED') return ['MISMATCH', 'Installed identity differs from released commit/artifact or release does not contain merge'];
  const owner = r.install_source?.owner_status;
  if (r.verdict === 'LIVE' && owner && (owner.exit !== 0 || owner.drift || owner.settings_drift)) {
    return ['INSTALLED_NOT_ACTIVE', 'Owner installer status failed or reports drift'];
  }
  const identity = r.installed.embedded_commit === r.target.released_sha || (!r.installed.embedded_commit
    && r.installed.content_sha256 && r.installed.content_sha256 === r.target.release_asset?.sha256);
  const fresh = r.activation.processes.some(p => Date.parse(p.started_at) > Date.parse(r.installed.install_finished_at));
  const probe = r.activation.self_report?.version === r.target.version || r.activation.mcp_probe?.ok === true;
  if (r.verdict === 'LIVE' && !(identity && fresh && probe)) return ['INSTALLED_NOT_ACTIVE', 'Missing matching identity, fresh activation process or runtime proof'];
  return [r.verdict];
}
