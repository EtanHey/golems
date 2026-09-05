/**
 * Session Archiver - Tiered archival for Claude Code sessions
 *
 * Keeps last N sessions per project (not by date!), archives older to iCloud.
 * Preserves metadata for future re-indexing with new embedding models.
 *
 * Usage:
 *   bun src/session-archiver.ts                    # Dry run
 *   bun src/session-archiver.ts --execute          # Actually archive
 *   bun src/session-archiver.ts --sessions 10     # Keep 10 instead of 7
 */

import {
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
  mkdirSync,
  renameSync,
  writeFileSync,
  unlinkSync,
  lstatSync,
  realpathSync,
  rmSync,
} from "fs";
import { join, basename, dirname } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";

// Configuration
// Keep sessions from the last N DAYS of activity (not N sessions!)
// If you worked 7 days in the past month, keep all sessions from those 7 days
const ACTIVITY_DAYS_TO_KEEP = parseInt(
  process.env.ACTIVITY_DAYS_TO_KEEP || "7",
);
const CLAUDE_DIR = join(homedir(), ".claude");
const CLAUDE_PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const CLAUDE_JSON_PATH = join(homedir(), ".claude.json");

// Safety: Don't archive sessions modified in last N minutes (likely active)
const ACTIVE_SESSION_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

// Archive locations (local first for instant access, then optionally sync to cloud)
// Research: iCloud can evict files, causing download latency when re-indexing
const LOCAL_ARCHIVE_DIR = join(homedir(), ".claude-archive");
const ICLOUD_ARCHIVE_DIR = join(
  homedir(),
  "Library",
  "Mobile Documents",
  "com~apple~CloudDocs",
  "Archives",
  "claude-sessions",
);
const PROJECT_ID_FILE = ".claude-project-id";

// macOS Trash for safe deletion (recoverable)
const TRASH_DIR = join(homedir(), ".Trash");

// Extra directories to clean (not session-based, just old junk)
// Research: CC-Cleaner and claude-code issue #11646 confirm these are safe to clean
const CLEANUP_DIRS = [
  {
    path: join(CLAUDE_DIR, "ccusage-backup-large-files"),
    description: "Large backup files",
    useTrash: true,
  },
  {
    path: join(CLAUDE_DIR, "debug"),
    description: "Debug logs",
    useTrash: true,
  },
];

interface SessionInfo {
  path: string;
  uuid: string;
  mtime: Date;
  size: number;
  hasSubdir: boolean;
  subdirPath?: string;
}

interface ProjectInfo {
  encodedPath: string;
  decodedPath: string;
  projectId: string;
  sessions: SessionInfo[];
}

interface ArchiveManifest {
  archivedAt: string;
  projectId: string;
  originalPath: string;
  sessions: {
    uuid: string;
    originalMtime: string;
    size: number;
    hasSubdir: boolean;
    firstMessageTimestamp?: string;
    gitBranch?: string;
  }[];
  metadata: {
    archiver_version: string;
    sessions_kept: number;
    total_archived: number;
    total_size_bytes: number;
  };
}

/**
 * Check if a path is an existing directory on the filesystem.
 */
function isDirectoryOnDisk(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export type PathValidator = (path: string) => boolean;

/**
 * Decode Claude's path encoding back to original path.
 *
 * Claude encodes project paths by replacing "/" with "-", but this is lossy —
 * directory names containing dashes (e.g., "sample-mini") become indistinguishable
 * from path separators. We resolve ambiguity by validating against the filesystem:
 * walk segments left-to-right, and when a segment doesn't exist as a directory,
 * try joining it with the next segment using "-" instead of "/".
 *
 * Known limitation: greedy single-segment matching wins when both a short path
 * AND a dashed extension exist (e.g., both /Gits/sample and /Gits/sample-mini).
 * This is inherent to the lossy encoding and extremely rare in practice.
 *
 * When no filesystem paths match (deleted/orphaned projects), falls back to
 * naive decode (all dashes become slashes).
 *
 * @param encoded - The encoded path (e.g., "-Users-example-Gits-sample-mini")
 * @param isDirectory - Optional path validator for testing (defaults to filesystem check)
 */
export function decodeProjectPath(
  encoded: string,
  isDirectory: PathValidator = isDirectoryOnDisk,
): string {
  if (encoded === "-") return "/";

  const segments = encoded.slice(1).split("-");
  let path = "/";
  let i = 0;

  while (i < segments.length) {
    // Last remaining segment — append as leaf (project directory name)
    if (i === segments.length - 1) {
      path += (path === "/" ? "" : "/") + segments[i];
      break;
    }

    const singlePath = path + (path === "/" ? "" : "/") + segments[i];

    // Single segment exists as a directory — use it
    if (isDirectory(singlePath)) {
      path = singlePath;
      i++;
      continue;
    }

    // Single segment doesn't exist — try joining with subsequent segments
    // using dashes to find a dashed directory name (e.g., "sample-mini")
    let extended = false;
    for (let j = i + 1; j < segments.length; j++) {
      const candidate = segments.slice(i, j + 1).join("-");
      const testPath = path + (path === "/" ? "" : "/") + candidate;

      if (isDirectory(testPath)) {
        path = testPath;
        i = j + 1;
        extended = true;
        break;
      }
    }

    if (!extended) {
      // No dashed directory found — treat dash as path separator (naive decode)
      path = singlePath;
      i++;
    }
  }

  return path;
}

/**
 * Read .claude-project-id from a repo directory
 * Falls back to directory name if file doesn't exist
 */
function getProjectId(repoPath: string): string {
  const idFilePath = join(repoPath, PROJECT_ID_FILE);

  if (existsSync(idFilePath)) {
    const id = readFileSync(idFilePath, "utf-8").trim();
    if (id) return id;
  }

  // Fallback: use directory name
  return basename(repoPath);
}

/**
 * Extract metadata from first line of JSONL session file
 */
function extractSessionMetadata(sessionPath: string): {
  timestamp?: string;
  gitBranch?: string;
} {
  try {
    const content = readFileSync(sessionPath, "utf-8");
    const firstLine = content.split("\n")[0];
    if (!firstLine) return {};

    const entry = JSON.parse(firstLine);
    return {
      timestamp: entry.timestamp,
      gitBranch: entry.gitBranch,
    };
  } catch {
    return {};
  }
}

/**
 * Discover all projects and their sessions
 */
function discoverProjects(): ProjectInfo[] {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) {
    console.error(
      `Claude projects directory not found: ${CLAUDE_PROJECTS_DIR}`,
    );
    return [];
  }

  const projects: ProjectInfo[] = [];
  const entries = readdirSync(CLAUDE_PROJECTS_DIR);

  for (const entry of entries) {
    const projectDir = join(CLAUDE_PROJECTS_DIR, entry);

    // Skip if not a directory
    const stat = lstatSync(projectDir);
    if (!stat.isDirectory()) continue;

    // Resolve symlinks to avoid double-processing
    const realPath = stat.isSymbolicLink()
      ? realpathSync(projectDir)
      : projectDir;

    // Skip if we've already processed this real path
    if (
      projects.some(
        (p) => join(CLAUDE_PROJECTS_DIR, p.encodedPath) === realPath,
      )
    ) {
      console.log(`Skipping symlink: ${entry} → ${realPath}`);
      continue;
    }

    const decodedPath = decodeProjectPath(entry);
    const projectId = existsSync(decodedPath)
      ? getProjectId(decodedPath)
      : basename(decodedPath);

    // Find all .jsonl session files
    const files = readdirSync(projectDir);
    const sessions: SessionInfo[] = [];

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      const sessionPath = join(projectDir, file);
      const uuid = file.replace(".jsonl", "");
      const fileStat = statSync(sessionPath);

      // Check for optional session subdirectory (subagents, tool-results)
      const subdirPath = join(projectDir, uuid);
      const hasSubdir =
        existsSync(subdirPath) && statSync(subdirPath).isDirectory();

      sessions.push({
        path: sessionPath,
        uuid,
        mtime: fileStat.mtime,
        size: fileStat.size,
        hasSubdir,
        subdirPath: hasSubdir ? subdirPath : undefined,
      });
    }

    // Sort by mtime descending (newest first)
    sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    projects.push({
      encodedPath: entry,
      decodedPath,
      projectId,
      sessions,
    });
  }

  return projects;
}

/**
 * Calculate size of directory recursively
 */
function getDirSize(dirPath: string): number {
  let size = 0;
  const files = readdirSync(dirPath);

  for (const file of files) {
    const filePath = join(dirPath, file);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      size += getDirSize(filePath);
    } else {
      size += stat.size;
    }
  }

  return size;
}

/**
 * Archive sessions to local storage (then optionally iCloud)
 *
 * Idempotency: Each session is archived exactly once.
 * - Sessions are moved (not copied) to archive
 * - If archive already contains a session UUID, skip it
 * - Manifest tracks what was archived and when
 *
 * Error handling:
 * - Each session is archived individually
 * - Errors on one session don't stop others
 * - Failed sessions are logged but not marked as archived
 */
function archiveSessions(
  project: ProjectInfo,
  sessionsToArchive: SessionInfo[],
  dryRun: boolean,
): { archived: number; failed: number; size: number } {
  if (sessionsToArchive.length === 0) {
    return { archived: 0, failed: 0, size: 0 };
  }

  // Use local archive first (instant access, no iCloud eviction)
  const archiveDir = join(LOCAL_ARCHIVE_DIR, project.projectId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const batchDir = join(archiveDir, `archive-${timestamp}`);

  console.log(
    `\n  Archiving ${sessionsToArchive.length} sessions to ${batchDir}`,
  );

  if (!dryRun) {
    mkdirSync(batchDir, { recursive: true });
  }

  const manifestSessions: ArchiveManifest["sessions"] = [];
  let totalSize = 0;
  let archived = 0;
  let failed = 0;

  const now = Date.now();

  for (const session of sessionsToArchive) {
    try {
      // Safety check: skip if modified recently (likely active session)
      const ageMs = now - session.mtime.getTime();
      if (ageMs < ACTIVE_SESSION_THRESHOLD_MS) {
        console.log(
          `    Skipping (recently active, ${Math.round(ageMs / 60000)}m ago): ${session.uuid}`,
        );
        continue;
      }

      // Idempotency check: skip if already archived
      const destFile = join(batchDir, `${session.uuid}.jsonl`);
      if (!dryRun && existsSync(destFile)) {
        console.log(`    Skipping (already archived): ${session.uuid}`);
        continue;
      }

      const metadata = extractSessionMetadata(session.path);

      manifestSessions.push({
        uuid: session.uuid,
        originalMtime: session.mtime.toISOString(),
        size: session.size,
        hasSubdir: session.hasSubdir,
        firstMessageTimestamp: metadata.timestamp,
        gitBranch: metadata.gitBranch,
      });

      let sessionSize = session.size;
      if (session.hasSubdir && session.subdirPath) {
        sessionSize += getDirSize(session.subdirPath);
      }
      totalSize += sessionSize;

      if (!dryRun) {
        // Move session file (atomic on same filesystem)
        renameSync(session.path, destFile);

        // Move optional subdir if exists
        if (session.hasSubdir && session.subdirPath) {
          const destSubdir = join(batchDir, session.uuid);
          renameSync(session.subdirPath, destSubdir);
        }
        archived++;
      }

      console.log(
        `    ${dryRun ? "[DRY RUN] Would archive" : "Archived"}: ${session.uuid} (${(sessionSize / 1024 / 1024).toFixed(2)} MB)`,
      );
    } catch (err) {
      failed++;
      console.error(`    ERROR archiving ${session.uuid}: ${err}`);
      // Continue with next session - don't lose progress
    }
  }

  // Write manifest (even on partial success)
  if (!dryRun && manifestSessions.length > 0) {
    const manifest: ArchiveManifest = {
      archivedAt: new Date().toISOString(),
      projectId: project.projectId,
      originalPath: project.decodedPath,
      sessions: manifestSessions,
      metadata: {
        archiver_version: "1.1.0",
        sessions_kept: ACTIVITY_DAYS_TO_KEEP,
        total_archived: manifestSessions.length,
        total_size_bytes: totalSize,
      },
    };

    try {
      writeFileSync(
        join(batchDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      );
    } catch (err) {
      console.error(`    ERROR writing manifest: ${err}`);
    }
  }

  console.log(
    `    ${dryRun ? "[DRY RUN] Would write" : "Wrote"} manifest.json (${(totalSize / 1024 / 1024).toFixed(2)} MB total)`,
  );

  if (failed > 0) {
    console.log(`    WARNING: ${failed} sessions failed to archive`);
  }

  return { archived, failed, size: totalSize };
}

/**
 * Move file/directory to macOS Trash (recoverable)
 */
function moveToTrash(sourcePath: string): void {
  const fileName = basename(sourcePath);
  const timestamp = Date.now();
  const trashPath = join(TRASH_DIR, `${fileName}.${timestamp}`);
  renameSync(sourcePath, trashPath);
}

/**
 * Get active project paths from .claude.json
 * Research: CC-Cleaner uses this to distinguish active vs orphaned
 */
function getActiveProjectPaths(): Set<string> {
  const activePaths = new Set<string>();

  if (!existsSync(CLAUDE_JSON_PATH)) {
    return activePaths;
  }

  try {
    const config = JSON.parse(readFileSync(CLAUDE_JSON_PATH, "utf-8"));
    // .claude.json may have project paths in various formats
    if (config.projects && typeof config.projects === "object") {
      for (const key of Object.keys(config.projects)) {
        activePaths.add(key);
      }
    }
  } catch {
    console.warn("Warning: Could not parse .claude.json");
  }

  return activePaths;
}

/**
 * Clean up extra directories (backups, debug logs)
 * Uses macOS Trash for safe, recoverable deletion
 */
function cleanupExtraDirectories(dryRun: boolean): number {
  let totalCleaned = 0;

  console.log("\n" + "=".repeat(60));
  console.log("Cleaning Extra Directories (to Trash)");
  console.log("=".repeat(60));

  for (const dir of CLEANUP_DIRS) {
    if (!existsSync(dir.path)) {
      console.log(`\n${dir.description}: Not found (skipping)`);
      continue;
    }

    const size = getDirSize(dir.path);
    const files = readdirSync(dir.path).filter((f) => !f.startsWith("."));

    console.log(`\n${dir.description}: ${dir.path}`);
    console.log(`  Files: ${files.length}`);
    console.log(`  Size: ${(size / 1024 / 1024).toFixed(2)} MB`);

    if (files.length === 0) {
      console.log(`  Nothing to clean`);
      continue;
    }

    totalCleaned += size;

    if (!dryRun) {
      // Move to Trash (recoverable) instead of permanent delete
      for (const file of files) {
        const filePath = join(dir.path, file);
        try {
          moveToTrash(filePath);
        } catch (err) {
          console.error(`  Error moving ${file} to trash: ${err}`);
        }
      }
      console.log(`  Moved ${files.length} items to Trash`);
    } else {
      console.log(
        `  [DRY RUN] Would move ${files.length} items to Trash (${(size / 1024 / 1024).toFixed(2)} MB)`,
      );
    }
  }

  return totalCleaned;
}

// BrainLayer DB path (sqlite-vec with indexed sessions)
const BRAINLAYER_DB_PATH = (() => {
  const blPath = join(
    homedir(),
    ".local",
    "share",
    "brainlayer",
    "brainlayer.db",
  );
  if (existsSync(blPath)) return blPath;
  // Legacy fallback
  const legacyPath = join(
    homedir(),
    ".local",
    "share",
    "zikaron",
    "zikaron.db",
  );
  if (existsSync(legacyPath)) return legacyPath;
  return blPath; // Default to new path
})();

/**
 * Check if a session UUID has been indexed by BrainLayer
 * Uses sqlite3 CLI with spawnSync to avoid shell injection
 */
function isSessionIndexedInBrainLayer(
  sessionUuid: string,
  projectEncodedPath: string,
): boolean {
  if (!existsSync(BRAINLAYER_DB_PATH)) return false;

  try {
    const sourcePath = join(
      CLAUDE_PROJECTS_DIR,
      projectEncodedPath,
      `${sessionUuid}.jsonl`,
    );
    // Escape single quotes for SQL safety (spawnSync already prevents shell injection)
    const escapedPath = sourcePath.replace(/'/g, "''");
    const result = spawnSync(
      "sqlite3",
      [
        BRAINLAYER_DB_PATH,
        `SELECT COUNT(*) FROM chunks WHERE source_file = '${escapedPath}'`,
      ],
      { encoding: "utf-8", timeout: 5000 },
    );
    if (result.status !== 0) return false;
    return parseInt((result.stdout || "").trim(), 10) > 0;
  } catch {
    return false;
  }
}

/**
 * Clean up archived sessions that BrainLayer has already indexed.
 * Deletes local archive copies to free disk space.
 */
function cleanupVerifiedArchives(dryRun: boolean): {
  deleted: number;
  sizeFreed: number;
} {
  console.log("\n" + "=".repeat(60));
  console.log("Cleaning Verified Archives (BrainLayer-indexed → delete local)");
  console.log("=".repeat(60));

  if (!existsSync(LOCAL_ARCHIVE_DIR)) {
    console.log("  No archive directory found");
    return { deleted: 0, sizeFreed: 0 };
  }

  if (!existsSync(BRAINLAYER_DB_PATH)) {
    console.log("  BrainLayer DB not found — skipping cleanup");
    return { deleted: 0, sizeFreed: 0 };
  }

  let totalDeleted = 0;
  let totalSizeFreed = 0;

  const projectDirs = readdirSync(LOCAL_ARCHIVE_DIR);

  for (const projectDir of projectDirs) {
    const projectArchivePath = join(LOCAL_ARCHIVE_DIR, projectDir);
    if (!statSync(projectArchivePath).isDirectory()) continue;

    const batches = readdirSync(projectArchivePath);

    for (const batch of batches) {
      const batchPath = join(projectArchivePath, batch);
      if (!statSync(batchPath).isDirectory()) continue;

      const manifestPath = join(batchPath, "manifest.json");
      if (!existsSync(manifestPath)) continue;

      let manifest: ArchiveManifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      } catch {
        continue;
      }

      // Find the encoded project path from the original path
      const encodedPath =
        manifest.originalPath === "/"
          ? "-"
          : "-" + manifest.originalPath.slice(1).replace(/\//g, "-");

      let batchAllIndexed = true;
      let batchSize = 0;

      for (const session of manifest.sessions) {
        const indexed = isSessionIndexedInBrainLayer(session.uuid, encodedPath);
        if (!indexed) {
          batchAllIndexed = false;
          break;
        }
        batchSize += session.size;
      }

      if (batchAllIndexed && manifest.sessions.length > 0) {
        console.log(
          `  ${dryRun ? "[DRY RUN] Would delete" : "Deleting"}: ${batchPath} (${manifest.sessions.length} sessions, ${(batchSize / 1024 / 1024).toFixed(1)} MB)`,
        );

        if (!dryRun) {
          try {
            rmSync(batchPath, { recursive: true });
            totalDeleted += manifest.sessions.length;
            totalSizeFreed += batchSize;
          } catch (err) {
            console.error(`    ERROR deleting ${batchPath}: ${err}`);
          }
        } else {
          totalDeleted += manifest.sessions.length;
          totalSizeFreed += batchSize;
        }
      } else if (!batchAllIndexed) {
        console.log(
          `  Keeping: ${batchPath} (not all sessions indexed by BrainLayer)`,
        );
      }
    }

    // Clean up empty project directories
    if (!dryRun && existsSync(projectArchivePath)) {
      const remaining = readdirSync(projectArchivePath);
      if (remaining.length === 0) {
        rmSync(projectArchivePath, { recursive: true });
        console.log(`  Removed empty project dir: ${projectDir}`);
      }
    }
  }

  console.log(
    `  ${dryRun ? "Would delete" : "Deleted"}: ${totalDeleted} verified sessions (${(totalSizeFreed / 1024 / 1024).toFixed(1)} MB)`,
  );

  return { deleted: totalDeleted, sizeFreed: totalSizeFreed };
}

/**
 * Main archival process
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--execute");
  const daysArg = args.find((a) => a.startsWith("--days="));
  const sessionsToKeep = daysArg
    ? parseInt(daysArg.split("=")[1])
    : ACTIVITY_DAYS_TO_KEEP;

  console.log("=".repeat(60));
  console.log("Claude Session Archiver");
  console.log("=".repeat(60));
  console.log(
    `Mode: ${dryRun ? "DRY RUN (use --execute to apply)" : "EXECUTING"}`,
  );
  console.log(
    `Activity days to keep: ${sessionsToKeep} (keeps ALL sessions from those days)`,
  );
  console.log(`Archive location: ${LOCAL_ARCHIVE_DIR}`);
  console.log();

  const projects = discoverProjects();

  let totalSessions = 0;
  let totalToArchive = 0;
  let totalSizeToArchive = 0;
  let totalArchived = 0;
  let totalFailed = 0;

  for (const project of projects) {
    // Check if project source directory still exists (orphan detection)
    const isOrphan = !existsSync(project.decodedPath);

    let toArchive: SessionInfo[];
    let keptCount: number;
    let sortedDays: string[] = [];
    let cutoffDay: string | null = null;

    if (isOrphan) {
      // ORPHAN PROJECT: Archive ALL sessions (project no longer exists)
      toArchive = project.sessions;
      keptCount = 0;
      console.log(`\nProject: ${project.projectId} [ORPHANED - archiving all]`);
      console.log(`  Path: ${project.decodedPath} (no longer exists)`);
      console.log(`  Archiving ALL ${toArchive.length} sessions`);
    } else {
      // ACTIVE PROJECT: Keep last N days of activity
      // Find unique activity days (not sessions, DAYS of work)
      const activityDays = new Set<string>();
      for (const session of project.sessions) {
        const dayKey = session.mtime.toISOString().slice(0, 10); // YYYY-MM-DD
        activityDays.add(dayKey);
      }

      // Sort days descending (newest first) and find cutoff
      sortedDays = Array.from(activityDays).sort().reverse();
      cutoffDay =
        sortedDays[Math.min(sessionsToKeep - 1, sortedDays.length - 1)];

      // Keep sessions from the last N days of activity, archive the rest
      toArchive = project.sessions.filter((s) => {
        const sessionDay = s.mtime.toISOString().slice(0, 10);
        return sessionDay < cutoffDay;
      });

      keptCount = project.sessions.length - toArchive.length;

      console.log(`\nProject: ${project.projectId}`);
      console.log(`  Path: ${project.decodedPath}`);
      console.log(
        `  Activity: ${sortedDays.length} days, keeping ${Math.min(sortedDays.length, sessionsToKeep)} days (${keptCount} sessions), archiving ${toArchive.length} sessions`,
      );
      if (toArchive.length > 0 && cutoffDay) {
        console.log(
          `  Cutoff: ${cutoffDay} (archiving sessions before this date)`,
        );
      }
    }

    totalSessions += project.sessions.length;
    totalToArchive += toArchive.length;

    for (const s of toArchive) {
      totalSizeToArchive += s.size;
      if (s.hasSubdir && s.subdirPath) {
        totalSizeToArchive += getDirSize(s.subdirPath);
      }
    }

    if (toArchive.length > 0) {
      const result = archiveSessions(project, toArchive, dryRun);
      totalArchived += result.archived;
      totalFailed += result.failed;
    }
  }

  // Clean up archived sessions verified in BrainLayer
  const { deleted: verifiedDeleted, sizeFreed: verifiedSizeFreed } =
    cleanupVerifiedArchives(dryRun);

  // Clean up extra directories (debug logs, backups)
  const extraCleaned = cleanupExtraDirectories(dryRun);

  const totalSpaceFreed = totalSizeToArchive + extraCleaned + verifiedSizeFreed;

  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log(`Projects found: ${projects.length}`);
  console.log(`Total sessions: ${totalSessions}`);
  console.log(`Sessions to archive: ${totalToArchive}`);
  if (!dryRun) {
    console.log(`Sessions archived: ${totalArchived}`);
    if (totalFailed > 0) {
      console.log(`Sessions failed: ${totalFailed} (check logs above)`);
    }
  }
  console.log(
    `Session archive size: ${(totalSizeToArchive / 1024 / 1024 / 1024).toFixed(2)} GB`,
  );
  console.log(
    `Verified archives cleaned: ${verifiedDeleted} sessions (${(verifiedSizeFreed / 1024 / 1024).toFixed(0)} MB)`,
  );
  console.log(
    `Extra cleanup size: ${(extraCleaned / 1024 / 1024).toFixed(0)} MB`,
  );
  console.log(
    `Total space freed: ${(totalSpaceFreed / 1024 / 1024 / 1024).toFixed(2)} GB`,
  );
  console.log(`Archive location: ${LOCAL_ARCHIVE_DIR}`);

  if (dryRun && (totalToArchive > 0 || extraCleaned > 0)) {
    console.log("\nRun with --execute to apply these changes.");
  }

  // Write run log for debugging/auditing
  if (!dryRun) {
    const logDir = join(homedir(), ".golems-zikaron", "logs");
    mkdirSync(logDir, { recursive: true });
    const runLog = {
      timestamp: new Date().toISOString(),
      sessionsToArchive: totalToArchive,
      sessionsArchived: totalArchived,
      sessionsFailed: totalFailed,
      sizeArchived: totalSizeToArchive,
      verifiedArchivesCleaned: verifiedDeleted,
      verifiedArchivesSizeFreed: verifiedSizeFreed,
      extraCleaned,
      totalSpaceFreed,
    };
    const logFile = join(logDir, "session-archiver-runs.jsonl");
    writeFileSync(logFile, JSON.stringify(runLog) + "\n", { flag: "a" });
    console.log(`Run logged to: ${logFile}`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
