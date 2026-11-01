// Public policy specimens shipped with P1 (release archives omit test directories).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { codexCommand } from './codex-hooks-install.mjs';

export function checkReleaseHooks({ source, python, home, entries, expand }) {
  const specimens = [
    ['tmp-block', { tool_name: 'Write', tool_input: { file_path: '/tmp/golems-release-probe' } }],
    ['heredoc-guard', { tool_name: 'Bash', tool_input: { command: 'cat <<EOF\n$(golems-release-probe)\nEOF' } }],
    ['pre_tool_use', { tool_name: 'Write', tool_input: { file_path: path.join(home, '.env') } }],
    ['human-confirm-gate', { tool_name: 'Write', tool_input: { file_path: path.join(home, '.config/golems/human-confirm/token.json') } }],
  ];
  const gates = { 'tmp-block': 'tmp-block', 'heredoc-guard': 'heredoc-guard', pre_tool_use: 'git-guardian', 'human-confirm-gate': 'human-confirm' };
  let count = 0;
  for (const [id, denied] of specimens) {
    const entry = entries.find(e => e.id === id);
    if (!entry) throw new Error(`public hook self-tests: missing ${id}`);
    // Probe the source launcher before any installed copy or link exists.
    const claude = expand(entry.command.replace('{hooks}/golems-fail-open.py', '{live}/scripts/hooks/fail-open.py')
      .replace('{hooks}/' + entry.link, '{live}/' + entry.source));
    const codex = codexCommand(python, path.join(source, 'scripts/hooks/codex-policy-hook.py'), gates[id]);
    for (const [command, isCodex] of [[claude, false], [codex, true]]) for (const deny of [false, true]) {
      // Codex projects Write specimens to apply_patch; Bash stays inert JSON input.
      const tool = deny ? (isCodex && denied.tool_name === 'Write' ? { tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Add File: ${denied.tool_input.file_path}\n+x\n*** End Patch` } } : denied)
        : { tool_name: 'Bash', tool_input: { command: 'pwd' } };
      const payload = { ...tool, cwd: home, session_id: 'golems-public-self-check' };
      const scratch = mkdtempSync(path.join(home, '.heredoc-guard-probe-'));
      const env = { ...process.env, HOME: home,
        HEREDOC_GUARD_LEDGER: path.join(scratch, 'denials.jsonl') };
      for (const key of ['WEAVE_ALLOW_TMP', 'CLAUDE_WORKER', 'GOLEM_ROLE', 'GOLEMS_WORKER', 'GIT_GUARDIAN_LIB', 'PYTHONPATH', 'PYTHONHOME']) delete env[key];
      let result;
      try {
        result = spawnSync('/bin/sh', ['-c', command], { cwd: home, env, input: JSON.stringify(payload), encoding: 'utf8', timeout: 15_000 });
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
      let value, decision;
      try { value = JSON.parse(result.stdout); decision = value.decision === 'block' ? 'deny' : value.hookSpecificOutput?.permissionDecision; } catch { /* refusal below */ }
      if (!value || result.error || result.stderr || result.status !== (deny && !isCodex ? 2 : 0) || decision !== (deny ? 'deny' : undefined)) {
        throw new Error(`public hook self-tests: REFUSED ${id}/${isCodex ? 'codex' : 'claude'}/${deny ? 'deny' : 'allow'}`);
      }
      count++;
    }
  }
  console.log(`public hook self-tests: PASS (${count} specimens)`);
}
