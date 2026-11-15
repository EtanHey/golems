import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installWrapper } from '../../launchd/named-program.mjs';
const root = resolve(import.meta.dir, '../..');
const scratchRoot = join(root, 'docs.local/w171/round2');
mkdirSync(scratchRoot, { recursive: true });

function fixture() {
  const home = mkdtempSync(join(scratchRoot, 'transaction-'));
  const bin = join(home, 'bin'); mkdirSync(bin);
  const agents = join(home, 'Library/LaunchAgents'); mkdirSync(agents, { recursive: true });
  const plist = join(agents, 'com.golems.stream-watcher.plist');
  const oldWrapper = join(home, 'previous-wrapper'); writeFileSync(oldWrapper, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const old = `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>com.golems.stream-watcher</string><key>ProgramArguments</key><array><string>${oldWrapper}</string></array><key>KeepAlive</key><true/><!-- OLD-DEFINITION --></dict></plist>\n`;
  writeFileSync(plist, old); writeFileSync(join(home, 'state'), 'loaded');
  writeFileSync(join(bin, 'launchctl'), `#!/bin/bash
printf '%s\\n' "$*" >> "$HOME/calls"
state=$(cat "$HOME/state")
case "$1" in
  print)
    case "$state" in
      loaded) exit 0 ;;
      0) exit 1 ;;
      *) echo "$((state - 1))" > "$HOME/state"; exit 0 ;;
    esac ;;
  bootout) echo "$LINGER" > "$HOME/state" ;;
  bootstrap)
    if [[ "$state" != 0 ]]; then echo 'still loaded' >&2; exit 5; fi
    if /usr/bin/grep -q OLD-DEFINITION "$3"; then
      echo bootstrap-old >> "$HOME/calls"
    else
      echo bootstrap-new >> "$HOME/calls"
      if [[ "$FAIL_NEW" == 1 ]]; then exit 5; fi
    fi
    echo loaded > "$HOME/state" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
  // Deterministic poll transitions; no wall-clock sleeps in the fixture.
  writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return { home, bin, plist, old, oldWrapper };
}
for (const fail of [false, true]) {
  test(`job reload waits for departure and ${fail ? 'restores old job on bootstrap failure' : 'bootstraps once'}`, () => {
    const f = fixture();
    try {
      const r = Bun.spawnSync(['bash', join(root, 'launchd/install-job.sh'), 'com.golems.stream-watcher'], {
        env: { ...process.env, HOME: f.home, PATH: `${f.bin}:${process.env.PATH}`, NODE_BIN: Bun.which('node'), LINGER: '3', FAIL_NEW: fail ? '1' : '0' }, stdout: 'pipe', stderr: 'pipe',
      });
      const calls = readFileSync(join(f.home, 'calls'), 'utf8');
      if (fail) {
        expect(r.exitCode).not.toBe(0);
        expect(readFileSync(f.plist, 'utf8')).toBe(f.old);
        expect(calls).toContain('bootstrap-old');
        const backups = readdirSync(join(f.home, 'Library/LaunchAgents')).filter(x => x.includes('.prev.'));
        expect(backups).toHaveLength(1);
        expect(readFileSync(join(f.home, 'Library/LaunchAgents', backups[0]), 'utf8')).toBe(f.old);
      } else {
        expect(r.exitCode, r.stderr.toString()).toBe(0);
        expect(calls.split('\n').filter(x => x === 'bootstrap-new')).toHaveLength(1);
        expect(readdirSync(join(f.home, 'Library/LaunchAgents')).filter(x => x.includes('.prev.'))).toHaveLength(0);
      }
      expect(readFileSync(join(f.home, 'state'), 'utf8').trim()).toBe('loaded');
      expect(readFileSync(f.oldWrapper, 'utf8')).toBe('#!/bin/sh\nexit 0\n');
      const afterBootout = calls.split('\n').slice(calls.split('\n').findIndex(x => x.startsWith('bootout ')) + 1);
      expect(afterBootout.slice(0, 4).every(x => x.startsWith('print '))).toBe(true);
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });
}

test('process death during wrapper write never publishes a partial executable', () => {
  const home = mkdtempSync(join(scratchRoot, 'crash-'));
  try {
    const source = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const write = fs.writeFileSync;
      fs.writeFileSync = (fd, bytes, ...options) => {
        if (typeof fd !== 'number') return write(fd, bytes, ...options);
        write(fd, bytes.slice(0, 7));
        process.kill(process.pid, 'SIGKILL');
      };
      syncBuiltinESMExports();
      const { installWrapper } = await import(${JSON.stringify(join(root, 'launchd/named-program.mjs'))});
      installWrapper(${JSON.stringify(home)}, 'Golems Stream Watcher', '/bin/sh');
    `;
    const r = spawnSync(Bun.which('node'), ['--input-type=module', '-e', source]);
    expect(r.signal).toBe('SIGKILL');
    expect(existsSync(join(home, '.local/lib/golems/Golems Stream Watcher'))).toBe(false);
    const directory = join(home, '.local/lib/golems');
    const stages = readdirSync(directory).filter(x => x.startsWith('.install-'));
    expect(stages).toHaveLength(1);
    expect(statSync(join(directory, stages[0])).mode & 0o777).toBe(0o600);
    const wrapper = installWrapper(home, 'Golems Stream Watcher', '/bin/sh');
    expect(readFileSync(wrapper, 'utf8')).toBe(`#!/bin/sh\nset -eu\nexec '/bin/sh' "$@"\n`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
