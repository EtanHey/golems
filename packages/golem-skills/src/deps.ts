import { platform } from "node:os";

export type OS = "darwin" | "linux" | "win32";

export interface DependencyResult {
  name: string;
  found: boolean;
  path?: string;
  version?: string;
}

/**
 * Detect the current operating system.
 */
export function detectOS(): OS {
  return platform() as OS;
}

/**
 * Check if a binary is available on PATH and optionally get its version.
 */
export async function checkDependency(name: string): Promise<DependencyResult> {
  try {
    const whichCmd = platform() === "win32" ? "where" : "which";
    const whichProc = Bun.spawn([whichCmd, name], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const whichOut = (await new Response(whichProc.stdout).text()).trim();
    const whichCode = await whichProc.exited;

    if (whichCode !== 0 || !whichOut) {
      return { name, found: false };
    }

    // Try to get version
    let version: string | undefined;
    try {
      const verProc = Bun.spawn([name, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const verOut = (await new Response(verProc.stdout).text()).trim();
      const verCode = await verProc.exited;
      if (verCode === 0 && verOut) {
        // Extract first line, strip common prefixes
        const firstLine = verOut.split("\n")[0];
        version = firstLine.replace(/^v/, "").trim();
      }
    } catch {
      // version detection is best-effort
    }

    return { name, found: true, path: whichOut, version };
  } catch {
    return { name, found: false };
  }
}
