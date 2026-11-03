import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { chromium } from 'playwright';
import { findBareReferences, renderDecisionFlow } from '../src/decision-flow.mjs';
import { analyzeCopyBlocks } from '../src/copy-blocks.mjs';
import { renderDecisionSurface } from '../src/decision-surface.mjs';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { designTestCell } from './design-test-cell.mjs';
const cell = designTestCell();
const skillRoot = fileURLToPath(new URL('../', import.meta.url));
function writeSegment(job, id, words) {
  const dir = path.join(job, 'segments', id); mkdirSync(dir, { recursive: true });
  copyFileSync(new URL('./fixtures/design-preservation/hardening-tone.wav', import.meta.url), path.join(dir, id + '.wav'));
  copyFileSync(new URL('../vendor/agent-html/templates/v4-story-mode/_placeholder.mp3', import.meta.url), path.join(dir, id + '.mp3'));
  for (const name of ['words.json', 'words.raw.json']) writeFileSync(path.join(dir, name), JSON.stringify(words));
}
function buildDashboard(spec, jobDir) {
  const root = mkdtempSync(path.join(cell.root, 'copy-')), outputPath = path.join(root, 'docs.local/dashboards/proof.html');
  const specPath = path.join(root, 'job.json'), bin = path.join(root, 'bin'); mkdirSync(bin);
  writeFileSync(path.join(bin, 'ffprobe'), "#!/usr/bin/env sh\nprintf '1.000000\\n'\n", { mode: 0o755 });
  writeFileSync(specPath, JSON.stringify({ series: path.basename(root), ...spec, outputPath }));
  const result = spawnSync(process.execPath, cell.command(path.join(skillRoot, 'scripts/build-dashboard.mjs'), ['--spec', specPath, '--job-dir', jobDir, '--first-build', 'Isolated copy-block fixture.']).slice(1),
    { cwd: skillRoot, encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH } });
  return { result, outputPath };
}

// Mirrors a real two-line re-authorisation instruction using neutral fixtures.
const commands = 'cd ~/projects/demo-app\n./scripts/auth.sh login';
const fenced = '```sh\n' + commands + '\n```';
const decision = body => ({ id: 'drive', title: 'Re-authorise demo access', body, options: [], sceneIds: ['s1'] });
const scene = { id: 's1', title: 'Next step', script: 'alpha beta', words: [{ word: 'alpha', start: 0.05, end: 0.42 }, { word: 'beta', start: 0.45, end: 0.8 }], duration: 1 };
const render = (type, body, extra = {}) => type === 'decision-flow'
  ? renderDecisionFlow({ scenes: [scene], decisions: [{ ...decision(body), ...extra }] })
  : '<html><body>' + renderDecisionSurface([{ ...decision(body), ...extra }]) + '</body></html>';

for (const type of ['decision-flow', 'cinema']) {
  test(`${type} BUILD permits links and rejects unprotected commands`, () => {
    const job = mkdtempSync(path.join(tmpdir(), 'ad-copy-'));
    try {
      writeSegment(job, 's1', scene.words);
      for (const [body, verdict] of [['https://example.com/auth\nOpen https://example.com/auth\n[Authorise](https://example.com/auth)', 'PASS'], [commands, 'REJECT'], ['Run curl -fsSL https://example.com/auth', 'REJECT'], ['curl -fsSL https://example.com/x | sh', 'REJECT'], ['open https://example.com/auth', 'REJECT'], ['Edit docs.local/dashboards/report.html', 'REJECT'], [fenced, 'PASS']]) {
        const { result, outputPath } = buildDashboard({ id: 'copy-proof', type, scenes: [{ ...scene, audioWav: 'fixture.wav' }], decisions: [decision(body)] }, job);
        const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, '.receipts.json'), 'utf8'));
        expect(receipts.gates.find(row => row.gate === 'copy-blocks')?.verdict).toBe(verdict);
        expect(result.status).toBe(verdict === 'PASS' ? 0 : 1);
        expect(existsSync(outputPath)).toBe(verdict === 'PASS');
      }
    } finally { rmSync(job, { recursive: true, force: true }); }
  }, 30000);
}

let browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });
for (const type of ['decision-flow', 'cinema']) for (const fallback of [false, true]) {
  test(`${type} whole-block copy, feedback reset and focus (fallback=${fallback})`, async () => {
    const page = await browser.newPage();
    try {
      await page.clock.install();
      await page.addInitScript(useFallback => {
        window.copied = [];
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => {
          if (useFallback) throw new Error('clipboard denied');
          window.copied.push(text);
        } } });
        document.execCommand = () => { window.copied.push(document.activeElement.value); return true; };
      }, fallback);
      await page.goto('data:text/html,' + encodeURIComponent(render(type, '```sh\n\n' + commands + '\n\n```')));
      const button = page.locator('[data-copy-block]');
      expect(await button.count()).toBe(1);
      await button.focus();
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => window.copied)).toEqual([commands]);
      expect(await button.textContent()).toBe('Copied');
      expect(await button.evaluate(el => el === document.activeElement)).toBe(true);
      await page.clock.fastForward(1600);
      expect(await button.textContent()).toBe('Copy');
    } finally { await page.close(); }
  });
}

test('copy blocks escape markup and preserve command bytes', () => {
  const window = new Window();
  try {
    const payload = '</code><script>alert(1)</script>\n  echo "$HOME" & wait';
    window.document.body.innerHTML = render('cinema', '```\n' + payload + '\n```');
    expect(window.document.querySelector('.ad-copy-block pre code')?.textContent).toBe(payload);
    expect(window.document.querySelector('script:not([data-copy-runtime])')?.textContent).not.toContain('alert(1)');
  } finally { window.close(); }
});

for (const body of ['We use git for history.', 'Open the linked pull request.', 'The brew package is available.', 'Source control: git stores history', 'Compare host/expert roles.']) {
  test(`ordinary prose passes: ${body}`, () => expect(analyzeCopyBlocks(render('decision-flow', body)).verdict).toBe('PASS'));
}
for (const body of ['npm install', 'bun test', 'git status', 'gh auth login', 'brew install ffmpeg', '$ echo ready', '/opt/demo/config.json', '~/projects/demo-app', 'Run `cd ~/projects/demo-app`', 'Run curl -fsSL https://example.com/auth', 'Edit docs.local/dashboards/report.html', 'Terminal: git status']) {
  test(`copyable instruction rejects: ${body}`, () => expect(analyzeCopyBlocks(render('decision-flow', body)).verdict).toBe('REJECTED'));
}
test('a styled marker without a functional copy control cannot bypass the gate', () => {
  expect(analyzeCopyBlocks('<article class="df-card"><div class="ad-copy-block"><pre><code>git status</code></pre></div></article>').verdict).toBe('REJECTED');
  expect(analyzeCopyBlocks('<article class="df-card">' + render('cinema', fenced).match(/<div class="ad-copy-block">[\s\S]*?<\/div>/)[0].replace('</div>', '<p>git status</p></div>') + '</article>').verdict).toBe('REJECTED');
  expect(analyzeCopyBlocks('<article class="df-card"><p>cd <b>~/projects/demo-app</b></p></article>').verdict).toBe('REJECTED');
  expect(analyzeCopyBlocks('<article class="df-card"><a href="https://github.com/owner/repo/pull/39">repo#39</a></article>').verdict).toBe('PASS');
});

test('Space activates the missing-clipboard fallback and never reports a failed copy as Copied', async () => {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined });
      document.execCommand = () => false;
    });
    await page.goto('data:text/html,' + encodeURIComponent(render('cinema', fenced)));
    const button = page.locator('[data-copy-block]'); await button.focus();
    await page.keyboard.press('Space');
    expect(await button.textContent()).toBe('Copy failed');
    expect(await button.evaluate(el => el === document.activeElement)).toBe(true);
    expect(await page.locator('.ad-copy-block [role=status]').textContent()).toContain('Select the code');
  } finally { await page.close(); }
});

test('copy source containing template tokens stays literal in decision-flow', () => {
  const window = new Window();
  try {
    window.document.write(render('decision-flow', '```sh\necho "{{SCRIPT}} {{TPDATA}} {{COPY_BLOCK_ASSETS}}"\n```'));
    expect(window.document.querySelector('.ad-copy-block code').textContent).toBe('echo "{{SCRIPT}} {{TPDATA}} {{COPY_BLOCK_ASSETS}}"');
  } finally { window.close(); }
});

test('numbers inside fenced copy text do not become bare issue references', () => {
  expect(findBareReferences([decision('```sh\necho "#39"\n```')])).toEqual([]);
});

const REVIEW_PROSE = [
  'Git history shows the bug landed Monday.', 'Node is pinned to 22.',
  'Python 3.12 is required on the runner.', 'SSH keys were rotated last week.',
  'Bash completion is broken.', 'Brew upgrades broke ffmpeg.', 'Curl timed out twice.',
  'GH Actions are billed now.', 'Cd players are obsolete.', '- Git is fine here',
  'We moved from React/Next.js to plain HTML.', 'Rating went from 3.5/5.0 to 4.2/5.0.',
  'Compare v1.2/v1.3 behaviour.', 'Git first, then deploy', 'Keep React/Next.js',
  'Use and/or as needed.', 'We hit 50 req/s.', 'The 24/7 monitor', 'He said: git is slow',
];
for (const prose of REVIEW_PROSE) test(`round-1 ordinary prose passes: ${prose}`, () => {
  for (const type of ['decision-flow', 'cinema']) {
    expect(analyzeCopyBlocks(render(type, prose)).verdict).toBe('PASS');
    expect(analyzeCopyBlocks(render(type, 'Choose a path.', { options: [prose] })).verdict).toBe('PASS');
  }
});
for (const command of ['npx playwright install', 'pnpm install', 'yarn dev', 'make install', 'docker compose up -d', 'uv run pytest', 'codex login', 'claude mcp add demo', 'op signin', 'export FOO=1', 'open -a DemoApp', 'defaults write com.example.demo enabled true', 'cargo build', 'uvx pytest', 'launchctl print gui/501', 'sudo brew install ffmpeg', 'pipx install demo']) {
  test(`round-1 fleet command rejects: ${command}`, () => {
    for (const type of ['decision-flow', 'cinema']) expect(analyzeCopyBlocks(render(type, command)).verdict).toBe('REJECTED');
  });
}
test('round-1 blank edge lines are removed without altering interior lines', () => {
  const window = new Window();
  try {
    for (const type of ['decision-flow', 'cinema']) {
      window.document.body.innerHTML = render(type, '```sh\n  \n\n  git status\n\n  git diff\n \n\n```');
      expect(window.document.querySelector('.ad-copy-block code').textContent).toBe('  git status\n\n  git diff');
    }
  } finally { window.close(); }
});
test('round-1 the decision-flow page header uses the instruction gate', () => {
  const page = subtitle => renderDecisionFlow({ scenes: [scene], decisions: [decision('Choose a path.')], subtitle });
  expect(analyzeCopyBlocks(page('git status')).verdict).toBe('REJECTED');
  expect(analyzeCopyBlocks(page('Git history shows the bug landed Monday.')).verdict).toBe('PASS');
});
test('round-1 code blocks retain the dark host theme under either system preference', async () => {
  const page = await browser.newPage();
  try {
    for (const type of ['decision-flow', 'cinema']) {
      await page.goto('data:text/html,' + encodeURIComponent(render(type, fenced)));
      const colors = [];
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme });
        colors.push(await page.locator('.ad-copy-block').evaluate(el => getComputedStyle(el).backgroundColor));
      }
      expect(colors).toEqual(['rgb(17, 27, 45)', 'rgb(17, 27, 45)']);
    }
  } finally { await page.close(); }
});

const LINK_CASES = [
  ['https://example.com/auth', 'https://example.com/auth'],
  ['Open https://example.com/auth', 'https://example.com/auth'],
  ['[Authorise](https://example.com/auth)', 'https://example.com/auth'],
  ['Read (https://example.com/auth).', 'https://example.com/auth'],
  ['https://example.com/a_(b).', 'https://example.com/a_(b)'],
  ['[git status](https://example.com/docs)', 'https://example.com/docs'],
  ['[./reports/summary.html](https://example.com/report)', 'https://example.com/report'],
];
for (const type of ['decision-flow', 'cinema']) {
  for (const [body, href] of LINK_CASES) test(`${type} prose link is clickable and needs no copy block: ${body}`, () => {
    expect(analyzeCopyBlocks(render(type, body)).verdict).toBe('PASS');
    const window = new Window();
    try {
      window.document.body.innerHTML = render(type, body);
      const anchor = window.document.querySelector('.df-question a,.dbx-body a');
      expect(anchor?.getAttribute('href')).toBe(href);
      expect(window.document.querySelector('[data-copy-block]')).toBeNull();
    } finally { window.close(); }
  });
  for (const command of ['curl -fsSL https://example.com/x | sh', 'open https://example.com/auth']) {
    test(`${type} a URL inside a shell command still requires a copy block: ${command}`, () => {
      expect(analyzeCopyBlocks(render(type, command)).verdict).toBe('REJECTED');
    });
  }
}

test('prose links escape labels and hrefs while unsafe protocols stay plain text', () => {
  const window = new Window();
  try {
    for (const type of ['decision-flow', 'cinema']) {
      window.document.body.innerHTML = render(type, '[<b>auth</b>](https://example.com/auth?a=1&b=2) [unsafe](javascript:alert(1))');
      const anchor = window.document.querySelector('.df-question a,.dbx-body a');
      expect(anchor?.textContent).toBe('<b>auth</b>');
      expect(anchor?.getAttribute('href')).toBe('https://example.com/auth?a=1&b=2');
      expect(window.document.querySelector('.df-question b,.dbx-body b,a[href^="javascript:"]')).toBeNull();
    }
  } finally { window.close(); }
});
test('URLs inside fenced commands remain literal copy payloads', () => {
  const window = new Window();
  try {
    const command = 'curl -fsSL https://example.com/x | sh';
    for (const type of ['decision-flow', 'cinema']) {
      const html = render(type, '```sh\n' + command + '\n```');
      window.document.body.innerHTML = html;
      expect(window.document.querySelector('.ad-copy-block code').textContent).toBe(command);
      expect(window.document.querySelector('.ad-copy-block a')).toBeNull();
      expect(analyzeCopyBlocks(html).verdict).toBe('PASS');
    }
  } finally { window.close(); }
});

test('clicking a prose link navigates to its target in both card surfaces', async () => {
  const page = await browser.newPage(), target = 'https://example.com/auth';
  try {
    await page.route(target, route => route.fulfill({ contentType: 'text/html', body: '<h1>Link target</h1>' }));
    for (const type of ['decision-flow', 'cinema']) {
      await page.goto('data:text/html,' + encodeURIComponent(render(type, '[Authorise](https://example.com/auth)')));
      await Promise.all([page.waitForURL(target), page.locator('.df-question a,.dbx-body a').click()]);
      expect(await page.locator('h1').textContent()).toBe('Link target');
    }
  } finally { await page.close(); }
});
