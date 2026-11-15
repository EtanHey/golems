import { randomUUID } from 'node:crypto';
import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const jobNames = Object.freeze({
  'com.golems.worktree-gc': 'Golems Worktree Cleanup',
  'com.golems.stalker-live-guard': 'Golems Stream Guard',
  'com.golems.stream-watcher': 'Golems Stream Watcher',
  'com.golems.stalker-morning-digest': 'Golems Morning Digest',
  'com.golems.design-skill-updates': 'Golems Design Skill Updates',
  'com.golems.google-drive-oauth-guard': 'Golems Drive OAuth Guard',
  'com.golems.comfyui': 'Golems Image Generation',
  'com.golems.ratchet-inbox-relay': 'Golems Ratchet Inbox Relay',
  'com.golems.disk-guard': 'Golems Disk Guard',
  'com.golems.worktree-sweeper': 'Golems Worktree Sweeper',
});
const xml = s => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
const unxml = s => s.replace(/&(lt|gt|quot|apos|amp);/g, (_, c) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[c]);
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";

/** Create once, then verify bytes, ownership and mode; never replace existing code. */
export function installWrapper(home, name, program, { verifyOnly = false } = {}) {
  if (!path.isAbsolute(home) || !path.isAbsolute(program) || /[\r\n\0]/.test(program)) throw Error('absolute home and single-line program required');
  if (!Object.values(jobNames).includes(name)) throw Error('unowned wrapper name');
  if (path.resolve(home) !== home) throw Error('canonical absolute home required');
  const directory = path.join(home, '.local/lib/golems');
  for (const part of [home, path.join(home, '.local'), path.join(home, '.local/lib'), directory]) {
    if (!verifyOnly) {
      try { mkdirSync(part, { mode: 0o755 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    const info = lstatSync(part);
    if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o022)) throw Error(`unsafe wrapper directory: ${part}`);
    if (path.resolve(part) !== path.resolve(home) && !part.startsWith(home + path.sep)) throw Error('wrapper directory escaped home');
  }
  const target = path.join(directory, name);
  const bytes = `#!/bin/sh\nset -eu\nexec ${quote(program)} "$@"\n`;
  function verifyExisting() {
    const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o755 || readFileSync(fd, 'utf8') !== bytes) {
        throw Error(`wrapper differs; explicit reconciliation required: ${target}`);
      }
    } finally { closeSync(fd); }
  }
  if (verifyOnly) { verifyExisting(); return target; }
  // Publish only a fully written, synced file. link never replaces an arrival.
  const staging = path.join(directory, `.install-${process.pid}-${randomUUID()}`);
  let fd;
  let staged = false;
  try {
    fd = openSync(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    staged = true;
    writeFileSync(fd, bytes);
    fchmodSync(fd, 0o755);
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    try { linkSync(staging, target); }
    catch (e) { if (e.code !== 'EEXIST') throw e; verifyExisting(); }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (staged) unlinkSync(staging);
  }
  return target;
}

/** Change only argv[0]; all remaining plist bytes and command arguments survive. */
export function nameProgram(text, home, { install = true, verifyOnly = false } = {}) {
  const label = unxml(text.match(/<key>Label<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? '');
  const name = jobNames[label];
  if (!name) throw Error(`no owned Login Items name for ${label}`);
  if (/<key>Program<\/key>/.test(text)) throw Error('Program overrides ProgramArguments');
  const pattern = /(<key>ProgramArguments<\/key>\s*<array>\s*<string>)([^<]+)(<\/string>)/;
  const match = text.match(pattern);
  if (!match) throw Error('missing ProgramArguments[0]');
  const program = unxml(match[2]);
  const expected = path.join(home, '.local/lib/golems', name);
  if (program === expected) throw Error('already named plist; render from source instead');
  const wrapper = install ? installWrapper(home, name, program, { verifyOnly }) : expected;
  return text.replace(pattern, (_, start, _program, end) => start + xml(wrapper) + end);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [file] = process.argv.slice(2);
    if (!file || process.argv.length !== 3) throw Error('usage: node named-program.mjs RENDERED.plist');
    const text = nameProgram(readFileSync(file, 'utf8'), process.env.HOME);
    writeFileSync(file, text);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
