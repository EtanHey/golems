import Ajv from 'ajv';
import schema from '../schemas/install-receipt-v1.mjs';

const MCP_PRODUCTS = ['brainlayer', 'voicelayer', 'cmuxlayer', 'brainbar', 'voicebar'];

const ajv = new Ajv({ strict: false });
ajv.addFormat('utc-time', value => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19));
const valid = ajv.compile(schema);
export function validate(receipt) {
  if (!valid(receipt)) throw new Error(ajv.errorsText(valid.errors));
}
export function assess(r) {
  const commits = [r.installed.embedded_commit, r.install_source?.pin_sha, r.install_source?.owner_status?.pin_sha, r.activation.self_report?.commit];
  const status = r.target.ancestry?.status;
  const sameCommit = r.target.merge_sha === r.target.released_sha;
  const mismatch = !['identical', 'ahead'].includes(status)
    || (status === 'identical' && !sameCommit) || (status === 'ahead' && sameCommit)
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
  if (r.verdict === 'LIVE' && MCP_PRODUCTS.includes(r.product)
    && !(r.activation.mcp_probe?.ok === true && r.activation.reconnected_seats?.length > 0)) {
    return ['INSTALLED_NOT_ACTIVE', 'Missing MCP proof: successful mcp_probe and non-empty reconnected_seats required'];
  }
  const probe = r.activation.self_report?.version === r.target.version || r.activation.mcp_probe?.ok === true;
  if (r.verdict === 'LIVE' && !(identity && fresh && probe)) return ['INSTALLED_NOT_ACTIVE', 'Missing matching identity, fresh activation process or runtime proof'];
  return [r.verdict];
}
