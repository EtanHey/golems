type RecordValue = Record<string, any>;
export type CensusEsrchDiagnostic = { code: string; path: string };
const compare = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
const launchKey = (v: RecordValue) => JSON.stringify([v.host_id, v.os_boot_id, v.pid, v.start_seconds, v.start_microseconds]);
const sameSet = (a: string[], b: string[]) => {
  const left = new Set(a), right = new Set(b);
  return left.size === right.size && [...left].every(x => right.has(x));
};
const nativeFields: Record<string, string> = { WINDOW: 'window_id', WORKSPACE: 'workspace_id',
  PANE: 'pane_id', SURFACE: 'surface_id', TERMINAL: 'diagnostic_id' };
const required = ['NATIVE_TREE', 'NATIVE_INDEPENDENT'].flatMap(source =>
  ['WINDOW', 'WORKSPACE', 'PANE', 'SURFACE'].map(scope => `${source}/${scope}`)).concat('NATIVE_DEBUG/TERMINAL');
/** Pure shape/core-validated v1 objects only. Issues concern claimed ESRCH structure.
 * No completeness, source truth, digest, native reconciliation or GC authority.
 * Input observations, nulls and missing-evidence reasons are never rewritten.
 */
export function validateCensusEsrchWitnesses(envelope: RecordValue) {
  const issues: CensusEsrchDiagnostic[] = [], unverified: CensusEsrchDiagnostic[] = [];
  const issue = (code: string, path: string) => { issues.push({ code, path }); };
  const gap = (code: string, path: string) => { unverified.push({ code, path }); };
  const c = envelope.coverage;
  const index = (rows: RecordValue[], key: string, prefix: string) => new Map<string, { value: RecordValue; path: string }>(
    rows.map((value, i) => [value[key], { value, path: `${prefix}/${i}` }]));
  const attempts = index(c.attempts, 'attempt_id', '/coverage/attempts');
  const memberships = index(c.membership_observations, 'observation_id', '/coverage/membership_observations');
  const processes = index(envelope.processes ?? [], 'process_record_id', '/processes');
  const surfaces = index(envelope.surfaces ?? [], 'surface_record_id', '/surfaces');
  function ordered(a: string | null, b: string | null, path: string) {
    if (a === null || b === null) gap('TIMING', path);
    else if (compare(a, b) > 0) issue('TIME_ORDER', path);
  }
  function chain(times: (string | null)[], path: string) {
    if (times.includes(null)) gap('TIMING', path);
    const known = times.filter((time): time is string => time !== null);
    for (let i = 1; i < known.length; i++) ordered(known[i - 1], known[i], path);
  }
  function observed(provenance: RecordValue | null, attempt: RecordValue | undefined, path: string,
    failureCompletion?: string | null) {
    if (!provenance) { gap('TIMING', path); return; }
    const time = provenance.observed_us;
    chain([envelope.collection_started_us, ...(failureCompletion !== undefined ? [failureCompletion] : []),
      ...(attempt ? [attempt.started_us] : []), time,
      ...(attempt ? [attempt.completed_us] : []), envelope.collection_completed_us], path);
  }
  ordered(envelope.collection_started_us, envelope.collection_completed_us, '/collection_completed_us');
  // Known numeric contradictions are retained even outside a resolution's fresh closure.
  for (const { value: a, path } of attempts.values()) {
    chain([envelope.collection_started_us, a.started_us, a.completed_us, envelope.collection_completed_us], path);
    observed(a.provenance, a, `${path}/provenance`);
    if (a.kernel_identity_observation) observed(a.kernel_identity_observation.provenance, a, `${path}/kernel_identity_observation/provenance`);
  }
  const resolutions = c.resolutions.map((r: RecordValue, i: number) => {
    const path = `/coverage/resolutions/${i}`, closure = new Map<string, RecordValue>();
    gap('SOURCE_TRUTH', path);
    gap('CLOCK_COMPARABILITY', path);
    // V1 has no surface capture -> reread association field, including empty inventories.
    gap('SURFACE_CAPTURE_ASSOCIATION', path);
    const failed = attempts.get(r.failed_attempt_ref)?.value;
    if (!failed || (r.disposition !== 'UNRESOLVED' && failed.round !== 1) || failed.result !== 'ESRCH' || failed.subject_pid === null)
      issue('FAILURE_ANCHOR', `${path}/failed_attempt_ref`);
    if (r.historical_launch && (!failed?.captured_launch || launchKey(r.historical_launch) !== launchKey(failed.captured_launch)))
      issue('HISTORICAL_IDENTITY', path);
    if (r.historical_binding_known && !r.historical_launch) issue('HISTORICAL_IDENTITY', path);
    if (!r.historical_binding_known) gap('HISTORICAL_BINDING', path);
    if (r.disposition === 'UNRESOLVED') {
      gap('UNRESOLVED', path); return { resolution_id: r.resolution_id, claimedInterval: null };
    }
    function fresh(id: string, operation: string, refPath: string) {
      const a = attempts.get(id)?.value;
      if (!a || a.round !== 2 || a.operation !== operation || a.result !== 'OK') issue('FRESH_ATTEMPT', refPath);
      if (a?.round === 2 && id !== r.failed_attempt_ref) closure.set(id, a);
      return a;
    }
    const owner = memberships.get(r.final_owner_membership_ref)?.value;
    if (!owner || owner.source !== 'KERNEL_OWNER' || owner.scope !== 'OWNER_LAUNCH' || !owner.authoritative || owner.members === null)
      issue('FINAL_OWNER', `${path}/final_owner_membership_ref`);
    if (owner) {
      fresh(owner.attempt_ref, 'KERNEL_MEMBERSHIP', `${path}/final_owner_membership_ref`);
      const ownerLaunches = new Set((owner.members ?? []).map(launchKey));
      if (owner.members && owner.observed_members.some((x: RecordValue) => !ownerLaunches.has(launchKey(x))))
        issue('REREAD_MEMBERSHIP', path);
    }
    const identities = new Map<string, RecordValue>();
    for (const id of r.identity_recheck_attempt_refs) {
      const a = fresh(id, 'PROCESS_IDENTITY', `${path}/identity_recheck_attempt_refs`);
      if (a) identities.set(id, a);
    }
    const cited = r.native_reread_observation_refs.map((id: string) => memberships.get(id)?.value);
    const categories = new Set<string>();
    for (const m of cited) {
      if (!m) { issue('REREAD_REFERENCE', `${path}/native_reread_observation_refs`); continue; }
      fresh(m.attempt_ref, 'NATIVE_MEMBERSHIP', `${path}/native_reread_observation_refs`);
      if (!m.authoritative || m.members === null) issue('REREAD_MEMBERSHIP', `${path}/native_reread_observation_refs`);
      else {
        categories.add(`${m.source}/${m.scope}`);
        const members = new Set(m.members);
        if (m.observed_members.some((id: string) => !members.has(id))) issue('REREAD_MEMBERSHIP', path);
      }
    }
    for (const category of required) if (!categories.has(category)) issue('REREAD_MATRIX', `${path}/${category}`);
    // These phase edges exist only among explicitly cited observations of the same source/scope.
    for (const category of categories) {
      const group = cited.filter((m: RecordValue) => m && `${m.source}/${m.scope}` === category);
      const before = group.filter((m: RecordValue) => m.phase === 'BEFORE').map((m: RecordValue) => attempts.get(m.attempt_ref)?.value.provenance.observed_us);
      const after = group.filter((m: RecordValue) => m.phase === 'AFTER').map((m: RecordValue) => attempts.get(m.attempt_ref)?.value.provenance.observed_us);
      if (before.length && after.length) {
        if (before.some((t: any) => t == null) || after.some((t: any) => t == null)) gap('TIMING', path);
        const knownBefore = before.filter((t: any): t is string => t != null).sort(compare);
        const knownAfter = after.filter((t: any): t is string => t != null).sort(compare);
        if (knownBefore.length && knownAfter.length) ordered(knownBefore.at(-1)!, knownAfter[0], path);
      }
    }
    const finalIds: string[] | null = c.final_process_refs;
    if (finalIds === null) gap('FINAL_INVENTORY', '/coverage/final_process_refs');
    const accounted: string[] = [...r.surviving_process_refs, ...r.replacement_process_refs];
    if ((finalIds !== null && !sameSet(accounted, finalIds)) || new Set(accounted).size !== accounted.length)
      issue('FINAL_ACCOUNTING', path);
    // Accounted records remain known evidence even when the final selection is unavailable.
    const accountedProcesses = accounted.map(id => processes.get(id)?.value).filter(Boolean) as RecordValue[];
    const finalIdSet = finalIds === null ? null : new Set(finalIds), accountedSet = new Set(accounted);
    const launches = accountedProcesses.filter(p => p.launch).map(p => launchKey(p.launch));
    const launchSet = new Set(launches);
    if (launchSet.size !== launches.length || new Set(accountedProcesses.map(p => p.pid)).size !== accountedProcesses.length)
      issue('FINAL_ACCOUNTING', path);
    if (owner?.members && !sameSet(owner.members.map(launchKey), launches)) issue('FINAL_ACCOUNTING', path);
    for (const id of accounted) {
      const entry = processes.get(id);
      if (!entry) { issue('FINAL_ACCOUNTING', path); continue; }
      const { value: p, path: pp } = entry;
      const a = fresh(p.attempt_ref, 'PROCESS_IDENTITY', `${pp}/attempt_ref`);
      if (!p.launch || !identities.has(p.attempt_ref) || !a?.captured_launch || launchKey(p.launch) !== launchKey(a.captured_launch) || a.subject_pid !== p.pid)
        issue('IDENTITY_REREAD', pp);
      if (p.binding === 'UNRESOLVED' || !p.identity_provenance) gap('PROCESS_BINDING', pp);
      observed(p.identity_provenance, a, `${pp}/identity_provenance`, failed?.completed_us ?? null);
      if (p.kernel_identity_observation) observed(p.kernel_identity_observation.provenance, a,
        `${pp}/kernel_identity_observation/provenance`, failed?.completed_us ?? null);
      // Path provenance is retained; v1 supplies no independent cwd-attempt link.
      observed(p.cwd.provenance, undefined, `${pp}/cwd/provenance`);
      for (const [j, protectedPath] of (p.protected_paths ?? []).entries()) observed(protectedPath.provenance, undefined, `${pp}/protected_paths/${j}/provenance`);
    }
    for (const a of identities.values()) if (!a.captured_launch || !launchSet.has(launchKey(a.captured_launch))) issue('IDENTITY_REREAD', path);
    const atFailedPid = accountedProcesses.filter(p => p.pid === failed?.subject_pid);
    if (r.disposition === 'DISAPPEARANCE_RECONCILED' && (atFailedPid.length || r.replacement_process_refs.length)) issue('DISAPPEARANCE', path);
    if (r.disposition === 'PID_REUSE_RECONCILED') {
      const replacement = atFailedPid[0];
      if (!r.historical_binding_known || !r.historical_launch || !failed?.captured_launch || atFailedPid.length !== 1 ||
        !replacement?.launch || !r.replacement_process_refs.includes(replacement.process_record_id) ||
        launchKey(replacement.launch) === launchKey(r.historical_launch)) issue('PID_REUSE', path);
    }
    for (const [id, a] of closure) {
      const ap = attempts.get(id)!.path, failureCompletion = failed?.completed_us ?? null;
      chain([failureCompletion, a.started_us, a.completed_us], path);
      observed(a.provenance, a, `${ap}/provenance`, failureCompletion);
      if (a.kernel_identity_observation) observed(a.kernel_identity_observation.provenance, a,
        `${ap}/kernel_identity_observation/provenance`, failureCompletion);
    }
    const allEndpoints = [...closure.values()].every(a => a.started_us !== null && a.completed_us !== null);
    const starts = [...closure.values()].map(a => a.started_us).filter(t => t !== null).sort(compare);
    const ends = [...closure.values()].map(a => a.completed_us).filter(t => t !== null).sort(compare);
    const claimedInterval = allEndpoints && starts.length ? { started_us: starts[0], completed_us: ends.at(-1)! } : null;
    if (!claimedInterval) gap('TIMING', path);
    const finalSurfaces = (c.final_surface_refs ?? []).map((id: string) => surfaces.get(id)).filter(Boolean) as { value: RecordValue; path: string }[];
    if (c.final_surface_refs === null) gap('FINAL_INVENTORY', '/coverage/final_surface_refs');
    for (const { value: s, path: sp } of finalSurfaces) {
      observed(s.provenance, undefined, `${sp}/provenance`);
      if (claimedInterval) {
        ordered(claimedInterval.started_us, s.provenance.observed_us, sp);
        ordered(s.provenance.observed_us, claimedInterval.completed_us, sp);
      } else gap('TIMING', sp);
      if (s.mapping !== 'MAPPED' || s.lifecycle !== 'READY') gap('SURFACE_BINDING', sp);
      if (s.process_refs === null) gap('SURFACE_BINDING', `${sp}/process_refs`);
      for (const id of s.process_refs ?? []) if ((finalIdSet !== null && !finalIdSet.has(id)) || !accountedSet.has(id))
        issue('SURFACE_PROCESS', `${sp}/process_refs`);
    }
    for (const m of cited.filter(Boolean)) {
      const field = nativeFields[m.scope];
      if (!field) { issue('NATIVE_INVENTORY', path); continue; }
      const knownIds = finalSurfaces.map(s => s.value[field]).filter(x => x !== null);
      const missingIds = finalSurfaces.some(s => s.value[field] === null) || c.final_surface_refs === null;
      if (missingIds) gap('NATIVE_INVENTORY', `${path}/${m.source}/${m.scope}`);
      const members = new Set(m.members ?? []);
      if (m.members !== null && (knownIds.some(id => !members.has(id)) || (!missingIds && !sameSet(knownIds, m.members))))
        issue('NATIVE_INVENTORY', `${path}/${m.source}/${m.scope}`);
    }
    return { resolution_id: r.resolution_id, claimedInterval };
  });
  return { scope: 'esrch-offline-witnesses', issues, unverified, resolutions, digestVerification: 'UNVERIFIED' } as const;
}
