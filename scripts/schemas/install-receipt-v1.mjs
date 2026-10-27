// Closed objects intentionally reject extra payloads (secrets, transcripts, memory content).
const text = { type: 'string', minLength: 1 };
const sha = { type: 'string', pattern: '^[0-9a-f]{40}$' };
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const time = { type: 'string', format: 'utc-time' };
const component = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$' };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const array = items => ({ type: 'array', items });
export default {
  $schema: 'http://json-schema.org/draft-07/schema#', $id: 'install-receipt/v1',
  ...object({
    schema: { const: 'install-receipt/v1' },
    receipt_id: { type: 'string', pattern: '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' }, written_at: time,
    writer: object({ agent: text, thread_or_session: text }, ['agent', 'thread_or_session']),
    host: object({ alias: { enum: ['mbp', 'm1'] }, hostname: text, user: text }, ['alias', 'hostname', 'user']),
    product: component, artifact_kind: { enum: ['brew-formula', 'brew-cask', 'pypi', 'npm', 'source-checkout', 'skills-sync'] },
    target: object({ version: component, tag: text, merge_sha: sha, released_sha: sha,
      ancestry: object({ method: { enum: ['gh-compare', 'git-merge-base'] },
        status: { enum: ['identical', 'ahead', 'behind', 'diverged'] }, checked_at: time }, ['method', 'status', 'checked_at']),
      release_asset: object({ name: text, sha256: digest }, ['name', 'sha256']),
      tap: object({ commit: sha, file: text, url: text, sha256: digest }, ['commit', 'file', 'url', 'sha256']) }, ['version', 'merge_sha', 'released_sha', 'ancestry']),
    installed: object({ version: text, path: text, embedded_commit: sha, content_sha256: digest,
      lockfile_sha256: digest, signing_identity: text, install_finished_at: time }, ['version', 'path', 'install_finished_at']),
    install_source: object({ mode: { enum: ['release-channel', 'worktree-pin', 'checkout'] }, path: text, pin_sha: sha,
      owner_status: object({ pin_sha: sha, command: text, exit: { type: 'integer' }, drift: { type: 'boolean' }, settings_drift: { type: 'boolean' } },
        ['command', 'exit', 'drift', 'settings_drift']) }, ['mode', 'path']),
    prior: object({ version: text, embedded_commit: sha }),
    activation: object({ method: { enum: ['launchctl-kickstart', 'app-relaunch', 'new-session', 'none'] },
      processes: array(object({ pid: { type: 'integer', minimum: 1 }, path: text, started_at: time }, ['pid', 'path', 'started_at'])),
      self_report: object({ command: text, version: text, commit: sha }, ['command', 'version']),
      mcp_probe: object({ server: text, request: text, ok: { type: 'boolean' }, summary: text }, ['server', 'request', 'ok', 'summary']),
      seat_scan: object({ method: { enum: ['t3-threads', 'list_agents'] }, checked_at: time,
        active_seats: array(text) }, ['method', 'checked_at', 'active_seats']),
      reconnected_seats: array(text) }, ['method', 'processes']),
    verdict: { enum: ['LIVE', 'INSTALLED_NOT_ACTIVE', 'MISMATCH', 'FAILED'] }, reasons: array(text),
  }, ['schema', 'receipt_id', 'written_at', 'writer', 'host', 'product', 'artifact_kind', 'target', 'installed', 'activation', 'verdict', 'reasons']),
  allOf: [{ if: { properties: { artifact_kind: { enum: ['source-checkout', 'skills-sync'] } } }, then: { required: ['install_source'] } },
    { if: { required: ['install_source'], properties: { install_source: { properties: { mode: { const: 'worktree-pin' } } } } },
      then: { properties: { install_source: { required: ['pin_sha', 'owner_status'],
        properties: { owner_status: { required: ['pin_sha'] } } } } } }],
};
