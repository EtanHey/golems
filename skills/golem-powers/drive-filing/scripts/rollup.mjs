#!/usr/bin/env node
// drive-filing docs.local lifecycle: daily items (YYYY-MM-DD-*) roll up into
// YYYY-MM/ folders once their month is over, and months older than
// --keep-months become the Brain Drive upload plan.
//
//   node rollup.mjs --repo <path> --keep-months N [--dry-run | --apply] [--json] [--now YYYY-MM-DD]
//
// --dry-run (the default) only reports. --apply performs the local month
// moves and writes docs.local/_drive-filing/rollup-plan-<date>.json. This
// script never uploads or deletes anything: the upload itself runs through
// references/archive-procedure.md from that plan, and nothing outside the
// plan is uploaded.
//
// AIDEV-NOTE: credential exclusion is a hard requirement (skillcreatorLead,
// 2026-09-25): a gitignored .codex-home-test/auth.json held live OAuth tokens.
// Credentials are never moved, uploaded or deleted; each is reported as
// "skipped: credential <path>". Round 2 (r6 B1/B2, r4 F1/F2, spec-owner
// ruling): every name rule matches anywhere in the name, and a (folder,
// month) group -- the YYYY-MM/ folder plus that month's dated siblings --
// holding ANY credential is held whole: no moves, no upload unit.
import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

const USAGE =
  "usage: rollup.mjs --repo <path> --keep-months N [--dry-run | --apply] [--json] [--now YYYY-MM-DD]";
const PLAN_DIR = "_drive-filing";
const DAY = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/;
const MONTH = /^(\d{4})-(\d{2})$/;
// v2 dating (cleanliness-standard.md N1): the first full date anywhere in the
// item's own name, else the first YYYY-MM anywhere. Digits must not touch either
// end, so build numbers and hashes never read as dates.
const NAME_DAY = /(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/g;
const NAME_MONTH = /(?<!\d)(20\d{2})-(\d{2})(?![\d])/g;

// Name rules match anywhere in the name, case-insensitively (spec-owner
// ruling: docs.local names are date-prefixed, so ^-anchors never fire).
const CREDENTIAL_DIR = [/codex-?home/i, /claude-?home/i, /^\.(codex|claude)$/i, /-home/i];
const BROWSER_PROFILE_FILE = /^(login data( for account)?|cookies(-journal)?|local state|web data)$/i;
const CREDENTIAL_FILE = [
  /credential/i,
  /auth\.json$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.env/i, // anything containing .env: .env*, prod.env; .environment over-holds (fine)
  /(^|[-_.])env([-_.]|$)/i, // N-C1: env-named config (prod-env.json, app-env.yml, staging_env)
  /secret/i, // client_secret.json, app-secrets.yml, secrets/ (spec addition 2026-09-25)
  BROWSER_PROFILE_FILE,
];
// /token/i stays exactly as broad. A name is released from it only when every
// "token" in it belongs to a proven-safe word (spec owner, 2026-09-25): the
// allow-listed words are removed first, then /token/i runs on what is left, so
// github_token_tokenizer.txt stays held. Other rules and profile holds still win.
const TOKEN = /token/i;
const TOKEN_ALLOW = [/tokeniz/gi, /design[-_]?tokens?/gi, /trust[ _-]?tokens/gi];
function isTokenName(name) {
  return TOKEN.test(TOKEN_ALLOW.reduce((rest, re) => rest.replace(re, ""), name));
}

// B1 (skillcreatorLead SECURITY, 2026-09-25): a planned file whose CONTENT
// carries a high-confidence secret shape holds its whole unit. Only the path
// and the shape name are ever reported; a matched value is never kept, logged
// or printed. Each shape needs a non-word character (or start) before it.
const CONTENT_SHAPES = [
  ["supabase", /(?<![A-Za-z0-9_])sbp_[0-9a-f]{40}/],
  ["google", /(?<![A-Za-z0-9_])AIza[0-9A-Za-z_-]{35}/],
  ["github", /(?<![A-Za-z0-9_])gh[pousr]_[0-9A-Za-z]{36}/],
  ["github-pat", /(?<![A-Za-z0-9_])github_pat_[0-9A-Za-z_]{22,}/],
  ["openai", /(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ["aws", /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}/],
  ["slack", /(?<![A-Za-z0-9])xox[abprs]-[0-9A-Za-z-]{10,}/],
  ["private-key", /-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}/],
];
const SCAN_CHUNK = 1024 * 1024;
const SCAN_OVERLAP = 512; // longer than any shape above, so a split token is still seen

// Shape names found in a text file's content (binary files, with a NUL in
// the first chunk, are skipped). Reads the whole file in overlapping chunks.
export function contentShapes(abs) {
  const found = new Set();
  const fd = openSync(abs, "r");
  try {
    const buf = Buffer.alloc(SCAN_CHUNK);
    let carry = "";
    let position = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, SCAN_CHUNK, position);
      if (n === 0) break;
      if (position === 0 && buf.subarray(0, n).includes(0)) return [];
      const text = carry + buf.toString("latin1", 0, n);
      for (const [shape, re] of CONTENT_SHAPES) if (re.test(text)) found.add(shape);
      carry = text.slice(-SCAN_OVERLAP);
      position += n;
    }
  } finally {
    closeSync(fd);
  }
  return CONTENT_SHAPES.map(([shape]) => shape).filter((shape) => found.has(shape));
}

// PR-8b: tool output that any checkout regenerates. Never archived, never an
// mtime unit, never deleted; reported once with its size. Holds win: a
// regenerable dir that holds a credential is handled like any other dir.
const REGENERABLE_DIR = new Set([
  "__pycache__", "node_modules", ".venv", "venv", ".pytest_cache", ".mypy_cache",
  ".ruff_cache", ".build", ".next", ".turbo", ".probe",
]);

export function isRegenerableDir(name) {
  return REGENERABLE_DIR.has(name);
}

// v2: every credential name rule holds a directory too (a *token* or *-env dir
// is held whole), found when mtime units first let such a dir's files upload.
export function isCredentialDir(name) {
  return CREDENTIAL_DIR.some((re) => re.test(name)) || isCredentialFile(name);
}

// A Chromium/Helium profile root (or its Default/ dir) holds a Local State,
// Cookies, Login Data or Web Data file; the whole directory is a credential.
function isBrowserProfile(abs) {
  return readdirSync(abs).some((child) => BROWSER_PROFILE_FILE.test(child));
}

export function isCredentialFile(name) {
  return CREDENTIAL_FILE.some((re) => re.test(name)) || isTokenName(name);
}

function parseArgs(argv) {
  const args = { mode: "dry-run", json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--keep-months") args.keepMonths = argv[++i];
    else if (arg === "--now") args.now = argv[++i];
    else if (arg === "--dry-run") args.mode = "dry-run";
    else if (arg === "--apply") args.mode = "apply";
    else if (arg === "--json") args.json = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.repo) throw new Error("--repo is required");
  if (args.keepMonths === undefined || !/^\d+$/.test(args.keepMonths)) {
    throw new Error("--keep-months N (a whole number) is required");
  }
  args.keepMonths = Number(args.keepMonths);
  const now = args.now ?? new Date().toISOString().slice(0, 10);
  if (!DAY.test(now)) throw new Error("--now must be YYYY-MM-DD");
  args.now = now.slice(0, 10);
  return args;
}

const monthIndex = (month) => {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + (m - 1);
};

const validMonth = (m) => Number(m) >= 1 && Number(m) <= 12;

function datedMonth(name) {
  for (const [, y, m, d] of name.matchAll(NAME_DAY)) {
    if (validMonth(m) && Number(d) >= 1 && Number(d) <= 31) return `${y}-${m}`;
  }
  for (const [, y, m] of name.matchAll(NAME_MONTH)) {
    if (validMonth(m)) return `${y}-${m}`;
  }
  return null;
}

function monthFolder(name) {
  const match = MONTH.exec(name);
  return match && Number(match[2]) >= 1 && Number(match[2]) <= 12 ? name : null;
}

// Every regular file under abs, never following symlinks.
function allFiles(abs) {
  const stat = lstatSync(abs);
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile()) return [{ abs, bytes: stat.size }];
  if (!stat.isDirectory()) return [];
  return readdirSync(abs)
    .sort()
    .flatMap((child) => allFiles(join(abs, child)));
}

// Split the files under abs into ordinary files and credentials. `reports` is
// what the report lists: one line per credential directory (its whole
// subtree is excluded) plus every credential-named file, including those
// inside such a directory, so e.g. .codex-home-test/auth.json is named.
function collect(abs) {
  const out = { files: [], credentials: [], reports: [], regenerable: [] };
  const stat = lstatSync(abs);
  if (stat.isSymbolicLink()) return out;
  const name = basename(abs);
  if (stat.isFile()) {
    const entry = { abs, bytes: stat.size, mtimeMs: stat.mtimeMs };
    if (isCredentialFile(name)) {
      out.credentials.push(entry);
      out.reports.push({ abs, kind: "file" });
    } else {
      out.files.push(entry);
    }
  } else if (stat.isDirectory() && (isCredentialDir(name) || isBrowserProfile(abs))) {
    const inside = allFiles(abs);
    out.credentials.push(...inside);
    out.reports.push({ abs, kind: "dir", files: inside.length });
    for (const f of inside) {
      if (isCredentialFile(basename(f.abs))) out.reports.push({ abs: f.abs, kind: "file" });
    }
  } else if (stat.isDirectory()) {
    const inner = { files: [], credentials: [], reports: [], regenerable: [] };
    for (const child of readdirSync(abs).sort()) {
      const sub = collect(join(abs, child));
      for (const key of Object.keys(inner)) inner[key].push(...sub[key]);
    }
    if (isRegenerableDir(name) && inner.credentials.length === 0) {
      // Reported once at its top; nested regenerable dirs fold into it.
      const all = allFiles(abs);
      out.regenerable.push({ abs, files: all.length, bytes: all.reduce((n, f) => n + f.bytes, 0) });
    } else {
      for (const key of Object.keys(inner)) out[key].push(...inner[key]);
    }
  }
  return out;
}

export function buildPlan({ repo, keepMonths, now, mode }) {
  const repoRoot = resolve(repo);
  const docsLocal = join(repoRoot, "docs.local");
  const rel = (abs) => relative(repoRoot, abs).split(sep).join("/");
  const nowMonth = now.slice(0, 7);
  const isFinished = (month) => monthIndex(month) < monthIndex(nowMonth);
  const isOld = (month) => monthIndex(nowMonth) - monthIndex(month) > keepMonths;

  const plan = {
    version: 1,
    repo: repoRoot,
    now,
    keepMonths,
    mode,
    moves: [],
    conflicts: [],
    upload: [],
    held: [],
    skipped: [],
    mtimeUnits: [],
    regenerable: [],
    totals: {
      files: 0, bytes: 0, dated: 0, undated: 0, credentialFiles: 0, mtimeUnits: 0, mtimeBytes: 0,
      emptyUnits: 0, contentHeld: 0, regenerable: 0, regenerableBytes: 0,
    },
  };
  const allMtimeUnits = [];
  if (!existsSync(docsLocal)) return finish(plan);

  const units = new Map(); // "<parent>|<month>" -> upload unit
  const addToUnit = (parentAbs, month, files) => {
    const key = `${parentAbs}|${month}`;
    if (!units.has(key)) {
      const area = rel(parentAbs).replace(/^docs\.local\/?/, "");
      units.set(key, {
        month,
        dir: rel(join(parentAbs, month)),
        driveTarget: ["Brain Drive/06_ARCHIVE/docs-local", basename(repoRoot), area, month]
          .filter(Boolean)
          .join("/"),
        files: [],
        bytes: 0,
      });
    }
    const unit = units.get(key);
    for (const f of files) {
      unit.files.push({ path: rel(f.abs), bytes: f.bytes });
      unit.bytes += f.bytes;
    }
  };
  const count = ({ files, credentials, reports, regenerable }) => {
    for (const f of [...files, ...credentials]) {
      plan.totals.files += 1;
      plan.totals.bytes += f.bytes;
    }
    for (const r of regenerable) {
      plan.regenerable.push({ path: rel(r.abs), files: r.files, bytes: r.bytes });
      plan.totals.files += r.files;
      plan.totals.bytes += r.bytes;
      plan.totals.regenerable += 1;
      plan.totals.regenerableBytes += r.bytes;
    }
    plan.totals.credentialFiles += credentials.length;
    for (const r of reports) {
      plan.skipped.push(
        r.kind === "dir"
          ? { path: rel(r.abs), reason: "credential", kind: "dir", files: r.files }
          : { path: rel(r.abs), reason: "credential", kind: "file" },
      );
    }
  };

  // Does any name below abs carry a date (or is a YYYY-MM folder)? Memoized:
  // an undated dir with a dated descendant is an area and is descended.
  const datedBelowMemo = new Map();
  const datedBelow = (abs) => {
    if (datedBelowMemo.has(abs)) return datedBelowMemo.get(abs);
    let found = false;
    for (const name of readdirSync(abs)) {
      const child = join(abs, name);
      const stat = lstatSync(child);
      if (stat.isSymbolicLink() || (stat.isDirectory() && isRegenerableDir(name))) continue;
      if (datedMonth(name) || (stat.isDirectory() && monthFolder(name))) found = true;
      else if (stat.isDirectory()) found = datedBelow(child);
      if (found) break;
    }
    datedBelowMemo.set(abs, found);
    return found;
  };

  // v2 (spec-owner ruling R-a/R-b/R-c): an undated dir with no dated name below
  // it is ONE unit, the highest such dir, dated by the newest file mtime inside.
  // Holds run first: a unit holding a credential is held whole and its mtimes
  // are never read. Old units join the upload plan; they are never moved.
  const mtimeUnit = (abs) => {
    const found = collect(abs);
    count(found);
    if (found.credentials.length > 0) {
      plan.held.push({
        path: rel(abs),
        reason: "contains credentials",
        members: [rel(abs)],
        credentials: found.credentials.map((c) => rel(c.abs)).sort(),
      });
      return;
    }
    // PR-8b: a regenerable dir at area level is already reported; it is no unit.
    if (isRegenerableDir(basename(abs))) return;
    // F2: nothing to archive (no files, or only empty ones) is counted, never planned.
    const bytes = found.files.reduce((n, f) => n + f.bytes, 0);
    if (found.files.length === 0 || bytes === 0) {
      plan.totals.emptyUnits += 1;
      return;
    }
    const newest = found.files.reduce((max, f) => Math.max(max, f.mtimeMs), 0);
    const month = new Date(newest).toISOString().slice(0, 7);
    const upload = isOld(month);
    if (upload) {
      // B1: an mtime unit is planned whole, so a secret-shaped file holds it whole.
      const content = found.files.flatMap((f) => contentShapes(f.abs).map((shape) => ({ path: rel(f.abs), shape })));
      if (content.length > 0) {
        plan.held.push({
          path: rel(abs),
          reason: "credential-content",
          members: [rel(abs)],
          credentials: [],
          content: content.sort((a, b) => a.path.localeCompare(b.path) || a.shape.localeCompare(b.shape)),
        });
        plan.totals.contentHeld += 1;
        return;
      }
    }
    allMtimeUnits.push({ path: rel(abs), month, files: found.files.length, bytes, upload });
    if (!upload) return;
    plan.totals.mtimeUnits += 1;
    plan.totals.mtimeBytes += bytes;
    // F1 (spec owner 16:10): an mtime unit is never moved, so its Drive target
    // mirrors its local path, <area>/<unitName>, with no month segment. An
    // undated unit name can never be a YYYY-MM, so no two units share a target
    // and none nests under another (qa/2026-01 vs qa/notes).
    const unitPath = rel(abs).replace(/^docs\.local\/?/, "");
    plan.upload.push({
      month,
      dir: rel(abs),
      dating: "mtime",
      driveTarget: ["Brain Drive/06_ARCHIVE/docs-local", basename(repoRoot), unitPath].join("/"),
      files: found.files.map((f) => ({ path: rel(f.abs), bytes: f.bytes })),
      bytes,
    });
  };

  // Dated items and month folders are units, classified whole and never
  // descended. They are grouped per (folder, month): the YYYY-MM/ folder plus
  // that month's dated siblings. A group holding any credential is held whole.
  const walk = (dirAbs) => {
    const groups = new Map(); // month -> [{ abs, name, found, dated }]
    for (const name of readdirSync(dirAbs).sort()) {
      const abs = join(dirAbs, name);
      if (dirAbs === docsLocal && name === PLAN_DIR) continue;
      const stat = lstatSync(abs);
      if (stat.isSymbolicLink()) continue;
      // An exact YYYY-MM name is the month group itself, never a dated item.
      const month = MONTH.test(name) ? null : datedMonth(name);
      const folderMonth = stat.isDirectory() ? monthFolder(name) : null;

      if (month || folderMonth) {
        const key = folderMonth ?? month;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ abs, name, found: collect(abs), dated: Boolean(month) });
      } else if (stat.isDirectory() && (isCredentialDir(name) || isBrowserProfile(abs))) {
        count(collect(abs));
      } else if (stat.isDirectory() && isRegenerableDir(name)) {
        mtimeUnit(abs); // held if it holds a credential; otherwise reported as regenerable, no unit
      } else if (stat.isDirectory() && datedBelow(abs)) {
        walk(abs);
      } else if (stat.isDirectory()) {
        mtimeUnit(abs);
      } else {
        count(collect(abs));
        plan.totals.undated += 1;
      }
    }

    for (const [month, members] of [...groups.entries()].sort()) {
      for (const m of members) {
        count(m.found);
        if (m.dated) plan.totals.dated += 1;
      }
      const credentials = members.flatMap((m) => m.found.credentials);
      if (credentials.length > 0) {
        plan.held.push({
          path: rel(join(dirAbs, month)),
          reason: "contains credentials",
          members: members.map((m) => rel(m.abs)).sort(),
          credentials: credentials.map((c) => rel(c.abs)).sort(),
        });
        continue;
      }
      // B1: scan only what this group would plan (a move or an upload).
      const planned = members.some((m) => m.dated && isFinished(month)) || isOld(month);
      const content = planned
        ? members
            .flatMap((m) => m.found.files)
            .flatMap((f) => contentShapes(f.abs).map((shape) => ({ path: rel(f.abs), shape })))
        : [];
      if (content.length > 0) {
        plan.held.push({
          path: rel(join(dirAbs, month)),
          reason: "credential-content",
          members: members.map((m) => rel(m.abs)).sort(),
          credentials: [],
          content: content.sort((a, b) => a.path.localeCompare(b.path) || a.shape.localeCompare(b.shape)),
        });
        plan.totals.contentHeld += 1;
        continue;
      }
      const unitFiles = [];
      for (const m of members) {
        if (m.dated && isFinished(month)) {
          const target = join(dirAbs, month, m.name);
          if (existsSync(target)) {
            plan.conflicts.push({ from: rel(m.abs), to: rel(target) });
            continue;
          }
          plan.moves.push({ from: rel(m.abs), to: rel(target) });
        }
        unitFiles.push(...m.found.files);
      }
      if (isOld(month)) addToUnit(dirAbs, month, unitFiles);
    }
  };
  walk(docsLocal);

  const monthUnits = [...units.values()].filter((u) => {
    const empty = u.files.length === 0 || u.bytes === 0; // F2
    if (empty) plan.totals.emptyUnits += 1;
    return !empty;
  });
  plan.upload = [...monthUnits, ...plan.upload].sort((a, b) => a.dir.localeCompare(b.dir));
  plan.mtimeUnits = allMtimeUnits.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)).slice(0, 5);
  return finish(plan);
}

function finish(plan) {
  plan.moves.sort((a, b) => a.from.localeCompare(b.from));
  plan.skipped.sort((a, b) => a.path.localeCompare(b.path));
  plan.regenerable.sort((a, b) => a.path.localeCompare(b.path));
  plan.totals.monthlyMoves = plan.moves.length;
  plan.totals.uploadMonths = plan.upload.filter((u) => u.dating !== "mtime").length;
  plan.totals.uploadFiles = plan.upload.reduce((n, u) => n + u.files.length, 0);
  plan.totals.uploadBytes = plan.upload.reduce((n, u) => n + u.bytes, 0);
  plan.totals.held = plan.held.length;
  return plan;
}

function human(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

export function summaryLine(plan) {
  const t = plan.totals;
  return (
    `drive-filing rollup: mode=${plan.mode} repo=${basename(plan.repo)} ` +
    `files=${t.files} bytes=${t.bytes} (${human(t.bytes)}) · ` +
    `monthly-moves=${t.monthlyMoves} · ` +
    `to-drive months=${t.uploadMonths} files=${t.uploadFiles} bytes=${t.uploadBytes} (${human(t.uploadBytes)}) · ` +
    `mtime-units=${t.mtimeUnits ?? 0} bytes=${t.mtimeBytes ?? 0} empty-units=${t.emptyUnits ?? 0} · ` +
    `regenerable-skipped=${t.regenerable ?? 0} bytes=${t.regenerableBytes ?? 0} · ` +
    `held=${t.held} content-held=${t.contentHeld ?? 0} credentials-skipped=${t.credentialFiles} conflicts=${plan.conflicts.length} undated=${t.undated}`
  );
}

function apply(plan) {
  const root = plan.repo;
  for (const move of plan.moves) {
    const to = join(root, move.to);
    mkdirSync(join(to, ".."), { recursive: true });
    renameSync(join(root, move.from), to);
  }
  // After the moves, upload paths point at the month folders.
  const moved = new Map(plan.moves.map((m) => [m.from, m.to]));
  for (const unit of plan.upload) {
    for (const file of unit.files) {
      for (const [from, to] of moved) {
        if (file.path === from || file.path.startsWith(`${from}/`)) {
          file.path = to + file.path.slice(from.length);
          break;
        }
      }
    }
  }
  const dir = join(root, "docs.local", PLAN_DIR);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `rollup-plan-${plan.now}.json`);
  writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`);
  return out;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    return 2;
  }
  const plan = buildPlan(args);
  if (args.mode === "apply") plan.planFile = apply(plan);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return 0;
  }
  const lines = [
    ...plan.skipped.map((s) =>
      s.kind === "dir" ? `skipped: credential ${s.path}/ (${s.files} files)` : `skipped: credential ${s.path}`,
    ),
    ...plan.regenerable.map((r) => `skipped: regenerable ${r.path}/ (${r.files} files, ${r.bytes} bytes)`),
    ...plan.held.flatMap((h) => [
      `held: ${h.reason} ${h.path}`,
      ...h.members.map((m) => `  item: ${m}`),
      ...h.credentials.map((c) => `  credential: ${c}`),
      ...(h.content ?? []).map((c) => `  content: ${c.path} (${c.shape})`),
    ]),
    ...plan.conflicts.map((c) => `conflict: ${c.from} -> ${c.to} exists`),
    summaryLine(plan),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

if (import.meta.main ?? process.argv[1] === new URL(import.meta.url).pathname) {
  process.exitCode = main(process.argv.slice(2));
}
