type JsonRecord = Record<string, any>;
export type CensusCoreIssue = { code: string; path: string };
/** Shape-validated v1 input only. No lexical, digest, witness, trust or GC approval. */
export function validateCensusCoreRelations(envelope: JsonRecord) {
  const issues: CensusCoreIssue[] = [];
  const issue = (code: string, path: string) => { issues.push({ code, path }); };
  const nulls = new Set<string>();
  const sources = new Set((envelope.source_versions ?? []).map((x: JsonRecord) => x.component));
  function walk(value: any, path = '') {
    if (value === null) { nulls.add(path); return; }
    if (typeof value !== 'object') return;
    if ('source_component' in value && !sources.has(value.source_component)) issue('REFERENCE', path);
    for (const [key, child] of Object.entries(value)) {
      if (path === '' && key === 'missing_evidence') continue;
      walk(child, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
    }
  }
  walk(envelope);
  const reasons = new Map<string, JsonRecord>();
  for (const reason of envelope.missing_evidence) {
    if (reasons.has(reason.field_path) || !nulls.has(reason.field_path)) issue('NULL_REASON', reason.field_path);
    reasons.set(reason.field_path, reason);
  }
  for (const path of nulls) if (!reasons.has(path)) issue('NULL_REASON', path);

  const coverage = envelope.coverage;
  const groups: [string, JsonRecord[], string, string][] = [
    ['attempt', coverage.attempts, 'attempt_id', '/coverage/attempts'],
    ['membership', coverage.membership_observations, 'observation_id', '/coverage/membership_observations'],
    ['resolution', coverage.resolutions, 'resolution_id', '/coverage/resolutions'],
    ['surface', envelope.surfaces ?? [], 'surface_record_id', '/surfaces'],
    ['process', envelope.processes ?? [], 'process_record_id', '/processes'],
    ['registration', envelope.registration_dispositions ?? [], 'registration_record_id', '/registration_dispositions'],
  ];
  const records = new Map<string, { kind: string; value: JsonRecord }>();
  for (const [kind, values, idKey, prefix] of groups) values.forEach((value, index) => {
    if (records.has(value[idKey])) issue('RECORD_ID', `${prefix}/${index}/${idKey}`);
    else records.set(value[idKey], { kind, value });
  });
  function reference(id: string | null, kind: string, path: string) {
    if (id === null) return;
    const record = records.get(id);
    if (!record || (kind !== '*' && record.kind !== kind)) { issue('REFERENCE', path); return; }
    return record.value;
  }
  const refs = (ids: string[] | null, kind: string, path: string) =>
    (ids ?? []).forEach((id, index) => reference(id, kind, `${path}/${index}`));
  const tuple = (launch: JsonRecord) => JSON.stringify([
    launch.host_id, launch.os_boot_id, launch.pid, launch.start_seconds, launch.start_microseconds,
  ]);
  const complete = (launch: JsonRecord | null) => !!launch &&
    ['host_id', 'os_boot_id', 'pid', 'start_seconds', 'start_microseconds'].every(key => launch[key] != null);
  const bound = (launch: JsonRecord | null) => complete(launch) && envelope.host_id !== null &&
    envelope.os_boot_id !== null && launch!.host_id === envelope.host_id && launch!.os_boot_id === envelope.os_boot_id;
  function agree(left: any, right: any, path: string) {
    if (left != null && right != null && left !== right) issue('IDENTITY_COMPONENT', path);
  }
  function identity(full: JsonRecord | null, partial: JsonRecord | undefined, pid: number | null, path: string) {
    for (const value of [full, partial]) if (value) {
      agree(value.host_id, envelope.host_id, path); agree(value.os_boot_id, envelope.os_boot_id, path);
      agree(value.pid, pid, path); agree(value.uid, envelope.owner_uid, path);
    }
    if (full && partial) for (const key of ['host_id', 'os_boot_id', 'pid', 'start_seconds', 'start_microseconds'])
      agree(full[key], partial[key], `${path}/kernel_identity_observation/${key}`);
  }

  (envelope.processes ?? []).forEach((process: JsonRecord, index: number) => {
    const path = `/processes/${index}`;
    const attempt = reference(process.attempt_ref, 'attempt', `${path}/attempt_ref`);
    identity(process.launch, process.kernel_identity_observation, process.pid, path);
    if (attempt) {
      agree(process.pid, attempt.subject_pid, `${path}/attempt_ref`);
      for (const key of ['host_id', 'os_boot_id', 'pid', 'start_seconds', 'start_microseconds', 'uid'])
        agree(process.launch?.[key] ?? process.kernel_identity_observation?.[key] ?? (key === 'uid' ? process.uid : null),
          attempt.captured_launch?.[key] ?? attempt.kernel_identity_observation?.[key], `${path}/attempt_ref/${key}`);
    }
    agree(process.uid, envelope.owner_uid, `${path}/uid`);
    agree(process.uid, process.kernel_identity_observation?.uid, `${path}/uid`);
    if (process.binding === 'VERIFIED' && (!bound(process.launch) || process.uid === null || envelope.owner_uid === null))
      issue('IDENTITY_COMPONENT', `${path}/binding`);
    if (process.classification === 'ORDINARY_SHELL' && process.session_id === null &&
      reasons.get(`${path}/session_id`)?.reason_code !== 'NOT_APPLICABLE') issue('NULL_REASON', `${path}/session_id`);
  });
  coverage.attempts.forEach((attempt: JsonRecord, index: number) =>
    identity(attempt.captured_launch, attempt.kernel_identity_observation, attempt.subject_pid, `/coverage/attempts/${index}`));
  coverage.membership_observations.forEach((observation: JsonRecord, index: number) => {
    const path = `/coverage/membership_observations/${index}`;
    reference(observation.attempt_ref, 'attempt', `${path}/attempt_ref`);
    if (observation.scope !== 'OWNER_LAUNCH') return;
    for (const field of ['members', 'observed_members']) (observation[field] ?? []).forEach((launch: JsonRecord, i: number) =>
      identity(launch, undefined, launch.pid, `${path}/${field}/${i}`));
    const pids = (observation.members ?? []).map((launch: JsonRecord) => launch.pid);
    if (observation.authoritative && new Set(pids).size !== pids.length) issue('FINAL_IDENTITY', `${path}/members`);
  });
  (envelope.surfaces ?? []).forEach((surface: JsonRecord, index: number) =>
    refs(surface.process_refs, 'process', `/surfaces/${index}/process_refs`));
  envelope.blockers.forEach((blocker: JsonRecord, index: number) =>
    reference(blocker.subject_ref, '*', `/blockers/${index}/subject_ref`));

  const rawRows = new Set<string>();
  (envelope.registration_dispositions ?? []).forEach((registration: JsonRecord, index: number) => {
    const path = `/registration_dispositions/${index}`;
    const row = JSON.stringify([registration.row_ref.registry_id, registration.row_ref.row_number]);
    if (rawRows.has(row)) issue('RAW_ROW', `${path}/row_ref`);
    rawRows.add(row);
    const harness = reference(registration.harness_process_ref, 'process', `${path}/harness_process_ref`);
    identity(registration.captured_launch, registration.kernel_identity_observation, harness?.pid ?? null, path);
    if (registration.disposition === 'VERIFIED_CURRENT' && (!bound(registration.captured_launch) ||
      !harness || !bound(harness.launch) || tuple(harness.launch) !== tuple(registration.captured_launch)))
      issue('IDENTITY_COMPONENT', `${path}/captured_launch`);
  });
  refs(coverage.process_observation_refs, 'process', '/coverage/process_observation_refs');
  const observed = new Set(coverage.process_observation_refs);
  const processes = envelope.processes ?? [];
  if (observed.size !== coverage.process_observation_refs.length || observed.size !== processes.length ||
    processes.some((process: JsonRecord) => !observed.has(process.process_record_id))) issue('OBSERVATION_UNION', '/coverage/process_observation_refs');

  const finalPids = new Set<number>(), finalLaunches = new Set<string>();
  (coverage.final_process_refs ?? []).forEach((id: string, index: number) => {
    const path = `/coverage/final_process_refs/${index}`;
    const process = reference(id, 'process', path);
    if (!process) return;
    if (!bound(process.launch) || process.uid === null || envelope.owner_uid === null || process.cwd.path === null) {
      issue('FINAL_IDENTITY', path); return;
    }
    const launch = tuple(process.launch);
    if (finalPids.has(process.pid) || finalLaunches.has(launch)) issue('FINAL_IDENTITY', path);
    finalPids.add(process.pid); finalLaunches.add(launch);
  });
  const finalDiagnostics = new Set<string>(), finalSurfaces = new Set<string>();
  (coverage.final_surface_refs ?? []).forEach((id: string, index: number) => {
    const path = `/coverage/final_surface_refs/${index}`, surface = reference(id, 'surface', path);
    if (!surface) return;
    for (const [key, seen] of [['diagnostic_id', finalDiagnostics], ['surface_id', finalSurfaces]] as const) {
      if (surface[key] === null) continue;
      if (seen.has(surface[key])) issue('FINAL_IDENTITY', path);
      seen.add(surface[key]);
    }
  });
  refs(coverage.final_registration_refs, 'registration', '/coverage/final_registration_refs');
  coverage.resolutions.forEach((resolution: JsonRecord, index: number) => {
    const path = `/coverage/resolutions/${index}`;
    const failed = reference(resolution.failed_attempt_ref, 'attempt', `${path}/failed_attempt_ref`);
    reference(resolution.final_owner_membership_ref, 'membership', `${path}/final_owner_membership_ref`);
    refs(resolution.identity_recheck_attempt_refs, 'attempt', `${path}/identity_recheck_attempt_refs`);
    refs(resolution.native_reread_observation_refs, 'membership', `${path}/native_reread_observation_refs`);
    refs(resolution.surviving_process_refs, 'process', `${path}/surviving_process_refs`);
    refs(resolution.replacement_process_refs, 'process', `${path}/replacement_process_refs`);
    if (resolution.historical_launch && (!complete(failed?.captured_launch) ||
      tuple(resolution.historical_launch) !== tuple(failed!.captured_launch))) issue('HISTORICAL_IDENTITY', path);
    if (resolution.historical_binding_known && (!bound(resolution.historical_launch) || !bound(failed?.captured_launch)))
      issue('HISTORICAL_IDENTITY', path);
  });
  return { valid: issues.length === 0, issues, scope: 'core-relations', digestVerification: 'UNVERIFIED' } as const;
}
