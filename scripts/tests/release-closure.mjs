import { posix as path } from 'node:path';

// Literal dependency forms only: this is not an interpreter for arbitrary shell,
// Python or JS. Keep new forms covered by examples in build-release.test.mjs.
export function scriptReferences(file, source) {
  const directory = path.dirname(file);
  const references = new Set();
  const add = (base, relative) => {
    if (!relative || /[$`{}*]/.test(relative)) return;
    references.add(path.normalize(path.join(base, relative)));
  };
  const code = source.replace(/^\s*(?:#(?!\!)|\/\/).*$/gm, '');
  const literal = '[\'\"]([^\'\"\\n]+)[\'\"]';
  // Sourced libraries inherit the entrypoint's SCRIPT_DIR. Record both lexical
  // contexts; the caller filters against actual repository files, never guesses
  // that a missing path is shipped.
  const shellDirs = [directory];
  if (!/^\s*SCRIPT_DIR=/m.test(code) && directory === 'scripts/lib') shellDirs.push('scripts');
  for (const match of code.matchAll(/\$\{?(SCRIPT_DIR|HERE)\}?\/([^\s'"`;)<>]+)/g)) {
    for (const base of match[1] === 'SCRIPT_DIR' ? shellDirs : [directory]) add(base, match[2]);
  }
  // Imports (including side-effect, dynamic and CommonJS) and URL resources.
  for (const pattern of [
    /\bfrom\s*['"](\.[^'"]+)['"]/g,
    /\b(?:import|require)\s*(?:\(\s*)?['"](\.[^'"]+)['"]/g,
    /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
    /(?:source|\.|python3?|node|bash|sh|bun)\s+['"]?(\.{1,2}\/[^\s'";)]+)/g,
  ]) for (const match of code.matchAll(pattern)) add(directory, match[1]);
  for (const match of code.matchAll(/\b(?:source|python3?|node|bash|sh)\s+['"]?([\w.-]+\.(?:sh|bash|py|mjs|js|ts))\b/g)) add(directory, match[1]);
  // JS dirname(fileURLToPath(import.meta.url)) aliases and literal joins.
  const jsAnchors = new Map();
  for (const match of code.matchAll(/\b(\w+)\s*=\s*(?:path\.)?dirname\(fileURLToPath\(import\.meta\.url\)\)/g)) jsAnchors.set(match[1], directory);
  for (const [name, base] of jsAnchors) {
    for (const match of code.matchAll(new RegExp('(?:path\\.)?(?:join|resolve)\\(\\s*' + name + '((?:\\s*,\\s*[\'\"][^\'\"]+[\'\"])+)\\s*\\)', 'g'))) {
      add(base, [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(piece => piece[1]).join('/'));
    }
  }
  // Python pathlib anchors, optionally assigned and used in later joins.
  const anchors = new Map();
  for (const match of code.matchAll(/\b(\w+)\s*=\s*os\.path\.dirname\(os\.path\.(?:realpath|abspath)\(__file__\)\)/g)) anchors.set(match[1], directory);
  const pythonAnchor = /(?:pathlib\.)?Path\(__file__\)(?:\.resolve\(\))?((?:\.parents\[\d+\]|\.parent)*)/g;
  for (const match of code.matchAll(pythonAnchor)) {
    let base = file;
    for (const step of match[1].matchAll(/\.parent(?:s\[(\d+)\])?/g)) {
      for (let n = 0; n < Number(step[1] ?? 0) + 1; n++) base = path.dirname(base);
    }
    const tail = code.slice(match.index + match[0].length);
    const sibling = tail.match(new RegExp('^\\.with_name\\(\\s*' + literal + '\\s*\\)'));
    if (sibling) add(path.dirname(base), sibling[1]);
    const joined = tail.match(/^(?:\s*\/\s*['"][^'"]+['"])+/);
    if (joined) for (const piece of joined[0].matchAll(/['"]([^'"]+)['"]/g)) { base = path.join(base, piece[1]); references.add(path.normalize(base)); }
    const prefix = code.slice(0, match.index).match(/(\w+)\s*=\s*$/);
    if (prefix) anchors.set(prefix[1], base);
  }
  for (const [name, base] of anchors) {
    for (const match of code.matchAll(new RegExp('\\b' + name + '((?:\\s*\\/\\s*[\'\"][^\'\"]+[\'\"])+)', 'g'))) {
      let target = base;
      for (const piece of match[1].matchAll(/['"]([^'"]+)['"]/g)) { target = path.join(target, piece[1]); references.add(path.normalize(target)); }
    }
    for (const match of code.matchAll(new RegExp('os\\.path\\.join\\(\\s*' + name + '((?:\\s*,\\s*[\'\"][^\'\"]+[\'\"])+)\\s*\\)', 'g'))) {
      add(base, [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(piece => piece[1]).join('/'));
    }
  }
  if (file.endsWith('.py') || source.startsWith('#!') && /python/.test(source.split('\n')[0])) {
    for (const match of code.matchAll(/^\s*(?:from\s+(\.*[\w.]+)\s+import|import\s+([\w.]+))/gm)) {
      const name = match[1] ?? match[2];
      const dots = name.match(/^\.+/)?.[0].length ?? 0;
      add(path.join(directory, ...Array(Math.max(0, dots - 1)).fill('..')), name.slice(dots).replaceAll('.', '/') + '.py');
    }
  }
  return [...references];
}

export function closureViolations(files, isShipped, exceptions = {}) {
  const violations = [];
  for (const [file, source] of files) {
    if (!isShipped(file) || !(/\.(?:sh|bash|zsh|py|mjs|js|ts|tsx)$/.test(file) || source.startsWith('#!'))) continue;
    for (const reference of scriptReferences(file, source)) {
      // Bun/TS extensionless imports resolve to source files.
      const target = [reference, ...['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js'].map(ext => reference + ext)].find(candidate => files.has(candidate));
      if (!target || isShipped(target)) continue;
      const edge = `${file} -> ${target}`;
      if (!Object.hasOwn(exceptions, edge)) violations.push(edge);
    }
  }
  return [...new Set(violations)].sort();
}
