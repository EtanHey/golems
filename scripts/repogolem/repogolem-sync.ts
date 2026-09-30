// MBP resolves the remote machine's refs; SSH receives bytes only on stdin.
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';
import { opResolver, resolveRefs, secretsEnvText } from './repogolem-secrets';
const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
function shellPath(path: string) { return path.startsWith('~/') ? '"$HOME"/' + quote(path.slice(2)) : quote(path); }
type Generated = { configSha: string; machine: string | null; refs: string[]; secretsHeader: string };
export function runSync(argv: string[], build: (text: string, home: string, source: string, host: () => string) => Generated, source: string): number {
  const [target, ...options] = argv;
  if (target !== 'm1') throw new Error('usage: sync m1 [--config <file>] [--remote-repo <path>] [--dry-run]');
  let config = process.env.REPOGOLEM_CONFIG, repo = process.env.REPOGOLEM_REMOTE_REPO, dry = false;
  for (let i = 0; i < options.length; i++) {
    if (options[i] === '--config' && options[i + 1]) config = options[++i];
    else if (options[i] === '--remote-repo' && options[i + 1]) repo = options[++i];
    else if (options[i] === '--dry-run') dry = true;
    else throw new Error('unknown sync option');
  }
  if (!config) throw new Error('sync requires --config or REPOGOLEM_CONFIG');
  if (!repo) {
    try { repo = parseYaml(readFileSync(config, 'utf8'))?.syncTargets?.[target]?.repo; } catch { throw new Error('sync config could not be read; values hidden'); }
  }
  if (typeof repo !== 'string') throw new Error('sync requires --remote-repo, REPOGOLEM_REMOTE_REPO, or syncTargets.m1.repo');
  if (!/^(~\/|\/)[^\n\r\0]+$/.test(repo)) throw new Error('remote repo must be an absolute or ~/ path');
  if (dry) {
    console.log(`would SSH ${target}: pull --ff-only, read LocalHostName, resolve its refs locally once, stream under umask 077, generate --secrets-from; no SSH or op run`);
    return 0;
  }
  const ssh = process.env.REPOGOLEM_SSH_BIN || 'ssh';
  function remote(command: string, stdin?: Uint8Array) {
    const result = Bun.spawnSync([ssh, '-o', 'BatchMode=yes', target, command], { stdin: stdin ?? 'ignore', stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode !== 0) throw new Error('remote sync step failed; no secret output displayed');
    return result.stdout.toString();
  }
  const remoteRepo = shellPath(repo);
  remote(`git -C ${remoteRepo} pull --ff-only`);
  const identity = remote('scutil --get LocalHostName && printf "%s\\n" "$HOME"').trimEnd().split('\n');
  if (identity.length !== 2 || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(identity[0]) || !/^\/[^\r\n\0]+$/.test(identity[1])) {
    throw new Error('remote host/home identity is invalid');
  }
  const generated = build(readFileSync(config, 'utf8'), identity[1], source, () => identity[0]);
  const values = resolveRefs(generated.refs, opResolver(process.env.REPOGOLEM_OP_BIN || 'op'));
  const stream = Buffer.from(secretsEnvText(generated.secretsHeader, values));
  // No symlink ancestor or pre-placed incoming leaf may redirect the stream.
  // Noclobber reserves a new 0600 file. The generator does its own bound writes.
  const command = `set -eu; umask 077; for d in "$HOME" "$HOME/.config" "$HOME/.config/repogolem" "$HOME/.config/repogolem/generated"; do test ! -L "$d"; if test -e "$d"; then test "$(stat -f %u "$d")" = "$(id -u)"; mode=$(stat -f %Lp "$d"); test "$((0$mode & 022))" -eq 0; fi; done; mkdir -p "$HOME/.config/repogolem/generated"; chmod 700 "$HOME/.config/repogolem/generated"; cache="$HOME/.config/repogolem/generated/.incoming-$$"; set -C; cat > "$cache"; set +C; trap 'rm -f "$cache"' EXIT; repogolem generate --config ${remoteRepo}/repogolem/config.yaml --host ${quote(identity[0])} --secrets-from "$cache"`;
  try { remote(command, stream); } finally { stream.fill(0); }
  console.log(`synced ${target}: ${generated.refs.length} references, one local resolution; remote op not run`);
  return 0;
}
