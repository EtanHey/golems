/**
 * System Detection Utilities
 *
 * Shared detection functions used by wizard, doctor, and janitor.
 * All functions return: { available: boolean, version?: string, path?: string, details?: Record<string, unknown> }
 */

import { execSync } from "child_process";

/** Result of detecting a system component (tool, runtime, etc.) */
export interface DetectionResult {
  available: boolean;
  version?: string;
  path?: string;
  details?: Record<string, unknown>;
}

/**
 * Helper: safely run shell command
 * @param cmd - Shell command to execute
 * @returns Object with success status and trimmed output
 */
function safeExec(cmd: string): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, { encoding: "utf-8", stdio: "pipe" }).trim();
    return { ok: true, output };
  } catch {
    return { ok: false, output: "" };
  }
}

/**
 * Detect operating system and version
 * @returns Detection result with platform (macOS/Linux/Windows) and version
 */
export function detectOS(): DetectionResult {
  const uname = safeExec("uname -s");
  if (!uname.ok) {
    return { available: false };
  }

  const os = uname.output.toLowerCase();

  if (os === "darwin") {
    const version = safeExec("sw_vers -productVersion");
    return {
      available: true,
      version: version.ok ? version.output : undefined,
      details: { platform: "macOS" },
    };
  }

  if (os === "linux") {
    const version = safeExec("uname -r");
    return {
      available: true,
      version: version.ok ? version.output : undefined,
      details: { platform: "Linux" },
    };
  }

  if (os.includes("mingw") || os.includes("msys") || os.includes("cygwin")) {
    const version = safeExec("cmd /c ver");
    return {
      available: true,
      version: version.ok ? version.output : undefined,
      details: { platform: "Windows" },
    };
  }

  return {
    available: true,
    details: { platform: uname.output },
  };
}

/**
 * Detect shell and version
 * @returns Detection result with shell type (zsh/bash/fish) and version
 */
export function detectShell(): DetectionResult {
  const shellPath = safeExec("echo $SHELL");
  if (!shellPath.ok) {
    return { available: false };
  }

  const path = shellPath.output;
  let shell = "unknown";
  let versionCmd = "";

  if (path.includes("zsh")) {
    shell = "zsh";
    versionCmd = "zsh --version";
  } else if (path.includes("bash")) {
    shell = "bash";
    versionCmd = "bash --version";
  } else if (path.includes("fish")) {
    shell = "fish";
    versionCmd = "fish --version";
  } else {
    return {
      available: true,
      path,
      details: { shell: "unknown" },
    };
  }

  const versionResult = safeExec(versionCmd);
  let version: string | undefined;

  if (versionResult.ok) {
    // Extract version number from output
    const match = versionResult.output.match(/(\d+\.\d+(?:\.\d+)?)/);
    version = match ? match[1] : undefined;
  }

  return {
    available: true,
    version,
    path,
    details: { shell },
  };
}

/**
 * Detect Node.js runtime (bun or node)
 * @returns Detection result with runtime type (bun/node), version, and path. Bun is checked first.
 */
export function detectNodeRuntime(): DetectionResult {
  // Try bun first
  const bunWhich = safeExec("which bun");
  if (bunWhich.ok) {
    const bunVersion = safeExec("bun --version");
    return {
      available: true,
      version: bunVersion.ok ? bunVersion.output : undefined,
      path: bunWhich.output,
      details: { runtime: "bun" },
    };
  }

  // Fall back to node
  const nodeWhich = safeExec("which node");
  if (nodeWhich.ok) {
    const nodeVersion = safeExec("node --version");
    let version: string | undefined;
    if (nodeVersion.ok) {
      // Strip leading 'v' from node version
      version = nodeVersion.output.replace(/^v/, "");
    }
    return {
      available: true,
      version,
      path: nodeWhich.output,
      details: { runtime: "node" },
    };
  }

  return { available: false };
}

/**
 * Detect Docker installation and running status
 * @returns Detection result with version and running status (daemon check)
 */
export function detectDocker(): DetectionResult {
  const dockerVersion = safeExec("docker --version");
  if (!dockerVersion.ok) {
    return { available: false };
  }

  // Extract version number
  const match = dockerVersion.output.match(/(\d+\.\d+\.\d+)/);
  const version = match ? match[1] : undefined;

  // Check if daemon is running
  const dockerInfo = safeExec("docker info >/dev/null 2>&1");
  const running = dockerInfo.ok;

  return {
    available: true,
    version,
    details: { running },
  };
}

/**
 * Detect launchd services (macOS only)
 * @returns Detection result with list of loaded golems-related plists. Returns unavailable on non-macOS.
 */
export function detectLaunchd(): DetectionResult {
  const os = safeExec("uname -s");
  if (!os.ok || os.output !== "Darwin") {
    return { available: false };
  }

  const list = safeExec("launchctl list 2>/dev/null | grep golems || true");
  if (!list.ok) {
    return { available: true, details: { loaded: [] } };
  }

  // Parse output: each line is "PID\tStatus\tLabel"
  const loaded = list.output
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const parts = line.split(/\s+/);
      return parts[2]; // Label is third column
    })
    .filter(Boolean);

  return {
    available: true,
    details: { loaded },
  };
}

/**
 * Detect GPU for Ollama (Apple Silicon / NVIDIA / none)
 * @returns Detection result with GPU type and model. Returns unavailable if no compatible GPU found.
 */
export function detectGPU(): DetectionResult {
  const arch = safeExec("uname -m");
  if (!arch.ok) {
    return { available: false };
  }

  // Apple Silicon
  if (arch.output === "arm64") {
    const cpu = safeExec("sysctl -n machdep.cpu.brand_string");
    return {
      available: true,
      details: {
        type: "Apple Silicon",
        model: cpu.ok ? cpu.output : "Unknown",
      },
    };
  }

  // Check for NVIDIA
  const nvidia = safeExec(
    "nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || true",
  );
  if (nvidia.ok && nvidia.output) {
    return {
      available: true,
      details: {
        type: "NVIDIA",
        model: nvidia.output,
      },
    };
  }

  return { available: false };
}

/**
 * Detect RAM (total and available in GB)
 * @returns Detection result with totalGB and availableGB. Supports macOS and Linux.
 */
export function detectRAM(): DetectionResult {
  const os = safeExec("uname -s");
  if (!os.ok) {
    return { available: false };
  }

  if (os.output === "Darwin") {
    // macOS
    const totalBytes = safeExec("sysctl -n hw.memsize");
    if (!totalBytes.ok) {
      return { available: false };
    }

    const totalGB = Math.round(
      parseInt(totalBytes.output) / 1024 / 1024 / 1024,
    );

    // Available memory (approximate via vm_stat)
    const freePages = safeExec(
      "vm_stat | grep 'Pages free' | awk '{print $3}' | sed 's/\\.//'",
    );
    let availableGB: number | undefined;
    if (freePages.ok && freePages.output) {
      const pages = parseInt(freePages.output);
      if (!isNaN(pages)) {
        availableGB = Math.round((pages * 4096) / 1024 / 1024 / 1024);
      }
    }

    return {
      available: true,
      details: { totalGB, availableGB },
    };
  }

  if (os.output === "Linux") {
    // Linux
    const totalKB = safeExec("grep MemTotal /proc/meminfo | awk '{print $2}'");
    const availableKB = safeExec(
      "grep MemAvailable /proc/meminfo | awk '{print $2}'",
    );

    if (!totalKB.ok) {
      return { available: false };
    }

    const totalGB = Math.round(parseInt(totalKB.output) / 1024 / 1024);
    const availableGB = availableKB.ok
      ? Math.round(parseInt(availableKB.output) / 1024 / 1024)
      : undefined;

    return {
      available: true,
      details: { totalGB, availableGB },
    };
  }

  return { available: false };
}

/**
 * Detect Python 3 installation and pip packages (optional)
 * @returns Detection result with version, path, and list of installed packages (if available)
 */
export function detectPython(): DetectionResult {
  const pythonWhich = safeExec("which python3");
  if (!pythonWhich.ok) {
    return { available: false };
  }

  const pythonVersion = safeExec("python3 --version");
  let version: string | undefined;
  if (pythonVersion.ok) {
    // Extract version: "Python 3.11.5" -> "3.11.5"
    const match = pythonVersion.output.match(/Python (\d+\.\d+\.\d+)/);
    version = match ? match[1] : undefined;
  }

  // Try to get pip packages (non-fatal if fails)
  const pipList = safeExec(
    "python3 -m pip list --format=freeze 2>/dev/null || true",
  );
  const packages = pipList.ok
    ? pipList.output.split("\n").filter((line) => line.trim())
    : [];

  return {
    available: true,
    version,
    path: pythonWhich.output,
    details: { packages },
  };
}

/**
 * Check if a port is in use
 * @param port - Port number to check
 * @returns Detection result with inUse boolean and PID if port is occupied
 */
export function checkPort(port: number): DetectionResult {
  const lsof = safeExec(`lsof -i :${port} -t 2>/dev/null || true`);

  if (lsof.ok && lsof.output) {
    return {
      available: true,
      details: {
        inUse: true,
        pid: lsof.output,
      },
    };
  }

  return {
    available: true,
    details: {
      inUse: false,
    },
  };
}
