import { test, expect } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const repo = path.resolve(root, '../../..');
const workflowPath = path.join(root, 'workflows/creation-steps.md');
const workflow = () => readFileSync(workflowPath, 'utf8');

test('SKILL routes the creation-steps argument to a real workflow near the top', () => {
  const skill = readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  expect(skill.slice(0, 1200)).toContain('`/audio-dashboard creation-steps`');
  expect(skill.slice(0, 1200)).toContain('(workflows/creation-steps.md)');
  expect(existsSync(workflowPath)).toBe(true);
  expect(skill).not.toContain('/audio-dashboard:creation-steps');
  const description = skill.match(/^description: "(.*)"$/m)[1];
  expect([...description].length).toBeLessThanOrEqual(1024);
});

test('real installer carries the linked workflow with the top-level skill', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'ad-creation-install-'));
  try {
    // Exercise recursive discovery + installation against real local skill files.
    // Only the remote contents transport is replaced; no network or agent calls.
    const program = `
      import { readdirSync, readFileSync, statSync } from 'node:fs';
      import path from 'node:path';
      const root = ${JSON.stringify(root)};
      const prefix = 'skills/golem-powers/audio-dashboard';
      globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.startsWith('https://fixture.invalid/raw/')) {
          return new Response(readFileSync(path.join(root, u.slice('https://fixture.invalid/raw/'.length))));
        }
        const rel = u.includes('/audio-dashboard/') ? u.split('/audio-dashboard/')[1] : '';
        const entries = readdirSync(path.join(root, rel)).filter(name =>
          rel === '' ? ['SKILL.md', 'workflows'].includes(name) : true);
        return Response.json(entries.map(name => {
          const file = path.posix.join(rel, name);
          const dir = statSync(path.join(root, file)).isDirectory();
          return { name, type: dir ? 'dir' : 'file', path: prefix + '/' + file,
            url: 'https://fixture.invalid/contents/audio-dashboard/' + file,
            download_url: dir ? null : 'https://fixture.invalid/raw/' + file };
        }));
      };
      const { installSkill } = await import(${JSON.stringify(path.join(repo, 'packages/golem-skills/src/install.ts'))});
      const result = await installSkill('audio-dashboard', { commandsDir: ${JSON.stringify(home)} });
      if (!result.installed) throw Error('not installed');
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', program]);
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
    const installed = path.join(home, 'audio-dashboard');
    expect(readFileSync(path.join(installed, 'SKILL.md'), 'utf8')).toContain('(workflows/creation-steps.md)');
    expect(readFileSync(path.join(installed, 'workflows/creation-steps.md'), 'utf8')).toBe(workflow());
  } finally { rmSync(home, { recursive: true, force: true }); }
});

const steps = ['Intake', 'Load the baseline', 'Author', 'Synthesize', 'BUILD', 'QA',
  'Prepare publish', 'Handoff to NarrationLayer', 'Validate delivery', 'Report'];
for (const [i, title] of steps.entries()) {
  test(`creation step ${i + 1}: ${title} has command, pass and stop criteria`, () => {
    const sections = workflow().split(/^## /m).slice(1);
    expect(sections).toHaveLength(10);
    const section = sections[i];
    expect(section.startsWith(`${i + 1}. ${title}\n`)).toBe(true);
    for (const marker of ['Command:', 'Pass:', 'Stop:']) expect(section).toContain(marker);
  });
}

test('authoring contract preserves the three operator rules and relay ownership', () => {
  const text = workflow();
  for (const requirement of [
    'RIGHT AFTER the explainer card it depends on; never batch decisions at the end',
    'The card’s visible prose is what the audio says',
    'the audio is a summary', 'copyPrompt', 'notes', 'Google Docs/Drive',
    'whether research-lifecycle has run', 'sources', 'extra_instructions_verbatim:',
    'accepted_receipt_path:', 'accepted_receipt_sha256:', 'deadline:', 'dashboard_id:',
    'acceptedBaseline', 'previousPublished', 'briefings', 'ben-c1', 'GOLEMS_EXPERT_VOICE',
    'Never use `--first-build` on `briefings`', 'READY_FOR_HOSTED_PUBLISH',
    'in-place-maintenance', 'X2', 'X3',
  ]) expect(text).toContain(requirement);
  const orc = readFileSync(path.join(root, '../orc/SKILL.md'), 'utf8')
    .split('### Audio dashboard handoffs\n')[1].split('\n---')[0];
  expect(orc).toContain('../audio-dashboard/workflows/creation-steps.md');
  expect(orc).toContain('filled relay block');
  expect(orc).toContain('adds no build instructions of its own');
  expect(orc).not.toContain('scripts/build-dashboard.mjs');
});
