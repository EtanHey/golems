import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { compareDesignBehavior, probeDesignBehavior } from './design-behavior.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function historyLocation(spec, outputPath) {
  const series = spec.series || spec.id;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(series || '')) throw new Error('design preservation requires a slug-safe series or id');
  const directory = path.join(path.dirname(outputPath), '.adash-design', series);
  return { series, directory, index: path.join(directory, 'published.json') };
}

// Only the successful served-byte probe advances this pointer, never BUILD.
export function recordPublishedDesign(spec, outputPath, html) {
  const location = historyLocation(spec, outputPath), sha256 = hash(html);
  mkdirSync(location.directory, { recursive: true });
  const filename = `${sha256}.html`;
  writeFileSync(path.join(location.directory, filename), html);
  writeFileSync(`${location.index}.new-${process.pid}`, JSON.stringify({ series: location.series, filename, sha256 }));
  renameSync(`${location.index}.new-${process.pid}`, location.index);
}

export function loadPublishedDesign(spec, outputPath) {
  const location = historyLocation(spec, outputPath);
  const explicit = spec.designPreservation?.previousPublished;
  if (explicit !== undefined && (typeof explicit !== 'string' || !explicit.trim())) throw new Error('previous build missing: invalid previousPublished');
  try {
    // An existing publication ledger always wins over a migration pointer.
    if (existsSync(location.index)) {
      const record = JSON.parse(readFileSync(location.index, 'utf8'));
      if (record.series !== location.series || !/^[a-f0-9]{64}\.html$/.test(record.filename)) throw new Error('invalid publication record');
      const previousPath = path.join(location.directory, record.filename), previousHtml = readFileSync(previousPath, 'utf8');
      if (hash(previousHtml) !== record.sha256) throw new Error('published snapshot hash mismatch');
      return { series: location.series, previousHtml, previousPath };
    }
    if (existsSync(location.directory)) throw new Error('publication pointer missing');
    if (explicit !== undefined) {
      const previousPath = path.resolve(path.dirname(outputPath), explicit);
      const previousHtml = readFileSync(previousPath, 'utf8');
      if (!previousHtml.trim()) throw new Error('empty published snapshot');
      return { series: location.series, previousHtml, previousPath };
    }
    return { series: location.series, previousHtml: null };
  } catch {
    throw new Error('previous build missing: published snapshot unavailable or corrupt');
  }
}

// Runs after load without interactions, in a clean context with external requests blocked.
function inspectDom() {
  const all = selector => [...document.querySelectorAll(selector)];
  const visible = el => {
    for (let node = el; node; node = node.parentElement) {
      const css = getComputedStyle(node);
      if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
      if (node.tagName === 'DETAILS' && !node.open) return false;
    }
    return el.getClientRects().length > 0;
  };
  const key = (el, index) => el.id || el.dataset.transcriptScene || el.dataset.tp || `${el.tagName}:${index}`;
  const players = all('.pa-bar,.df-controller,.player-controls,#player,[data-preserve-player]').map((el, index) => {
    const css = getComputedStyle(el);
    return { key: key(el, index), pinned: visible(el) && ['sticky', 'fixed'].includes(css.position) && css.top === '0px' && !!el.querySelector('button,audio,input,select') };
  });
  const readalong = all('.tp,.df-teleprompter,.teleprompter,#teleprompter,[data-preserve-readalong]').map((el, index) => ({
    key: key(el.closest('[data-transcript-scene],[data-tp]') || el, index), visible: visible(el),
  }));
  const fullTranscript = all('[data-full-transcript],#full-transcript,.full-transcript,details').filter(el => el.matches('[data-full-transcript],#full-transcript,.full-transcript') || /^full transcript/i.test(el.querySelector('summary')?.textContent || '')).map((el, index) => ({ key: key(el, index), expanded: visible(el) && (el.tagName !== 'DETAILS' || el.open) }));
  const speakers = all('.df-transcript-scene,.aud,[data-transcript-scene]').map((el, index) => ({
    key: key(el, index), labels: [...el.querySelectorAll('.df-speaker,.who-name,.speaker,.speaker-label,[data-speaker]')]
      .filter(visible).map(label => label.textContent.trim()).filter(Boolean),
  }));
  const layout = all('.df-layout,main,.wrap:not(#golem-single-transport-wrap),[data-preserve-layout]').map((el, index) => {
    const css = getComputedStyle(el), box = el.getBoundingClientRect();
    return { key: key(el, index), maxWidth: css.maxWidth, centered: Math.abs(box.left + box.right - innerWidth) < 2 };
  });
  const answers = {};
  all('input[type="radio"],input[type="checkbox"]').forEach(el => {
    const group = `${el.type}:${el.name}`;
    answers[group] = (answers[group] || 0) + 1;
  });
  const proseCopy = all('button,[role="button"]').filter(el => /copy/i.test(`${el.textContent} ${el.id} ${el.className} ${el.getAttribute('aria-label') || ''}`))
    .filter(el => !el.matches('#df-copy,#dbx-copy,.df-story-copy,#df-note-copy-draft,#copy-all,#copy-answers,#nt-copy,[data-copy-answers]'))
    .filter(el => !el.closest('pre,[data-command],.code-block') && !(el.parentElement?.matches('div,figure') && el.parentElement.querySelector(':scope > pre,:scope > code') && !el.parentElement.querySelector('p'))).length;
  return { players, readalong, speakers, fullTranscript, layout, answers, proseCopy };
}

export async function checkDesignPreservation({ html, previousHtml, redesign, browser, screenshotDir }) {
  const violations = [], screenshots = [], behavior = [], baseline = previousHtml === null;
  const flag = (code, width) => violations.push({ code, metric: code, segment: 'dashboard', value: 0, threshold: 1, evidence: `${code} at ${width}px` });
  if (previousHtml === undefined) return { verdict: 'REJECTED', violations: [{ code: 'PREVIOUS_BUILD_MISSING', evidence: 'previous build missing' }], screenshots };
  if (redesign !== undefined && (!redesign || typeof redesign !== 'object' || typeof redesign.reason !== 'string' || !redesign.reason.trim() || /[\r\n]/.test(redesign.reason))) {
    return { verdict: 'REJECTED', violations: [{ code: 'REDESIGN_REASON_REQUIRED', evidence: 'redesign requires a one-line reason' }], screenshots };
  }
  const owned = !browser;
  browser ||= await chromium.launch();
  try {
    for (const width of [1280, 390]) {
      const states = [], captures = [];
      for (const [leg, content] of [['previous', baseline ? html : previousHtml], ['new', html]]) {
        const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
        try {
          const page = await context.newPage();
          await page.route('**/*', route => route.request().url() === 'https://preservation.test/' ? route.fulfill({ contentType: 'text/html', body: content }) : route.abort());
          await page.goto('https://preservation.test/', { waitUntil: 'load', timeout: 10000 });
          states.push(await page.evaluate(inspectDom));
          try {
            const capture = await page.screenshot({ animations: 'disabled' });
            captures.push(capture.toString('base64'));
            if (screenshotDir) { mkdirSync(screenshotDir, { recursive: true }); writeFileSync(path.join(screenshotDir, `${width}-${leg}.png`), capture); }
          } catch { captures.push(null); }
          states.at(-1).behavior = await probeDesignBehavior(page);
        } finally { await context.close(); }
      }
      const [before, after] = states;
      behavior.push({ width, previous: before.behavior, new: after.behavior });
      if (!baseline) {
        for (const code of compareDesignBehavior(before.behavior, after.behavior)) flag(code, width);
        if (before.players.some(old => old.pinned && !after.players.some(now => now.key === old.key && now.pinned))) flag('STICKY_PLAYER', width);
        if (before.readalong.some(old => old.visible && !after.readalong.some(now => now.key === old.key && now.visible))) flag('READ_ALONG', width);
        if (before.fullTranscript.some(old => old.expanded && !after.fullTranscript.some(now => now.key === old.key && now.expanded))) flag('FULL_TRANSCRIPT', width);
        if (before.speakers.some(old => old.labels.length && !after.speakers.some(now => now.key === old.key && old.labels.every(label => now.labels.includes(label))))) flag('SPEAKER_LABELS', width);
        if (before.layout.some(old => !after.layout.some(now => now.key === old.key && now.maxWidth === old.maxWidth && now.centered === old.centered))) flag('LAYOUT', width);
        if (Object.entries(before.answers).some(([group, count]) => (after.answers[group] || 0) < count)) flag('ANSWER_CONTROLS', width);
        if (after.proseCopy > before.proseCopy) flag('COPY_BUTTONS', width);
      }
      const page = await browser.newPage();
      try {
        if (captures.some(capture => !capture)) throw new Error('capture unavailable');
        const diff = await page.evaluate(async captures => {
          const images = await Promise.all(captures.map(async data => createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob())));
          const canvas = document.createElement('canvas'); canvas.width = images[0].width; canvas.height = images[0].height;
          const ctx = canvas.getContext('2d'), pixels = images.map(image => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, canvas.width, canvas.height); });
          let changed = 0;
          for (let i = 0; i < pixels[0].data.length; i += 4) {
            const delta = [0, 1, 2].map(c => Math.abs(pixels[0].data[i + c] - pixels[1].data[i + c]));
            if (delta.some(Boolean)) changed++;
            delta.forEach((value, c) => { pixels[0].data[i + c] = value; });
          }
          ctx.putImageData(pixels[0], 0, 0);
          return { pixelDiffRatio: changed / (canvas.width * canvas.height), png: canvas.toDataURL().split(',')[1] };
        }, captures);
        if (screenshotDir) writeFileSync(path.join(screenshotDir, `${width}-diff.png`), Buffer.from(diff.png, 'base64'));
        screenshots.push({ width, height: 844, pixelDiffRatio: baseline ? null : diff.pixelDiffRatio, reportOnly: true });
      } catch { screenshots.push({ width, height: 844, pixelDiffRatio: null, error: 'SCREENSHOT_UNAVAILABLE', reportOnly: true }); }
      finally { await page.close(); }
    }
  } finally { if (owned) await browser.close(); }
  return { verdict: violations.length && !redesign ? 'REJECTED' : 'PASS', status: baseline ? 'BASELINE' : redesign ? 'REDESIGN' : 'COMPARED', violations, screenshots, behavior, ...(redesign ? { redesign } : {}) };
}

export async function checkPublishedDesign(spec, outputPath, html, options = {}) {
  let previous;
  try { previous = loadPublishedDesign(spec, outputPath); }
  catch { return { verdict: 'REJECTED', violations: [{ code: 'PREVIOUS_BUILD_MISSING', metric: 'PREVIOUS_BUILD_MISSING', segment: 'dashboard', evidence: 'previous build missing' }] }; }
  return { ...await checkDesignPreservation({ ...previous, html, redesign: spec.redesign, ...options }), series: previous.series };
}

export function writeDesignReport(outputPath, html, result) {
  const reportPath = outputPath.replace(/\.html$/i, '') + '.design.json';
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ artifactSha256: hash(html), ...result }, null, 2) + '\n');
}
