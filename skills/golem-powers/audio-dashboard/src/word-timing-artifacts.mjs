import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export function writeWordTimingArtifacts(segmentDir, { rawWords, repairedWords }) {
  const rawWordsPath = path.join(segmentDir, "words.raw.json");
  const wordsPath = path.join(segmentDir, "words.json");
  writeFileSync(rawWordsPath, `${JSON.stringify(rawWords, null, 2)}\n`);
  writeFileSync(wordsPath, `${JSON.stringify(repairedWords, null, 2)}\n`);
  return { rawWordsPath, wordsPath };
}

export function clearTakeCacheReceiptForByo(wavPath) {
  rmSync(`${wavPath}.cache.json`, { force: true });
}
