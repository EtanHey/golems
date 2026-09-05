#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const schemaPath = fileURLToPath(new URL("./eval-result-provenance.schema.json", import.meta.url));
const provenanceSchema = JSON.parse(readFileSync(schemaPath, "utf8"));

export const PROVENANCE_FIELDS = provenanceSchema.$defs.armProvenance.required;

const PROVENANCE_CONTRACT_DATE = "2026-08-03";

const INVALID_UNKNOWN_VALUES = new Set([
  "n/a",
  "not available",
  "not observed",
  "undetermined",
  "unknown",
]);

const FLOATING_MODEL_ALIASES = new Set([
  "auto",
  "codex",
  "cursor",
  "default",
  "fable",
  "gemini",
  "haiku",
  "inherit",
  "opus",
  "sonnet",
]);

const UNRESOLVED_EFFORT_VALUES = new Set(["auto", "default", "inherit"]);
const SCORE_CLAIM_KEY_PATTERN = /(^|_)(delta|score|scores|percentage)($|_)/;
const DELTA_CLAIM_KEY_PATTERN = /(^|_)delta($|_)/;
const SCORE_PROSE_KEY_SUFFIX_PATTERN = /_(note|notes|reason)$/;
const COMPARABILITY_STATUS_FIELDS = new Set(["comparability", "provenance_status", "status"]);
const UNCALCULATED_SCORE_PATTERN = /^(NOT CALCULATED|NOT DETERMINED|OMITTED|N\/A|NONE)\b/i;
const NOT_DETERMINED_PATTERN = new RegExp(
  provenanceSchema.$defs.armProvenance.properties.model_effective.anyOf[0].pattern,
);
const CONCRETE_MODEL_ID_PATTERN = new RegExp(
  provenanceSchema.$defs.armProvenance.properties.model_effective.anyOf[1].pattern,
);

function normalizeHeader(value) {
  return value
    .trim()
    .replaceAll("`", "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function markdownCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const TOP_LEVEL_RUNTIME_FIELDS = [
  ["requested_model", "model_requested"],
  ["effective_model", "model_effective"],
  ["effective_effort", "effort_effective"],
];

function emptyClaims() {
  return { scoreClaims: [], deltaClaims: [], comparabilityClaims: [] };
}

function isClaimedScoreValue(value) {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 && !UNCALCULATED_SCORE_PATTERN.test(trimmed);
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function isScoreClaimKey(normalizedKey) {
  return (
    SCORE_CLAIM_KEY_PATTERN.test(normalizedKey) &&
    !SCORE_PROSE_KEY_SUFFIX_PATTERN.test(normalizedKey)
  );
}

function collectJsonClaims(value, location = "record", claims = emptyClaims()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return claims;

  for (const [key, child] of Object.entries(value)) {
    if (key === "provenance") continue;

    const normalizedKey = normalizeHeader(key);
    const childLocation = `${location}.${key}`;
    if (isScoreClaimKey(normalizedKey) && isClaimedScoreValue(child)) {
      claims.scoreClaims.push(childLocation);
      if (DELTA_CLAIM_KEY_PATTERN.test(normalizedKey)) {
        claims.deltaClaims.push(childLocation);
      }
    }
    if (normalizedKey === "comparable" && child === true) {
      claims.comparabilityClaims.push(childLocation);
    }
    if (
      COMPARABILITY_STATUS_FIELDS.has(normalizedKey) &&
      typeof child === "string" &&
      /^(VALID|COMPARABLE)$/i.test(child.trim())
    ) {
      claims.comparabilityClaims.push(childLocation);
    }

    collectJsonClaims(child, childLocation, claims);
  }

  return claims;
}

function collectMarkdownClaims(trimmed, lineNumber, claims) {
  const plain = trimmed.replaceAll("`", "").replaceAll("*", "").trim();
  const assignment = plain
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-+>]\s*/, "")
    .replace(/^\|\s*/, "")
    .match(/^([^:=|]+?)\s*[:=|]\s*(.+?)\s*\|?$/);
  if (!assignment) return;

  const [, label, claimedValue] = assignment;
  const normalizedLabel = normalizeHeader(label);

  if (isScoreClaimKey(normalizedLabel) && isClaimedScoreValue(claimedValue)) {
    claims.scoreClaims.push(`line ${lineNumber}: ${label.trim()}`);
    if (DELTA_CLAIM_KEY_PATTERN.test(normalizedLabel)) {
      claims.deltaClaims.push(`line ${lineNumber}: ${label.trim()}`);
    }
  }
  if (normalizedLabel === "comparable" && /^true\b/i.test(claimedValue.trim())) {
    claims.comparabilityClaims.push(`line ${lineNumber}: comparable`);
  }
  if (
    COMPARABILITY_STATUS_FIELDS.has(normalizedLabel) &&
    /^(VALID|COMPARABLE)\b/i.test(claimedValue.trim())
  ) {
    claims.comparabilityClaims.push(`line ${lineNumber}: ${label.trim()}`);
  }
}

function parseMarkdownProvenance(content) {
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let inProvenanceSection = false;
  let aliasOnly = false;
  let date = "";
  const claims = emptyClaims();

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    collectMarkdownClaims(trimmed, index + 1, claims);

    const dateMatch = trimmed.match(/^date\s*:\s*(\d{4}-\d{2}-\d{2})\s*$/i);
    if (dateMatch) date = dateMatch[1];
    if (/^provenance\s*:\s*alias-only\s*$/i.test(trimmed)) aliasOnly = true;

    if (/^#{1,6}\s+Eval Provenance\s*$/i.test(trimmed)) {
      inProvenanceSection = true;
      continue;
    }
    if (inProvenanceSection && /^#{1,6}\s+/.test(trimmed)) {
      inProvenanceSection = false;
      continue;
    }
    if (!inProvenanceSection) continue;

    if (!lines[index].trim().startsWith("|")) continue;

    const headers = markdownCells(lines[index]).map(normalizeHeader);
    if (!PROVENANCE_FIELDS.every((field) => headers.includes(field))) continue;

    const separator = lines[index + 1] ?? "";
    if (!/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(separator)) continue;

    const arms = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = lines[rowIndex];
      if (!row.trim().startsWith("|")) break;

      const cells = markdownCells(row);
      if (cells.every((cell) => cell === "")) continue;

      arms.push(
        Object.fromEntries(
          PROVENANCE_FIELDS.map((field) => [field, cells[headers.indexOf(field)] ?? ""]),
        ),
      );
    }

    return { arms, aliasOnly, date, record: null, ...claims };
  }

  return { arms: [], aliasOnly, date, record: null, ...claims };
}

function parseJsonProvenance(content) {
  const record = JSON.parse(content);
  const claims = collectJsonClaims(record);
  return {
    arms: Array.isArray(record.provenance) ? record.provenance : [],
    aliasOnly: record.provenance === "alias-only",
    date: String(record.date ?? ""),
    record,
    ...claims,
  };
}

function missingFieldCode(field) {
  return `MISSING_${field.toUpperCase()}`;
}

function isNotDetermined(value) {
  return NOT_DETERMINED_PATTERN.test(value.trim());
}

function isAllowedObservationSource(value, dimension) {
  const property = `${dimension}_observation_source`;
  return new RegExp(provenanceSchema.$defs.armProvenance.properties[property].pattern).test(
    value.trim(),
  );
}

function validateArm(arm, index) {
  const errors = [];
  if (!arm || typeof arm !== "object" || Array.isArray(arm)) {
    return [
      {
        code: "INVALID_ARM_TYPE",
        message: `index ${index}: provenance arm must be an object`,
      },
    ];
  }

  const label = String(arm.agent_or_arm ?? "").trim() || `index ${index}`;

  for (const field of Object.keys(arm)) {
    if (!PROVENANCE_FIELDS.includes(field)) {
      errors.push({
        code: "UNEXPECTED_PROVENANCE_FIELD",
        message: `${label}: ${field} is not declared by the provenance schema`,
      });
    }
  }

  for (const field of PROVENANCE_FIELDS) {
    const rawValue = arm[field];
    if (rawValue !== undefined && rawValue !== null && typeof rawValue !== "string") {
      errors.push({
        code: "INVALID_FIELD_TYPE",
        message: `${label}: ${field} must be a string`,
      });
      continue;
    }

    const value = String(rawValue ?? "").trim();
    if (!value) {
      errors.push({
        code: missingFieldCode(field),
        message: `${label}: ${field} is required`,
      });
      continue;
    }

    if (INVALID_UNKNOWN_VALUES.has(value.toLowerCase())) {
      errors.push({
        code: "USE_NOT_DETERMINED",
        message: `${label}: ${field} must say NOT DETERMINED when observation was impossible`,
      });
    }

    if (/^<.*>$/.test(value) || /^REPLACE\b/i.test(value)) {
      errors.push({
        code: "PLACEHOLDER_VALUE",
        message: `${label}: ${field} still contains a template placeholder`,
      });
    }
  }

  const modelEffective = String(arm.model_effective ?? "").trim();
  const modelSource = String(arm.model_observation_source ?? "").trim();
  if (
    modelEffective &&
    !isNotDetermined(modelEffective) &&
    FLOATING_MODEL_ALIASES.has(modelEffective.toLowerCase())
  ) {
    errors.push({
      code: "MODEL_EFFECTIVE_IS_ALIAS",
      message: `${label}: model_effective must be an observed model ID, not ${modelEffective}`,
    });
  } else if (
    modelEffective &&
    !isNotDetermined(modelEffective) &&
    !CONCRETE_MODEL_ID_PATTERN.test(modelEffective)
  ) {
    errors.push({
      code: "MODEL_EFFECTIVE_NOT_CONCRETE_ID",
      message: `${label}: model_effective must use a concrete runtime ID, not ${modelEffective}`,
    });
  }

  if (modelEffective && modelSource && isNotDetermined(modelEffective) !== isNotDetermined(modelSource)) {
    errors.push({
      code: "MISSING_MODEL_OBSERVATION_SOURCE",
      message: `${label}: model_effective and its observation source must agree on NOT DETERMINED`,
    });
  } else if (
    modelEffective &&
    modelSource &&
    !isNotDetermined(modelEffective) &&
    !isAllowedObservationSource(modelSource, "model")
  ) {
    errors.push({
      code: "UNSUPPORTED_MODEL_OBSERVATION_SOURCE",
      message: `${label}: model source must be CLI status line, session JSONL model field, or API response metadata`,
    });
  }

  const effortEffective = String(arm.effort_effective ?? "").trim();
  const effortSource = String(arm.effort_observation_source ?? "").trim();
  if (
    effortEffective &&
    !isNotDetermined(effortEffective) &&
    UNRESOLVED_EFFORT_VALUES.has(effortEffective.toLowerCase())
  ) {
    errors.push({
      code: "EFFORT_EFFECTIVE_IS_UNRESOLVED",
      message: `${label}: effort_effective must be observed, not ${effortEffective}`,
    });
  }

  if (
    effortEffective &&
    effortSource &&
    isNotDetermined(effortEffective) !== isNotDetermined(effortSource)
  ) {
    errors.push({
      code: "MISSING_EFFORT_OBSERVATION_SOURCE",
      message: `${label}: effort_effective and its observation source must agree on NOT DETERMINED`,
    });
  } else if (
    effortEffective &&
    effortSource &&
    !isNotDetermined(effortEffective) &&
    !isAllowedObservationSource(effortSource, "effort")
  ) {
    errors.push({
      code: "UNSUPPORTED_EFFORT_OBSERVATION_SOURCE",
      message: `${label}: effort source must be CLI status line, session JSONL effort field, or API response metadata`,
    });
  }

  return errors;
}

function validateTopLevelRuntime(record, arms) {
  if (!record) return [];

  const presentFields = TOP_LEVEL_RUNTIME_FIELDS.filter(([rootField]) =>
    Object.hasOwn(record, rootField),
  );
  if (presentFields.length === 0) return [];

  const variant = String(record.variant ?? "").trim();
  const selectedArm =
    arms.find((arm) => String(arm.agent_or_arm ?? "").trim() === variant) ??
    (arms.length === 1 ? arms[0] : null);
  if (!selectedArm) {
    return [
      {
        code: "TOP_LEVEL_PROVENANCE_ARM_NOT_FOUND",
        message: `top-level runtime fields cannot be matched to variant ${variant || "NOT DETERMINED"}`,
      },
    ];
  }

  const errors = [];
  for (const [rootField, armField] of TOP_LEVEL_RUNTIME_FIELDS) {
    if (!Object.hasOwn(record, rootField)) {
      errors.push({
        code: "MISSING_TOP_LEVEL_RUNTIME_FIELD",
        message: `${rootField} is required when top-level runtime fields are present`,
      });
      continue;
    }

    const rootValue = String(record[rootField] ?? "").trim();
    const armValue = String(selectedArm[armField] ?? "").trim();
    if (rootValue !== armValue) {
      errors.push({
        code: "TOP_LEVEL_PROVENANCE_MISMATCH",
        message: `${rootField}=${JSON.stringify(rootValue)} does not match ${variant || "selected"}.${armField}=${JSON.stringify(armValue)}`,
      });
    }
  }
  return errors;
}

export function validateEvalRecord(resultPath) {
  let content;
  try {
    content = readFileSync(resultPath, "utf8");
  } catch (error) {
    return {
      valid: false,
      arms: [],
      errors: [{ code: "READ_ERROR", message: error.message }],
    };
  }

  let parsed;
  try {
    parsed = path.extname(resultPath).toLowerCase() === ".json"
      ? parseJsonProvenance(content)
      : parseMarkdownProvenance(content);
  } catch (error) {
    return {
      valid: false,
      arms: [],
      errors: [{ code: "PARSE_ERROR", message: error.message }],
    };
  }

  const {
    arms,
    aliasOnly,
    date,
    record,
    scoreClaims,
    deltaClaims,
    comparabilityClaims,
  } = parsed;
  const filenameDate = path.basename(resultPath).match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
  const recordDate = date || filenameDate;

  if (aliasOnly && arms.length === 0) {
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(recordDate) &&
      recordDate < PROVENANCE_CONTRACT_DATE
    ) {
      const aliasErrors = [];
      if (scoreClaims.length > 0) {
        aliasErrors.push({
          code: "ALIAS_ONLY_WITH_SCORE_CLAIM",
          message: `alias-only provenance cannot carry score/delta claims: ${scoreClaims.join(", ")}`,
        });
      }
      if (comparabilityClaims.length > 0) {
        aliasErrors.push({
          code: "ALIAS_ONLY_WITH_COMPARABILITY_CLAIM",
          message: `alias-only provenance contradicts: ${comparabilityClaims.join(", ")}`,
        });
      }
      if (aliasErrors.length > 0) {
        return {
          valid: false,
          comparable: false,
          status: "INVALID",
          arms,
          errors: aliasErrors,
        };
      }
      return {
        valid: true,
        comparable: false,
        status: "ALIAS_ONLY",
        arms,
        errors: [],
      };
    }

    return {
      valid: false,
      comparable: false,
      status: "INVALID",
      arms,
      errors: [
        {
          code: "ALIAS_ONLY_NOT_HISTORICAL",
          message: `alias-only is restricted to results dated before ${PROVENANCE_CONTRACT_DATE}`,
        },
      ],
    };
  }

  if (arms.length === 0) {
    const errors = [
      {
        code: "NO_PROVENANCE",
        message: "record must contain provenance for every agent or eval arm",
      },
    ];
    if (scoreClaims.length > 0) {
      errors.push({
        code: "SCORE_CLAIM_WITHOUT_PROVENANCE",
        message: `score/delta claim requires comparable provenance: ${scoreClaims.join(", ")}`,
      });
    }
    if (comparabilityClaims.length > 0) {
      errors.push({
        code: "COMPARABILITY_CLAIM_WITHOUT_PROVENANCE",
        message: `comparability claim requires provenance: ${comparabilityClaims.join(", ")}`,
      });
    }
    return {
      valid: false,
      comparable: false,
      status: "INVALID",
      arms,
      errors,
    };
  }

  const errors = [
    ...arms.flatMap(validateArm),
    ...validateTopLevelRuntime(record, arms),
  ];
  if (errors.length > 0) {
    return { valid: false, comparable: false, status: "INVALID", arms, errors };
  }

  const comparable = arms.every(
    (arm) =>
      !isNotDetermined(String(arm.model_effective ?? "")) &&
      !isNotDetermined(String(arm.effort_effective ?? "")),
  );
  if (!comparable && (scoreClaims.length > 0 || comparabilityClaims.length > 0)) {
    const comparisonErrors = [];
    if (scoreClaims.length > 0) {
      comparisonErrors.push({
        code: "NON_COMPARABLE_WITH_SCORE_CLAIM",
        message: `NON_COMPARABLE provenance cannot carry score/delta claims: ${scoreClaims.join(", ")}`,
      });
    }
    if (comparabilityClaims.length > 0) {
      comparisonErrors.push({
        code: "NON_COMPARABLE_WITH_COMPARABILITY_CLAIM",
        message: `NON_COMPARABLE provenance contradicts: ${comparabilityClaims.join(", ")}`,
      });
    }
    return {
      valid: false,
      comparable: false,
      status: "INVALID",
      arms,
      errors: comparisonErrors,
    };
  }
  if (deltaClaims.length > 0 && arms.length < 2) {
    return {
      valid: false,
      comparable: false,
      status: "INVALID",
      arms,
      errors: [
        {
          code: "DELTA_CLAIM_REQUIRES_TWO_ARMS",
          message: `delta claim requires at least two provenance arms: ${deltaClaims.join(", ")}`,
        },
      ],
    };
  }
  return {
    valid: true,
    comparable,
    status: comparable ? "VALID" : "NON_COMPARABLE",
    arms,
    errors: [],
  };
}

function parseCliArgs(args) {
  const resultPaths = [];
  let requireComparable = false;
  for (const arg of args) {
    if (arg === "--require-comparable") {
      requireComparable = true;
    } else if (arg.startsWith("-")) {
      return { error: `Unknown option: ${arg}` };
    } else {
      resultPaths.push(arg);
    }
  }
  return { requireComparable, resultPaths };
}

function runCli(args) {
  const parsedArgs = parseCliArgs(args);
  if (parsedArgs.error) {
    console.error(parsedArgs.error);
    return 2;
  }

  const { requireComparable, resultPaths } = parsedArgs;
  if (resultPaths.length === 0) {
    console.error(
      "Usage: node eval-provenance-check.mjs [--require-comparable] <eval-result.md|json> [...]",
    );
    return 2;
  }

  let invalid = false;
  let comparabilityRequired = false;
  for (const resultPath of resultPaths) {
    const result = validateEvalRecord(resultPath);
    if (result.valid) {
      if (result.comparable) {
        console.log(`VALID ${resultPath} (${result.arms.length} provenance arm(s))`);
      } else if (result.status === "ALIAS_ONLY") {
        console.log(`ALIAS_ONLY ${resultPath} (historical; non-comparable)`);
      } else {
        console.log(`NON_COMPARABLE ${resultPath} (effective runtime provenance not determined)`);
      }
      if (requireComparable && !result.comparable) {
        comparabilityRequired = true;
        console.error(
          `COMPARABILITY_REQUIRED ${resultPath}: retained history cannot be used as score/delta evidence`,
        );
      }
      continue;
    }

    invalid = true;
    console.error(`INVALID ${resultPath}`);
    for (const error of result.errors) {
      console.error(`  ${error.code}: ${error.message}`);
    }
  }
  if (invalid) return 1;
  if (comparabilityRequired) return 3;
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli(process.argv.slice(2));
}
