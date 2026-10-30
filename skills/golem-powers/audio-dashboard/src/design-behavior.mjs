function focusState(onLoad) {
  const interactive = 'a[href],button,input,select,textarea,audio[controls],video[controls],[contenteditable="true"],[role="button"],[role="slider"],.df-words[tabindex],[data-word-start],[data-ws]';
  const outlined = el => el && el.checkVisibility({ checkOpacity: true }) && getComputedStyle(el).outlineStyle !== 'none' && parseFloat(getComputedStyle(el).outlineWidth) > 0 && getComputedStyle(el).outlineColor !== 'rgba(0, 0, 0, 0)';
  const active = document.activeElement;
  return ![...document.querySelectorAll('body *')].some(el => !el.matches(interactive) && outlined(el)) && (!active || active === document.body || active === document.documentElement || (!onLoad && !outlined(active)) || active.matches(':focus-visible'));
}
export async function probeDesignBehavior(page, { seek = true } = {}) {
  const result = await page.evaluate(() => ({
    questions: [...document.querySelectorAll('.df-card,[data-question]')].map((el, index) => ({ key: el.id || el.dataset.question || String(index), clear: !!el.querySelector('button.df-clear,button[data-clear-question],button[data-question-clear]') })),
    reset: !!document.querySelector('button[data-reset-all],button#reset-all,button#reset,button.df-reset,input[type="reset"]') || [...document.querySelectorAll('button')].some(el => /^reset( all)?\b/i.test((el.getAttribute('aria-label') || el.textContent).trim())),
    scrub: false, seek: null,
  }));
  result.focusClean = await page.evaluate(focusState, true);
  for (const selector of ['time,.df-time,[data-time]', 'p,span,h1,h2,label']) {
    const text = page.locator(selector);
    const index = await text.evaluateAll(elements => elements.findIndex(el => el.checkVisibility() && !el.closest('button,a,input,[role=button],[data-word-start],[data-ws]') && !el.querySelector('button,input,select,[data-word-start],[data-ws]') && el.textContent.trim() && el.getBoundingClientRect().height > 0));
    if (index < 0) continue;
    const node = text.nth(index);
    await node.scrollIntoViewIfNeeded();
    const box = await node.boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    result.focusClean &&= await page.evaluate(focusState);
    break;
  }
  if (!seek) return { ...result, scrub: null, seek: { notRun: "FIRST_BUILD_NO_COMPARISON" } };
  await page.evaluate(async () => {
    await Promise.all([...document.querySelectorAll('audio')].map(async audio => {
      audio.muted = true; audio.pause();
      if (audio.readyState < 1 && (audio.currentSrc || audio.getAttribute('src') || audio.querySelector('source'))) await new Promise(resolve => { const done = () => { clearTimeout(timer); resolve(); }; const timer = setTimeout(resolve, 1500); audio.addEventListener('loadedmetadata', done, { once: true }); audio.addEventListener('error', done, { once: true }); audio.load(); });
    }));
  });
  const times = () => page.evaluate(() => [...document.querySelectorAll('audio')].map(audio => ({ time: audio.currentTime, decoded: Number.isFinite(audio.duration) && audio.duration > 0 })));
  if (!(await times()).some(audio => audio.decoded)) return result;
  for (const [source, selector] of [['word', '[data-word-start],[data-ws]'], ['range', 'input[type=range][data-scrub],input[type=range][aria-label*="seek" i],input#scrubber,input#scrub']]) {
    const targets = page.locator(selector);
    const index = await targets.evaluateAll((elements, source) => { const usable = el => el.checkVisibility() && el.getClientRects().length && (source === 'range' || Number(el.dataset.wordStart ?? el.dataset.ws) > 0); const late = elements.findIndex(el => usable(el) && (source === 'range' || Number(el.dataset.wordStart ?? el.dataset.ws) >= 0.5)); return late >= 0 ? late : elements.findIndex(usable); }, source);
    if (index < 0) continue;
    const target = targets.nth(index), before = await times();
    const expected = source === 'word' ? Number(await target.getAttribute('data-word-start') ?? await target.getAttribute('data-ws')) : null;
    try {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      await target.click({ position: { x: box.width * 0.55, y: box.height / 2 }, timeout: 1500 });
      if (source === 'range') await target.press('ArrowRight');
    } catch (error) { result.seek = { source, error: 'POINTER_TARGET_UNAVAILABLE' }; continue; }
    await page.evaluate(() => document.querySelectorAll('audio').forEach(audio => audio.pause()));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await times();
    await page.evaluate(() => document.querySelectorAll('audio').forEach(audio => audio.pause()));
    result.focusClean &&= await page.evaluate(focusState);
    const audioIndex = after.findIndex((audio, i) => audio.decoded && Math.abs(audio.time - before[i].time) > 0.05 && (expected === null || Math.abs(audio.time - expected) < 0.4));
    result.seek = { source, beforeTimes: before.map(a => a.time), afterTimes: after.map(a => a.time), audioIndex, before: before[audioIndex]?.time ?? 0, after: after[audioIndex]?.time ?? 0, target: expected, decoded: audioIndex >= 0 };
    if (audioIndex >= 0) { result.scrub = true; break; }
  }
  return result;
}
export function compareDesignBehavior(before, after) {
  const codes = [], share = rows => rows.length ? rows.filter(row => row.clear).length / rows.length : 0;
  if (before.focusClean && !after.focusClean) codes.push('STRAY_FOCUS');
  if (before.scrub && !after.scrub) codes.push('SCRUB');
  if ((before.reset && !after.reset) || share(after.questions) < share(before.questions)) codes.push('RESET_CONTROLS');
  return codes;
}
