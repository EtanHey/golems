/**
 * Health check logic for Cloud Worker.
 *
 * Extracted from cloud-worker.ts so it's testable.
 * /health — liveness (is the process up and golems loaded?)
 * /ready — readiness (is the service able to serve requests?)
 */

interface HealthInput {
  golemStatus: string;
  startTime: number;
}

interface HealthResponse {
  status: number;
  body: {
    status: "ok" | "degraded" | "error";
    golemStatus: string;
    uptime: number;
    backend?: string;
    stateBackend?: string;
    telegramMode?: string;
    israelTime?: string;
    isWorkHours?: boolean;
    isWorkday?: boolean;
  };
}

/**
 * Build the /health response.
 * Returns 200 only when golems are running. 503 otherwise.
 */
export function buildHealthResponse(input: HealthInput): HealthResponse {
  const { golemStatus, startTime } = input;
  const uptime = Math.round((Date.now() - startTime) / 1000);

  if (golemStatus === "running") {
    return {
      status: 200,
      body: {
        status: "ok",
        golemStatus,
        uptime,
      },
    };
  }

  if (golemStatus.startsWith("error")) {
    return {
      status: 503,
      body: {
        status: "error",
        golemStatus,
        uptime,
      },
    };
  }

  // loading or any other state
  return {
    status: 503,
    body: {
      status: "degraded",
      golemStatus,
      uptime,
    },
  };
}

interface ReadyInput {
  golemStatus: string;
  dbConnected: boolean;
}

interface ReadyResponse {
  status: number;
  body: {
    ready: boolean;
    checks: {
      golems: boolean;
      db: boolean;
    };
  };
}

/**
 * Build the /ready response.
 * Returns 200 only when all critical systems are operational.
 */
export function buildReadyResponse(input: ReadyInput): ReadyResponse {
  const golemsOk = input.golemStatus === "running";
  const dbOk = input.dbConnected;
  const ready = golemsOk && dbOk;

  return {
    status: ready ? 200 : 503,
    body: {
      ready,
      checks: {
        golems: golemsOk,
        db: dbOk,
      },
    },
  };
}

/**
 * Check DB connectivity by running a simple query.
 */
export async function checkDbConnectivity(): Promise<boolean> {
  try {
    const { getSupabase } = await import("@golems/shared/lib/supabase-factory");
    const sb = getSupabase();
    if (!sb) return false;
    const { error } = await sb.from("golem_state").select("key").limit(1);
    return !error;
  } catch {
    return false;
  }
}
