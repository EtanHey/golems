import Ajv from 'ajv';
import schema from '../schemas/install-receipt-v1.mjs';

const MCP_PRODUCTS = ['brainlayer', 'voicelayer', 'cmuxlayer', 'brainbar', 'voicebar'];
const BRIDGE_PATHS = ['src/brainlayer/mcp_stdio_bridge.py', 'src/brainlayer/mcp/', 'src/brainlayer/mcp_socket_config.py'];
const BRIDGE = /^(?:\S+\s+)?\/opt\/homebrew\/(?:opt\/brainlayer|Cellar\/brainlayer\/[^/\s]+)\/bin\/brainlayer-mcp-stdio-bridge$/;
const SOCAT = /^(?:\/opt\/homebrew\/bin\/)?socat STDIO UNIX-CONNECT:\/tmp\/voicelayer-mcp\.sock$/;
const SOCAT_REASON = 'LIVE = daemon serves the new code; socat seats connected before a daemon restart got EOF and are dead for voicelayer until their session restarts (not visible to ps).';
const CLIENT_RULES = new Map([
  ['brainlayer', { bridge: BRIDGE }], ['brainbar', { bridge: BRIDGE }],
  ['voicelayer', { relay: SOCAT }], ['voicebar', { relay: SOCAT }],
]);

function staleClients(r) {
  const scan = r.activation.seat_scan, rule = CLIENT_RULES.get(r.product);
  if (!rule) throw new Error(`no client matcher for ${r.product}`);
  const clients = scan.clients.filter(c => (rule.bridge ?? rule.relay).test(c.command));
  if (rule.relay || !scan.bridge_diff.changed) return [];
  return [...new Set(clients.filter(c => Date.parse(c.started_at) <= Date.parse(r.installed.install_finished_at))
    .map(c => `pid:${c.pid}@${c.started_at}`))];
}

const ajv = new Ajv({ strict: false });
ajv.addFormat('utc-time', value => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19));
const valid = ajv.compile(schema);
export function validate(receipt) {
  if (!valid(receipt)) throw new Error(ajv.errorsText(valid.errors));
  for (const [field, seats] of [['reconnected_seats', receipt.activation.reconnected_seats],
    ['seat_scan.active_seats', receipt.activation.seat_scan?.active_seats]]) {
    if (seats?.includes(receipt.writer.thread_or_session)) {
      throw new Error(`activation.${field} must not contain writer.thread_or_session`);
    }
  }
  const scan = receipt.activation.seat_scan;
  if (scan?.method !== 'client-processes') return;
  const derived = staleClients(receipt), rule = CLIENT_RULES.get(receipt.product);
  if (scan.bridge_diff.to_sha !== receipt.target.released_sha) {
    throw new Error('seat_scan.bridge_diff.to_sha must equal target.released_sha');
  }
  if (rule.bridge && !BRIDGE_PATHS.every(path => scan.bridge_diff.paths.includes(path))) {
    throw new Error('seat_scan.bridge_diff.paths must cover all core brainlayer bridge paths');
  }
  if (rule.relay) {
    const relays = scan.excluded.filter(e => e.rule === 'socat-relay');
    if (!relays.length || relays.some(e => !e.reason.includes(SOCAT_REASON))) {
      throw new Error('seat_scan.excluded socat-relay requires the exact limitation reason');
    }
  }
  const claimed = [...scan.active_seats].sort(), expected = [...derived].sort();
  if (JSON.stringify(claimed) !== JSON.stringify(expected)) {
    throw new Error('seat_scan.active_seats must equal the derived stale pid@started_at list');
  }
}
export function assess(r) {
  const scan = r.activation.seat_scan;
  const stale = scan?.method === 'client-processes' ? staleClients(r) : [];
  const clientReason = stale.length ? `Stale MCP client processes: ${stale.join(', ')}`
    : scan?.method === 'client-processes' && !scan.bridge_diff.changed
      ? 'No stale MCP clients: bridge_diff.changed=false; recorded bridge code is unchanged' : undefined;
  const explain = reason => clientReason ? `${reason}; ${clientReason}` : reason;
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
  if (r.verdict === 'LIVE' && MCP_PRODUCTS.includes(r.product)) {
    if (r.activation.mcp_probe?.ok !== true) {
      return ['INSTALLED_NOT_ACTIVE', explain('Missing MCP proof: successful mcp_probe required')];
    }
    if (!scan) return ['INSTALLED_NOT_ACTIVE', 'Missing MCP proof: seat_scan required'];
    if (!(Date.parse(scan.checked_at) > Date.parse(r.installed.install_finished_at))) {
      return ['INSTALLED_NOT_ACTIVE', explain('Missing MCP proof: seat_scan.checked_at must be later than installed.install_finished_at')];
    }
    if (scan.method === 'client-processes') {
      if (stale.length) return ['INSTALLED_NOT_ACTIVE', clientReason];
    } else if (!scan.active_seats.every(seat => r.activation.reconnected_seats?.includes(seat))) {
      return ['INSTALLED_NOT_ACTIVE', 'Missing MCP proof: every seat_scan.active_seats id must appear in reconnected_seats'];
    }
  }
  const probe = r.activation.self_report?.version === r.target.version || r.activation.mcp_probe?.ok === true;
  if (r.verdict === 'LIVE' && !(identity && fresh && probe)) return ['INSTALLED_NOT_ACTIVE', explain('Missing matching identity, fresh activation process or runtime proof')];
  return [r.verdict, clientReason];
}
