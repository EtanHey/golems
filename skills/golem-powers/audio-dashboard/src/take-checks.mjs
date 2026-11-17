import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function takeCheckArgs(reference, { pitchCeilingHz } = {}) {
  const ceiling = pitchCeilingHz ?? ({ 'theo-c4s': 340, 'ben-c1': 260 })[reference];
  if (!Number.isFinite(ceiling) || ceiling <= 0) throw new Error(`No take-check pitch ceiling for ${reference}; set scene.pitchCeilingHz`);
  const model = path.join(os.homedir(), '.cache/whisper/ggml-large-v3-turbo.bin');
  if (!existsSync(model)) throw new Error(`Take checks require Whisper model: ${model}`);
  return ['--take-checks', '--take-retries', '2', '--word-check-setting', 'a', '--pitch-ceiling', String(ceiling)];
}

export function readTakeChecks(wav, { required = false } = {}) {
  const receipt = `${wav}.cache.json`;
  const checks = existsSync(receipt) ? JSON.parse(readFileSync(receipt, 'utf8')).takeChecks : undefined;
  if (required && (!checks || !checks.wordMatch || typeof checks.wordMatch.pass !== 'boolean')) {
    throw new Error(`Missing take-check evidence: ${receipt}`);
  }
  return checks;
}

export function rejectedTakeChecks(checks) {
  return Boolean(checks && (checks.gaveUp || checks.wordMatch?.keptBest || checks.wordMatch?.pass === false));
}
