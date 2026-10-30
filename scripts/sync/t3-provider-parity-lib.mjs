import { createHash } from "node:crypto";

// The T3 provider set every Mac must share byte-for-byte. Default model
// selections are per-Mac user preferences and stay out.
export const PARITY_KEYS = ["providerInstances", "providerModelPreferences"];

export const VERSION_BINARIES = ["~/.local/bin/codex", "~/.local/bin/claude"];

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : isObject(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
      : value;

const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// Paths stop at T3's schema depth (key.instance.config.field); keys below it are
// user data such as environment names, so a deeper difference reports its schema field.
const MAX_PATH_DEPTH = 4;

function diff(a, b, path, depth, out) {
  if (isObject(a) && isObject(b) && depth < MAX_PATH_DEPTH) {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      diff(a[key], b[key], `${path}.${key}`, depth + 1, out);
    }
    return out;
  }
  if (!same(a, b)) out.push({ path, a, b });
  return out;
}

export function compareParity(a, b) {
  const out = [];
  for (const key of PARITY_KEYS) diff(a?.[key], b?.[key], key, 1, out);
  return out;
}

export function validateSettings(settings, host) {
  if (!isObject(settings) || !isObject(settings.providerInstances)) {
    throw new Error(`${host}: settings have no providerInstances object`);
  }
  if ("providerModelPreferences" in settings && !isObject(settings.providerModelPreferences)) {
    throw new Error(`${host}: providerModelPreferences is not an object`);
  }
  return settings;
}

// Provider configs can hold inline secrets, so a report names shapes, never values.
export function redact(value) {
  if (value === undefined) return "<absent>";
  const json = JSON.stringify(canonical(value));
  const kind = isObject(value)
    ? `object(${Object.keys(value).length} keys)`
    : Array.isArray(value)
      ? `array[${value.length}]`
      : value === null
        ? "null"
        : typeof value;
  return `${kind} #${createHash("sha256").update(json).digest("hex").slice(0, 8)}`;
}

const PLAIN_VERSION = /^[\w .()+[\]-]{1,80}$/;
const showVersion = (text) => (PLAIN_VERSION.test(text) && /\d+\.\d+/.test(text) ? text : redact(text));

export function formatReport({ hosts, settingsDrift, versionDrift }) {
  const [left, right] = hosts;
  if (settingsDrift.length === 0 && versionDrift.length === 0) {
    return `T3 provider parity OK: ${left} == ${right}`;
  }
  const lines = [`T3 PROVIDER DRIFT between ${left} and ${right}:`];
  for (const d of settingsDrift) {
    lines.push(`  ${d.path}\n    ${left}: ${redact(d.a)}\n    ${right}: ${redact(d.b)}`);
  }
  for (const d of versionDrift) {
    lines.push(`  ${d.path}\n    ${left}: ${showVersion(d.a)}\n    ${right}: ${showVersion(d.b)}`);
  }
  lines.push("Fix: apply the same change to both Macs' ~/.t3/userdata/settings.json, then rerun.");
  return lines.join("\n");
}
