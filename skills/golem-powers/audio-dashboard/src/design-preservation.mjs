import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { compareDesignBehavior, probeDesignBehavior } from './design-behavior.mjs';
import { designHash as hash, loadPublishedDesign } from './design-history.mjs';
export { loadPublishedDesign, recordPublishedDesign, writeDesignReport } from './design-history.mjs';

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
    return { key: key(el, index), pinned: visible(el) && ['sticky', 'fixed'].includes(css.position) && css.top === '0px' && [...el.querySelectorAll('button,audio,input,select')].some(control => visible(control) && control.getBoundingClientRect().height > 0) && el.getBoundingClientRect().height > 0 };
  });
  const readalong = all('.tp,.df-teleprompter,.teleprompter,#teleprompter,[data-preserve-readalong]').map((el, index) => ({
    key: key(el.closest('[data-transcript-scene],[data-tp]') || el, index), visible: visible(el),
  }));
  const fullTranscript = all('[data-full-transcript],#full-transcript,.full-transcript,details').filter(el => el.matches('[data-full-transcript],#full-transcript,.full-transcript') || /^full transcript/i.test(el.querySelector('summary')?.textContent || '')).map((el, index) => ({ key: key(el, index), expanded: visible(el) && (el.tagName !== 'DETAILS' || el.open) }));
  const speakers = all('.df-transcript-scene,.aud,[data-transcript-scene]').map((el, index) => ({
    key: key(el, index), visible: visible(el), labels: [...el.querySelectorAll('.df-speaker,.who-name,.speaker,.speaker-label,[data-speaker]')]
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
  const main = document.querySelector('[data-preserve-layout],.df-layout') || document.querySelector('main')?.closest('.wrap') || document.querySelector('main,.wrap:not(#golem-single-transport-wrap)');
  const primary = main && layout[all('.df-layout,main,.wrap:not(#golem-single-transport-wrap),[data-preserve-layout]').indexOf(main)];
  return { players, readalong, speakers, fullTranscript, layout, primary, answers, proseCopy, copyControls: all('button').filter(el => /copy/i.test(el.textContent)).length, substitutes: all('[role=radio]:not(input),[role=checkbox]:not(input)').length };
}

export const DESIGN_CODES = ['STICKY_PLAYER', 'READ_ALONG', 'SPEAKER_LABELS', 'FULL_TRANSCRIPT', 'LAYOUT', 'ANSWER_CONTROLS', 'COPY_BUTTONS', 'STRAY_FOCUS', 'SCRUB', 'RESET_CONTROLS'];
const share = (rows, predicate) => rows.length ? rows.filter(predicate).length / rows.length : 0;
function compareDom(before, after) {
  const codes = [], table = [];
  const item = (code, old, now, preserved = !old || now) => { table.push({ code, detectedInPrevious: !!old, detectedInNew: !!now }); if (!preserved) codes.push(code); };
  item('STICKY_PLAYER', before.players.some(p => p.pinned), after.players.some(p => p.pinned));
  const oldShare = share(before.readalong, p => p.visible), newShare = share(after.readalong, p => p.visible);
  item('READ_ALONG', oldShare > 0, newShare > 0, !oldShare || newShare >= oldShare);
  const labels = state => share(state.speakers.filter(p => p.visible), p => p.labels.length);
  item('SPEAKER_LABELS', labels(before) > 0, labels(after) > 0, !labels(before) || labels(after) >= labels(before));
  item('FULL_TRANSCRIPT', before.endTranscript.visible, after.endTranscript.visible);
  item('LAYOUT', before.primary, after.primary, !before.primary || !!after.primary && before.primary.maxWidth === after.primary.maxWidth && before.primary.centered === after.primary.centered);
  const kinds = state => [...new Set(Object.keys(state.answers).map(group => group.split(':')[0]))];
  item('ANSWER_CONTROLS', kinds(before).length, kinds(after).length, kinds(before).every(kind => kinds(after).includes(kind)) && after.substitutes <= before.substitutes);
  item('COPY_BUTTONS', before.copyControls, after.copyControls, after.proseCopy <= before.proseCopy);
  return { codes, table };
}
async function inspectTranscriptEnd(page) {
  return page.evaluate(async () => {
    const panels = [...document.querySelectorAll('.tp,.df-teleprompter,.teleprompter,#teleprompter,[data-preserve-readalong],[data-full-transcript],#full-transcript,.full-transcript')];
    const visible = node => !!node && node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && !node.closest('details:not([open])') && node.getClientRects().length > 0;
    const panel = panels.at(-1), audio = [...document.querySelectorAll('audio')].at(-1);
    if (audio) audio.dispatchEvent(new Event('ended'));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { detected: !!panel, visible: visible(panel), endedDispatched: !!audio };
  });
}

export async function checkDesignPreservation({ html, previousHtml, redesign, browser, screenshotDir }) {
  const violations = [], screenshots = [], behavior = [], invariants = [], detail = [], baseline = previousHtml === null;
  const flag = (code, width) => violations.push({ code, metric: code, segment: 'dashboard', value: 0, threshold: 1, evidence: `${code} at ${width}px` });
  if (previousHtml === undefined) return { verdict: 'REJECTED', violations: [{ code: 'PREVIOUS_BUILD_MISSING', evidence: 'previous build missing' }], screenshots };
  if (redesign !== undefined && (!redesign || typeof redesign.reason !== 'string' || !redesign.reason.trim() || /[\r\n]/.test(redesign.reason) || !Array.isArray(redesign.invariants) || !redesign.invariants.length || redesign.invariants.some(code => !DESIGN_CODES.includes(code)) || redesign.from !== hash(previousHtml || ''))) {
    return { verdict: 'REJECTED', violations: [{ code: 'REDESIGN_SCOPE_MISMATCH', evidence: 'redesign requires a one-line reason, named invariants and the current predecessor hash' }], screenshots };
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
          await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); document.getAnimations().forEach(animation => { try { animation.finish(); } catch {} }); });
          states.push(await page.evaluate(inspectDom));
          try {
            const capture = await page.screenshot({ animations: 'disabled' });
            captures.push(capture.toString('base64'));
            if (screenshotDir) { mkdirSync(screenshotDir, { recursive: true }); writeFileSync(path.join(screenshotDir, `${width}-${leg}.png`), capture); }
          } catch { captures.push(null); }
          states.at(-1).behavior = await probeDesignBehavior(page);
          states.at(-1).endTranscript = await inspectTranscriptEnd(page);
        } finally { await context.close(); }
      }
      const [before, after] = states;
      detail.push({ width, previous: before, new: after, reportOnly: true });
      const comparison = compareDom(before, after);
      behavior.push({ width, previous: before.behavior, new: after.behavior });
      comparison.codes.push(...compareDesignBehavior(before.behavior, after.behavior));
      for (const [code, detected] of [['STRAY_FOCUS', state => state.players.length || state.readalong.length], ['SCRUB', state => state.behavior.scrub], ['RESET_CONTROLS', state => state.behavior.reset || state.behavior.questions.some(q => q.clear)]]) comparison.table.push({ code, detectedInPrevious: !!detected(before), detectedInNew: !!detected(after) });
      invariants.push(...comparison.table.map(row => ({ width, ...row })));
      if (!baseline) {
        for (const code of comparison.codes) flag(code, width);
        if (!comparison.table.some(row => row.detectedInPrevious)) flag('NO_DESIGN_SIGNAL', width);
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
  return { verdict: violations.some(v => !redesign?.invariants.includes(v.code)) ? 'REJECTED' : 'PASS', status: baseline ? 'BASELINE' : redesign ? 'REDESIGN' : 'COMPARED', violations, screenshots, invariants, detail, behavior, ...(redesign ? { redesign } : {}) };
}

export async function checkPublishedDesign(spec, outputPath, html, options = {}) {
  let previous;
  try { previous = loadPublishedDesign(spec, outputPath); }
  catch { return { verdict: 'REJECTED', violations: [{ code: 'PREVIOUS_BUILD_MISSING', metric: 'PREVIOUS_BUILD_MISSING', segment: 'dashboard', evidence: 'previous build missing' }] }; }
  return { ...await checkDesignPreservation({ ...previous, html, redesign: spec.redesign, ...options }), series: previous.series, ...(previous.baseline ? { baseline: previous.baseline } : {}) };
}
