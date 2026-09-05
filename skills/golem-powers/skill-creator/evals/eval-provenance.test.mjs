import { describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateEvalRecord } from "./eval-provenance-check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(here, "fixtures", "eval-provenance", name);
const checker = path.join(here, "eval-provenance-check.mjs");
const outputText = (bytes) => new TextDecoder().decode(bytes);

describe("eval result provenance validity gate", () => {
  test("rejects a result that omits effective runtime provenance", () => {
    const resultPath =
      process.env.EVAL_PROVENANCE_RED_ARTIFACT ?? fixture("missing-provenance.md");

    const result = validateEvalRecord(resultPath);

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("NO_PROVENANCE");
  });

  test("accepts a result with observed provenance for every arm", () => {
    const result = validateEvalRecord(fixture("compliant.md"));

    expect(result.valid).toBe(true);
    expect(result.comparable).toBe(true);
    expect(result.arms).toHaveLength(2);
    expect(result.errors).toEqual([]);
  });

  test("accepts explicit NOT DETERMINED values when runtime observation was impossible", () => {
    const result = validateEvalRecord(fixture("not-determined-no-claims.json"));

    expect(result.valid).toBe(true);
    expect(result.comparable).toBe(false);
    expect(result.status).toBe("NON_COMPARABLE");
    expect(result.arms).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  test("rejects score and delta claims on NON_COMPARABLE provenance", () => {
    const result = validateEvalRecord(fixture("not-determined.json"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      "NON_COMPARABLE_WITH_SCORE_CLAIM",
    );
  });

  test("rejects a Markdown delta claim on NON_COMPARABLE provenance", () => {
    const result = validateEvalRecord(fixture("not-determined-with-delta.md"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      "NON_COMPARABLE_WITH_SCORE_CLAIM",
    );
  });

  test("does not treat an explicitly uncalculated Markdown score as a claim", () => {
    const result = validateEvalRecord(fixture("not-determined-score-not-calculated.md"));

    expect(result.valid).toBe(true);
    expect(result.status).toBe("NON_COMPARABLE");
  });

  test("does not treat null or uncalculated JSON score fields as claims", () => {
    const result = validateEvalRecord(fixture("not-determined-score-not-calculated.json"));

    expect(result.valid).toBe(true);
    expect(result.status).toBe("NON_COMPARABLE");
  });

  test("rejects an explicit comparability claim that contradicts provenance", () => {
    const result = validateEvalRecord(fixture("not-determined-comparable-true.json"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      "NON_COMPARABLE_WITH_COMPARABILITY_CLAIM",
    );
  });

  test("identifies a score claim when provenance is absent", () => {
    const result = validateEvalRecord(fixture("missing-provenance-with-delta.json"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      "SCORE_CLAIM_WITHOUT_PROVENANCE",
    );
  });

  test("strict comparability mode exits 3 for honest NON_COMPARABLE history", () => {
    const process = Bun.spawnSync(
      ["node", checker, "--require-comparable", fixture("not-determined-no-claims.json")],
      { stdout: "pipe", stderr: "pipe" },
    );

    expect(process.exitCode).toBe(3);
    expect(outputText(process.stderr)).toContain("COMPARABILITY_REQUIRED");
  });

  test("strict comparability mode accepts an observed score claim", () => {
    const process = Bun.spawnSync(
      ["node", checker, "--require-comparable", fixture("comparable-with-scores.json")],
      { stdout: "pipe", stderr: "pipe" },
    );

    expect(process.exitCode).toBe(0);
    expect(outputText(process.stdout)).toContain("VALID ");
  });

  test("rejects an effective value without its observation source", () => {
    const result = validateEvalRecord(fixture("missing-observation-source.json"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      "MISSING_MODEL_OBSERVATION_SOURCE",
    );
  });

  test("rejects a source that is not one of the ruled runtime observations", () => {
    const result = validateEvalRecord(fixture("unsupported-observation-source.json"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      "UNSUPPORTED_MODEL_OBSERVATION_SOURCE",
    );
  });

  test("rejects a floating alias recorded as the effective model", () => {
    const result = validateEvalRecord(fixture("alias-as-effective.json"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("MODEL_EFFECTIVE_IS_ALIAS");
  });

  test("rejects an unresolved default recorded as effective effort", () => {
    const result = validateEvalRecord(fixture("default-as-effective-effort.json"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      "EFFORT_EFFECTIVE_IS_UNRESOLVED",
    );
  });

  test("does not accept a provenance example inside a fenced code block", () => {
    const result = validateEvalRecord(fixture("provenance-only-in-code-fence.md"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("NO_PROVENANCE");
  });

  test("rejects unreplaced provenance template placeholders", () => {
    const result = validateEvalRecord(fixture("unreplaced-placeholders.json"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("PLACEHOLDER_VALUE");
  });

  test("accepts a pre-contract alias-only marker as non-comparable", () => {
    const result = validateEvalRecord(fixture("historical-alias-only.json"));

    expect(result.valid).toBe(true);
    expect(result.comparable).toBe(false);
    expect(result.status).toBe("ALIAS_ONLY");
  });

  test("rejects score and comparability claims on historical alias-only provenance", () => {
    const result = validateEvalRecord(fixture("historical-alias-only-with-claims.json"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      "ALIAS_ONLY_WITH_SCORE_CLAIM",
    );
    expect(result.errors.map((error) => error.code)).toContain(
      "ALIAS_ONLY_WITH_COMPARABILITY_CLAIM",
    );
  });

  test("rejects alias-only on a result created after the contract cutoff", () => {
    const result = validateEvalRecord(fixture("new-alias-only.json"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      "ALIAS_ONLY_NOT_HISTORICAL",
    );
  });

  test("rejects a friendly model label that is not a concrete runtime ID", () => {
    const result = validateEvalRecord(fixture("friendly-label-as-effective.json"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      "MODEL_EFFECTIVE_NOT_CONCRETE_ID",
    );
  });

  test("accepts observation-source details in parentheses", () => {
    const result = validateEvalRecord(fixture("parenthetical-observation-source.json"));

    expect(result.valid).toBe(true);
    expect(result.comparable).toBe(true);
  });

  test("uses a historical Markdown filename date for alias-only", () => {
    const result = validateEvalRecord(fixture("historical-alias-only-2026-04-05.md"));

    expect(result.valid).toBe(true);
    expect(result.status).toBe("ALIAS_ONLY");
  });

  test("accepts a concrete no-digit runtime ID", () => {
    const result = validateEvalRecord(fixture("concrete-no-digit-model.json"));

    expect(result.valid).toBe(true);
    expect(result.comparable).toBe(true);
  });

  test("a valid provenance table wins over an alias-only prose mention", () => {
    const result = validateEvalRecord(fixture("alias-mention-with-provenance-2026-08-04.md"));

    expect(result.valid).toBe(true);
    expect(result.comparable).toBe(true);
  });

  test("rejects provenance fields that the schema does not declare", () => {
    const result = validateEvalRecord(fixture("unexpected-provenance-field.json"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      "UNEXPECTED_PROVENANCE_FIELD",
    );
  });

  test("rejects non-string provenance field values", () => {
    const result = validateEvalRecord(fixture("non-string-provenance-field.json"));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("INVALID_FIELD_TYPE");
  });

  test("accepts extra human-facing columns in Markdown provenance tables", () => {
    const result = validateEvalRecord(fixture("markdown-extra-column.md"));

    expect(result.valid).toBe(true);
    expect(result.comparable).toBe(true);
  });

  test("accepts a parenthetical NOT DETERMINED reason", () => {
    const result = validateEvalRecord(fixture("not-determined-parenthetical.json"));

    expect(result.valid).toBe(true);
    expect(result.comparable).toBe(false);
  });
});
