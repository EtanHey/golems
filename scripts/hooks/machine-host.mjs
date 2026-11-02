import { spawnSync } from 'node:child_process';

// LocalHostNames configured by orchestrator/repogolem/config.yaml; no env override.
export function machineHost() {
  const r = spawnSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' });
  return r.status === 0 ? ({ 'MacBook-Pro': 'mbp', 'Locals-MacBook-Pro': 'm1' }[r.stdout.trim()] ?? null) : null;
}
