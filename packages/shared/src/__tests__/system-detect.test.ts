import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import * as childProcess from "child_process";
import {
  detectOS,
  detectShell,
  detectNodeRuntime,
  detectDocker,
  detectLaunchd,
  detectGPU,
  detectRAM,
  detectPython,
  checkPort,
} from "@golems/shared/lib/system-detect";

// Use spyOn instead of mock.module to avoid global pollution of child_process
const mockExecSync = mock((cmd: string, options?: any) => {
  throw new Error("execSync not mocked for this test");
});

describe("system-detect", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    spyOn(childProcess, "execSync").mockImplementation(mockExecSync as any);
  });

  afterEach(() => {
    mock.restore();
  });

  describe("detectOS", () => {
    test("detects macOS", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "uname -s") return "Darwin\n";
        if (cmd === "sw_vers -productVersion") return "14.2.1\n";
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectOS();
      expect(result.available).toBe(true);
      expect(result.details?.platform).toBe("macOS");
      expect(result.version).toBe("14.2.1");
    });

    test("detects Linux", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "uname -s") return "Linux\n";
        if (cmd === "uname -r") return "5.15.0-91-generic\n";
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectOS();
      expect(result.available).toBe(true);
      expect(result.details?.platform).toBe("Linux");
      expect(result.version).toBe("5.15.0-91-generic");
    });

    test("handles detection failure", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("Command failed");
      });

      const result = detectOS();
      expect(result.available).toBe(false);
    });
  });

  describe("detectShell", () => {
    test("detects zsh", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "echo $SHELL") return "/bin/zsh\n";
        if (cmd === "zsh --version") return "zsh 5.9 (x86_64-apple-darwin23.0)\n";
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectShell();
      expect(result.available).toBe(true);
      expect(result.details?.shell).toBe("zsh");
      expect(result.version).toBe("5.9");
    });

    test("detects bash", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "echo $SHELL") return "/bin/bash\n";
        if (cmd === "bash --version") return "GNU bash, version 5.2.15\n";
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectShell();
      expect(result.available).toBe(true);
      expect(result.details?.shell).toBe("bash");
      expect(result.version).toBe("5.2.15");
    });

    test("handles fish shell", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "echo $SHELL") return "/usr/local/bin/fish\n";
        if (cmd === "fish --version") return "fish, version 3.6.1\n";
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectShell();
      expect(result.available).toBe(true);
      expect(result.details?.shell).toBe("fish");
      expect(result.version).toBe("3.6.1");
    });
  });

  describe("detectNodeRuntime", () => {
    test("detects bun", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "which bun") return "/opt/homebrew/bin/bun\n";
        if (cmd === "bun --version") return "1.2.3\n";
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectNodeRuntime();
      expect(result.available).toBe(true);
      expect(result.details?.runtime).toBe("bun");
      expect(result.version).toBe("1.2.3");
      expect(result.path).toBe("/opt/homebrew/bin/bun");
    });

    test("detects node when bun not found", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "which bun") throw new Error("not found");
        if (cmd === "which node") return "/usr/local/bin/node\n";
        if (cmd === "node --version") return "v20.11.0\n";
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectNodeRuntime();
      expect(result.available).toBe(true);
      expect(result.details?.runtime).toBe("node");
      expect(result.version).toBe("20.11.0");
    });

    test("handles no runtime found", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("not found");
      });

      const result = detectNodeRuntime();
      expect(result.available).toBe(false);
    });
  });

  describe("detectDocker", () => {
    test("detects docker running", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "docker --version") return "Docker version 24.0.7, build afdd53b\n";
        if (cmd === "docker info >/dev/null 2>&1") return "";
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectDocker();
      expect(result.available).toBe(true);
      expect(result.version).toBe("24.0.7");
      expect(result.details?.running).toBe(true);
    });

    test("detects docker installed but not running", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "docker --version") return "Docker version 24.0.7, build afdd53b\n";
        if (cmd === "docker info >/dev/null 2>&1") throw new Error("daemon not running");
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectDocker();
      expect(result.available).toBe(true);
      expect(result.version).toBe("24.0.7");
      expect(result.details?.running).toBe(false);
    });

    test("handles docker not installed", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("not found");
      });

      const result = detectDocker();
      expect(result.available).toBe(false);
    });
  });

  describe("detectLaunchd", () => {
    test("finds loaded golem services", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "uname -s") return "Darwin\n";
        if (cmd === "launchctl list 2>/dev/null | grep golems || true") {
          return `12345	0	com.golemszikaron.nightshift
23456	0	com.golemszikaron.email-golem
34567	0	com.golemszikaron.briefing\n`;
        }
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectLaunchd();
      expect(result.available).toBe(true);
      expect(result.details?.loaded).toEqual([
        "com.golemszikaron.nightshift",
        "com.golemszikaron.email-golem",
        "com.golemszikaron.briefing",
      ]);
    });

    test("returns not available on non-macOS", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "uname -s") return "Linux\n";
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectLaunchd();
      expect(result.available).toBe(false);
    });

    test("handles no golem services loaded", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "uname -s") return "Darwin\n";
        if (cmd === "launchctl list 2>/dev/null | grep golems || true") return "";
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectLaunchd();
      expect(result.available).toBe(true);
      expect(result.details?.loaded).toEqual([]);
    });
  });

  describe("detectGPU", () => {
    test("detects Apple Silicon", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "uname -m") return "arm64\n";
        if (cmd === "sysctl -n machdep.cpu.brand_string") return "Apple M1 Max\n";
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectGPU();
      expect(result.available).toBe(true);
      expect(result.details?.type).toBe("Apple Silicon");
      expect(result.details?.model).toBe("Apple M1 Max");
    });

    test("detects NVIDIA GPU on Linux", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "uname -m") return "x86_64\n";
        if (cmd === "nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || true") {
          return "NVIDIA GeForce RTX 4090\n";
        }
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectGPU();
      expect(result.available).toBe(true);
      expect(result.details?.type).toBe("NVIDIA");
      expect(result.details?.model).toBe("NVIDIA GeForce RTX 4090");
    });

    test("detects no GPU", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "uname -m") return "x86_64\n";
        if (cmd === "nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || true") {
          return "";
        }
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectGPU();
      expect(result.available).toBe(false);
    });
  });

  describe("detectRAM", () => {
    test("detects RAM on macOS", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "uname -s") return "Darwin\n";
        if (cmd === "sysctl -n hw.memsize") return "68719476736\n"; // 64 GB
        if (cmd === "vm_stat | grep 'Pages free' | awk '{print $3}' | sed 's/\\.//'") {
          return "2097152\n"; // ~8 GB free (in pages)
        }
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectRAM();
      expect(result.available).toBe(true);
      expect(result.details?.totalGB).toBe(64);
      expect(result.details?.availableGB).toBeDefined();
      if (result.details?.availableGB !== undefined) {
        expect(result.details.availableGB).toBeGreaterThan(0);
      }
    });

    test("detects RAM on Linux", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "uname -s") return "Linux\n";
        if (cmd === "grep MemTotal /proc/meminfo | awk '{print $2}'") {
          return "33554432\n"; // 32 GB in KB
        }
        if (cmd === "grep MemAvailable /proc/meminfo | awk '{print $2}'") {
          return "16777216\n"; // 16 GB in KB
        }
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectRAM();
      expect(result.available).toBe(true);
      expect(result.details?.totalGB).toBe(32);
      expect(result.details?.availableGB).toBe(16);
    });

    test("handles detection failure", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("Command failed");
      });

      const result = detectRAM();
      expect(result.available).toBe(false);
    });
  });

  describe("detectPython", () => {
    test("detects python3 with packages", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "which python3") return "/usr/bin/python3\n";
        if (cmd === "python3 --version") return "Python 3.11.5\n";
        if (cmd === "python3 -m pip list --format=freeze 2>/dev/null || true") {
          return "numpy==1.24.3\nscipy==1.11.1\n";
        }
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectPython();
      expect(result.available).toBe(true);
      expect(result.version).toBe("3.11.5");
      expect(result.path).toBe("/usr/bin/python3");
      expect(result.details?.packages).toEqual(["numpy==1.24.3", "scipy==1.11.1"]);
    });

    test("detects python without packages", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "which python3") return "/usr/bin/python3\n";
        if (cmd === "python3 --version") return "Python 3.11.5\n";
        if (cmd === "python3 -m pip list --format=freeze 2>/dev/null || true") return "";
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = detectPython();
      expect(result.available).toBe(true);
      expect(result.details?.packages).toEqual([]);
    });

    test("handles python not found", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("not found");
      });

      const result = detectPython();
      expect(result.available).toBe(false);
    });
  });

  describe("checkPort", () => {
    test("detects port in use", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "lsof -i :3847 -t 2>/dev/null || true") return "12345\n";
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = checkPort(3847);
      expect(result.available).toBe(true);
      expect(result.details?.inUse).toBe(true);
      expect(result.details?.pid).toBe("12345");
    });

    test("detects port not in use", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "lsof -i :3847 -t 2>/dev/null || true") return "";
        throw new Error(`Unmocked: ${cmd}`);
      });

      const result = checkPort(3847);
      expect(result.available).toBe(true);
      expect(result.details?.inUse).toBe(false);
    });
  });
});
