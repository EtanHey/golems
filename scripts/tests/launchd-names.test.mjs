import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync, statSync, chmodSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dir, '../..');
mkdirSync(join(root, 'docs.local/w171'), { recursive: true });
test('installed morning job has a human Login Items name', () => {
  const home = mkdtempSync(join(root, 'docs.local/w171/naming-'));
  try {
    const out = Bun.spawnSync(['bash', join(root, 'launchd/install-stalker-morning-digest.sh'), '--skip-launchctl'], {
      env: { ...process.env, HOME: home, NODE_BIN: process.execPath }, stdout: 'pipe', stderr: 'pipe',
    });
    expect(out.exitCode, out.stderr.toString()).toBe(0);
    const plist = readFileSync(join(home, 'Library/LaunchAgents/com.golems.stalker-morning-digest.plist'), 'utf8');
    expect(plist.match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>(.*?)<\/string>/s)[1].split('/').at(-1)).toBe('Golems Morning Digest');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

const { nameProgram, jobNames, installWrapper } = await import('../../launchd/named-program.mjs');
test('every owned template gets a valid executable name and otherwise identical plist bytes', () => {
  const scratch = mkdtempSync(join(root, 'docs.local/w171/all-'));
  const home = join(scratch, "Home & O'Neil"); mkdirSync(home);
  try {
    for (const [label, name] of Object.entries(jobNames)) {
      const template = ['com.golems.disk-guard', 'com.golems.worktree-sweeper', 'com.golems.ratchet-inbox-relay'].includes(label)
        ? join(root, 'scripts/fleet', label + '.plist.template')
        : join(root, 'launchd', label + (label.endsWith('oauth-guard') ? '.plist.in' : '.plist'));
      let text = readFileSync(template, 'utf8').replaceAll('@HOME@', home.replaceAll('&', '&amp;').replaceAll("'", '&apos;'))
        .replaceAll('__HOME__', home.replaceAll('&', '&amp;').replaceAll("'", '&apos;'))
        .replaceAll('@GOLEMS_ROOT@', root).replaceAll('@NODE_BIN@', process.execPath)
        .replace(/@[A-Z_]+@/g, '/fixture/path');
      const named = nameProgram(text, home);
      const original = /(<key>ProgramArguments<\/key>\s*<array>\s*<string>)([^<]+)(<\/string>)/;
      expect(named.replace(original, '$1PROGRAM$3')).toBe(text.replace(original, '$1PROGRAM$3'));
      expect(nameProgram(text, home)).toBe(named); // reinstall verifies without replacement
      const file = join(home, '.local/lib/golems', name);
      expect(statSync(file).mode & 0o777).toBe(0o755);
      const shell = Bun.spawnSync(['/bin/sh', '-n', file]); expect(shell.exitCode).toBe(0);
      const plist = join(scratch, label + '.plist'); writeFileSync(plist, named);
      if (process.platform === 'darwin') expect(Bun.spawnSync(['/usr/bin/plutil', '-lint', plist]).exitCode).toBe(0);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
test('wrapper forwards exact arguments and exit code through a quoted executable path', () => {
  const home = mkdtempSync(join(root, 'docs.local/w171/exec-'));
  try {
    const program = join(home, "real '& command");
    writeFileSync(program, `#!/bin/sh\nprintf '%s\\n' "$@"\nexit 37\n`, { mode: 0o755 });
    const wrapper = installWrapper(home, 'Golems Stream Watcher', program);
    const args = ['with spaces', "quote'", '$HOME', '', '&< >'];
    const result = Bun.spawnSync([wrapper, ...args]);
    expect(result.exitCode).toBe(37); expect(result.stdout.toString()).toBe(args.join('\n') + '\n');
    writeFileSync(wrapper, 'different bytes');
    expect(() => installWrapper(home, 'Golems Stream Watcher', program)).toThrow('differs');
    expect(readFileSync(wrapper, 'utf8')).toBe('different bytes');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('symlink and mode drift refuse without replacement', () => {
  const home = mkdtempSync(join(root, 'docs.local/w171/custody-'));
  try {
    const wrapper = installWrapper(home, 'Golems Disk Guard', '/bin/sh');
    chmodSync(wrapper, 0o644);
    expect(() => installWrapper(home, 'Golems Disk Guard', '/bin/sh')).toThrow('differs');
    rmSync(wrapper); symlinkSync('/bin/sh', wrapper);
    expect(() => installWrapper(home, 'Golems Disk Guard', '/bin/sh')).toThrow();
    rmSync(wrapper); rmdirSync(join(home, '.local/lib/golems')); symlinkSync(home, join(home, '.local/lib/golems'));
    expect(() => installWrapper(home, 'Golems Disk Guard', '/bin/sh')).toThrow('unsafe');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
