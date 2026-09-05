import { basename, dirname, join } from "path";

export type PathExists = (path: string) => boolean;

export function defaultWorktreePath(repoPath: string, name: string): string {
  return join(repoPath, ".worktrees", name);
}

/**
 * Resolve a worktree for read/cleanup operations while the fleet migrates.
 * Remove the sibling .wt fallback after the 2026-09-30 migration window.
 */
export function resolveExistingWorktreePath(
  repoPath: string,
  name: string,
  pathExists: PathExists,
): string {
  const inRepoPath = defaultWorktreePath(repoPath, name);
  if (pathExists(inRepoPath)) return inRepoPath;

  const legacyPath = join(dirname(repoPath), `${basename(repoPath)}.wt`, name);
  if (pathExists(legacyPath)) return legacyPath;

  return inRepoPath;
}
