const ACTIVE_STATES = new Set(["booting", "creating", "ready", "thinking", "working"]);
const CLOSE_STATES = new Set(["done", "idle"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNTITLED_RE = /^[a-z0-9._-]+(?:Claude|Codex|Cursor|Gemini|Kiro)\s*\[surface:\d+\]\s*$/i;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedState(observation) {
  return text(
    observation?.agent_state ??
      observation?.registry?.state ??
      observation?.parsed?.status ??
      "unknown",
  ).toLowerCase() || "unknown";
}

function explicitOwner(surface, observation) {
  const direct = text(observation?.owner);
  if (direct) return direct.replace(/^@/, "");

  for (const candidate of [
    observation?.registry?.seat_lane,
    observation?.registry?.owner,
    observation?.registry?.parent_agent_id,
  ]) {
    const value = text(candidate);
    if (value) return value.replace(/^@/, "");
  }

  const taskSummary = text(observation?.registry?.task_summary);
  const summaryMatch = taskSummary.match(/\bowner\s+lane\s*:\s*@([a-z0-9_-]+)/i);
  if (summaryMatch) return summaryMatch[1];

  const titleMatch = text(surface?.title).match(/\(@([a-z0-9_-]+)\)/i);
  return titleMatch?.[1] ?? "UNKNOWN";
}

function artifactFacts(artifact = {}) {
  const uncommitted = artifact.uncommitted === true;
  const unpushed = Number.isInteger(artifact.unpushed) && artifact.unpushed > 0
    ? artifact.unpushed
    : 0;
  const verifiedClean =
    artifact.status === "clean" && artifact.uncommitted === false && artifact.unpushed === 0;

  if (uncommitted && unpushed > 0) {
    return {
      state: `UNCOMMITTED + UNPUSHED (${unpushed} commit${unpushed === 1 ? "" : "s"})`,
      uncommitted,
      unpushed,
      verifiedClean,
    };
  }
  if (uncommitted) {
    const count = Number.isInteger(artifact.untracked_count) ? ` (${artifact.untracked_count} untracked)` : "";
    return { state: `UNCOMMITTED${count}`, uncommitted, unpushed, verifiedClean };
  }
  if (unpushed > 0) {
    return {
      state: `UNPUSHED (${unpushed} commit${unpushed === 1 ? "" : "s"})`,
      uncommitted,
      unpushed,
      verifiedClean,
    };
  }
  if (verifiedClean) {
    return { state: "CLEAN-PUSHED", uncommitted, unpushed, verifiedClean };
  }
  return { state: "UNKNOWN", uncommitted, unpushed, verifiedClean };
}

function staleRow(surface, observation) {
  return {
    surface_uuid: surface.id,
    surface: surface.ref,
    title: text(surface.title) || "(untitled)",
    owner: explicitOwner(surface, observation),
    process_alive: null,
    agent_state: "unknown",
    artifact_state: "UNKNOWN",
    identity_status: "STALE-REF",
    untitled: UNTITLED_RE.test(text(surface.title)),
    verdict: null,
    reason: "STALE-REF — re-enumerate; numeric surface ref no longer resolves to the enumerated UUID",
  };
}

export function classifyPane(surface, observation = {}) {
  if (!surface || !UUID_RE.test(text(surface.id))) {
    throw new Error("pane-liveness-check requires a stable surface UUID in surface.id");
  }
  if (observation.identity_status === "STALE-REF") return staleRow(surface, observation);

  const artifact = artifactFacts(observation.artifact);
  const agentState = normalizedState(observation);
  const processAlive = observation.process_alive === true
    ? true
    : observation.process_alive === false
      ? false
      : null;
  const owner = explicitOwner(surface, observation);
  const untitled = UNTITLED_RE.test(text(surface.title));

  let verdict;
  let reason;

  if (artifact.uncommitted || artifact.unpushed > 0) {
    verdict = "KEEP-unpushed";
    reason = artifact.uncommitted
      ? `artifact evidence is ${artifact.state}; TASK_DONE/idle cannot clear uncommitted work`
      : `HARD BLOCKER: ${artifact.unpushed} unpushed commit${artifact.unpushed === 1 ? "" : "s"}`;
  } else if (processAlive === false) {
    verdict = "DEAD-shell";
    reason = "process is verified dead; title and registry state are not liveness proof";
  } else if (processAlive !== true) {
    verdict = "KEEP-blocked";
    reason = observation.error
      ? `process liveness is unknown (${text(observation.error)}); uncertainty must KEEP`
      : "process liveness is unknown; uncertainty must KEEP";
  } else if (ACTIVE_STATES.has(agentState)) {
    verdict = "KEEP-live";
    reason = `live process is ${agentState}`;
  } else if (observation.open_lane !== "closed") {
    verdict = "KEEP-blocked";
    reason = observation.open_lane === "open"
      ? text(observation.open_lane_reason) || "lane still has in-flight, queued, or owed work"
      : "lane closure is not verified";
  } else if (!artifact.verifiedClean) {
    verdict = "KEEP-blocked";
    reason = "artifact state is UNKNOWN; clean pushed work is required before close";
  } else if (
    CLOSE_STATES.has(agentState) &&
    observation.harvest_verified === true &&
    observation.reported === true
  ) {
    verdict = "CLOSE-CANDIDATE";
    reason = "lane closed, worker harvested/reported, and artifact is clean and pushed";
  } else {
    verdict = "KEEP-blocked";
    reason = "harvest/report closure proof is incomplete";
  }

  if (untitled) {
    reason = `${reason}; UNTITLED pane must be claimed/titled or closed`;
  }

  return {
    surface_uuid: surface.id,
    surface: surface.ref,
    title: text(surface.title) || "(untitled)",
    owner,
    process_alive: processAlive,
    agent_state: agentState,
    artifact_state: artifact.state,
    identity_status: "MATCHED",
    untitled,
    verdict,
    reason,
  };
}

function surfacesFrom(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.surfaces)) return result.surfaces;
  if (Array.isArray(result?.structuredContent?.surfaces)) return result.structuredContent.surfaces;
  throw new Error("list_surfaces(verbose:true) returned no surfaces array");
}

function currentAtRef(result, ref) {
  return surfacesFrom(result).find((surface) => surface.ref === ref) ?? null;
}

function staleObservation(resolved) {
  return {
    identity_status: "STALE-REF",
    resolved_id: resolved?.id ?? null,
    resolved_title: resolved?.title ?? null,
  };
}

function sameUuid(surface, expectedUuid) {
  return surface && text(surface.id).toLowerCase() === text(expectedUuid).toLowerCase();
}

function processAliveFromControl(controlState) {
  if (["dead", "stale_surface"].includes(controlState)) return false;
  if (["ready", "busy", "working", "thinking", "booting"].includes(controlState)) return true;
  return null;
}

export async function runPaneLivenessSweep(adapter) {
  const initial = surfacesFrom(await adapter.listSurfaces({ verbose: true }));
  const terminalSurfaces = initial.filter((surface) => surface.type !== "browser");
  const seen = new Set();
  const rows = [];

  for (const surface of terminalSurfaces) {
    if (!UUID_RE.test(text(surface.id))) {
      throw new Error(`surface ${surface.ref ?? "UNKNOWN"} is missing stable id from verbose list_surfaces`);
    }
    const uuidKey = surface.id.toLowerCase();
    if (seen.has(uuidKey)) throw new Error(`duplicate surface UUID in enumeration: ${surface.id}`);
    seen.add(uuidKey);

    try {
      const preRead = currentAtRef(await adapter.listSurfaces({ verbose: true }), surface.ref);
      if (!sameUuid(preRead, surface.id)) {
        rows.push(classifyPane(surface, staleObservation(preRead)));
        continue;
      }

      const atomicReceipt = await adapter.atomicRead(surface.ref, { expectedUuid: surface.id });
      const atomicUuid = atomicReceipt?.surface_id ?? atomicReceipt?.id ?? atomicReceipt?.surface_uuid;
      if (text(atomicUuid).toLowerCase() !== uuidKey) {
        rows.push(classifyPane(surface, staleObservation({ id: atomicUuid, title: atomicReceipt?.title })));
        continue;
      }

      const preParsedRead = currentAtRef(await adapter.listSurfaces({ verbose: true }), surface.ref);
      if (!sameUuid(preParsedRead, surface.id)) {
        rows.push(classifyPane(surface, staleObservation(preParsedRead)));
        continue;
      }

      const parsed = await adapter.readParsedScreen(surface.ref);
      const parsedUuid = parsed?.surface_uuid ?? parsed?.surface_id ?? parsed?.id;
      if (text(parsedUuid) && text(parsedUuid).toLowerCase() !== uuidKey) {
        rows.push(classifyPane(surface, staleObservation({ id: parsedUuid, title: parsed?.title })));
        continue;
      }

      const postRead = currentAtRef(await adapter.listSurfaces({ verbose: true }), surface.ref);
      if (!sameUuid(postRead, surface.id)) {
        rows.push(classifyPane(surface, staleObservation(postRead)));
        continue;
      }

      const evidence = await adapter.collectEvidence(surface, { atomicReceipt, parsed });
      const controlState = parsed?.parsed?.control_state ?? parsed?.control_state;
      rows.push(
        classifyPane(surface, {
          ...evidence,
          identity_status: "MATCHED",
          parsed: parsed?.parsed ?? parsed,
          agent_state: evidence?.agent_state ?? parsed?.parsed?.status ?? parsed?.status,
          process_alive: Object.prototype.hasOwnProperty.call(evidence ?? {}, "process_alive")
            ? evidence.process_alive
            : processAliveFromControl(controlState),
        }),
      );
    } catch (error) {
      rows.push(
        classifyPane(surface, {
          identity_status: "MATCHED",
          process_alive: null,
          agent_state: "unknown",
          open_lane: "unknown",
          artifact: { status: "unknown", uncommitted: null, unpushed: null },
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  return rows;
}

function markdownCell(value) {
  if (value === null || value === undefined) return "UNKNOWN";
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

export function formatMarkdown(rows) {
  const header =
    "surface_uuid | surface | title | owner | process alive? | agent state | artifact state | verdict | reason";
  const divider = "--- | --- | --- | --- | --- | --- | --- | --- | ---";
  const body = rows.map((row) =>
    [
      row.surface_uuid,
      row.surface,
      row.title,
      row.owner,
      row.process_alive,
      row.agent_state,
      row.artifact_state,
      row.verdict ?? "STALE-REF — re-enumerate",
      row.reason,
    ].map(markdownCell).join(" | "),
  );
  return [header, divider, ...body].join("\n");
}
