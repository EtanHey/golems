import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runDigestCodex } from "./stalker-digest-runner.mjs";

export function splitDigestBatches(items, maxBatchBytes) {
  if (!Number.isInteger(maxBatchBytes) || maxBatchBytes < 1) throw new Error("maxBatchBytes must be positive");
  const batches = [];
  let batch = [];
  let bytes = 0;
  for (const item of items) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (batch.length > 0 && bytes + itemBytes > maxBatchBytes) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(item);
    bytes += itemBytes;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

export function assertExactBatchCoverage(actual, batch) {
  const expected = batch.map(({ timestamp }) => timestamp);
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`batch coverage mismatch: expected ${expected.join(",")}; received ${Array.isArray(actual) ? actual.join(",") : "non-array"}`);
  }
}

export async function runDigestMaps({
  items,
  maxBatchBytes,
  concurrency,
  workDir,
  mapSchema,
  inputForBatch,
  validateResult,
  runImpl = runDigestCodex,
  model,
  reasoningEffort,
  timeoutMs,
}) {
  const batches = splitDigestBatches(items, maxBatchBytes);
  if (batches.length === 0) throw new Error("cannot map an empty digest source");
  await mkdir(workDir, { recursive: true });
  const entries = await readdir(workDir);
  await Promise.all(entries.filter((name) => /^human-digest-map-[0-9]+(?:-retry)?\.(?:json|stdout\.log|stderr\.log)$/.test(name))
    .map((name) => rm(join(workDir, name), { force: true })));
  const schemaPath = join(workDir, "human-digest-map-schema.json");
  await writeFile(schemaPath, `${JSON.stringify(mapSchema, null, 2)}\n`);
  const results = Array(batches.length);
  let next = 0;
  let firstError;
  async function worker() {
    while (!firstError && next < batches.length) {
      const index = next++;
      const label = `human-digest-map-${String(index + 1).padStart(3, "0")}`;
      const outputPath = join(workDir, `${label}.json`);
      try {
        let feedback = '';
        for (let attempt = 0; attempt < 2; attempt++) {
          if (firstError) throw firstError;
          await rm(outputPath, { force: true });
          await runImpl({
            input: inputForBatch(batches[index], index, batches.length) + feedback,
            outputPath,
            schemaPath,
            cwd: workDir,
            model,
            reasoningEffort,
            timeoutMs,
            diagnosticLabel: attempt === 0 ? label : `${label}-retry`,
          });
          try {
            const raw = await readFile(outputPath, "utf8").catch((error) => {
              throw new Error(`${label} produced no output: ${error.message}`);
            });
            let parsed;
            try {
              parsed = JSON.parse(raw);
            } catch (error) {
              throw new Error(`${label} output is not valid JSON: ${error.message}`);
            }
            results[index] = validateResult(parsed, batches[index], index);
            break;
          } catch (error) {
            if (attempt === 1) throw error;
            feedback = `\nThe previous output failed validation: ${String(error.message).slice(0, 300)}\nReturn a corrected complete JSON object. Copy exact excerpts from their cited segments and account for every timestamp.\n`;
          }
        }
      } catch (error) {
        firstError ??= error;
      }
    }
  }
  const workers = Math.min(Math.max(1, concurrency), batches.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (firstError) throw firstError;
  return results;
}
