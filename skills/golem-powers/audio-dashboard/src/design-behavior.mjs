// AD-02/06/07/10/20: inspect clean-load focus, real media seeking, and scoped clears.
// Media methods and currentTime are never stubbed or assigned by this probe.
export async function probeDesignBehavior(page) {
  return page.evaluate(async () => {
    const all = selector => [...document.querySelectorAll(selector)];
    const visible = el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getClientRects().length > 0;
    const interactive = 'a[href],button,input,select,textarea,audio[controls],video[controls],[contenteditable="true"],[role="button"],[role="slider"],.df-words[tabindex],[data-word-start],[data-ws]';
    const active = document.activeElement;
    const strayOutline = all('body *').some(el => {
      const css = getComputedStyle(el);
      return visible(el) && !el.matches(interactive) && css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0 && css.outlineColor !== 'rgba(0, 0, 0, 0)';
    });
    const focusClean = !strayOutline && (!active || active === document.body || active === document.documentElement || active.matches(':focus-visible'));
    const questions = all('.df-card,[data-question]').map((el, index) => ({
      key: el.id || el.dataset.question || String(index),
      clear: !!el.querySelector('button.df-clear,button[data-clear-question],button[data-question-clear]'),
    }));
    const reset = !!document.querySelector('button[data-reset-all],button#reset-all,button#reset,button.df-reset,input[type="reset"]');
    const target = all('[data-word-start],[data-ws],input[type="range"][data-scrub],input[type="range"][aria-label*="seek" i],input#scrubber,input#scrub')
      .find(el => visible(el) && (el.type === 'range' || Number(el.dataset.wordStart ?? el.dataset.ws) > 0));
    const result = { focusClean, questions, reset, scrub: false, seek: null };
    const audio = target && (target.closest('.df-card,.aud,[data-question]')?.querySelector('audio') || document.querySelector('audio'));
    if (!audio) return result;
    audio.pause();
    if (audio.readyState < 1) await new Promise(resolve => {
      const timer = setTimeout(resolve, 1500);
      audio.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(); }, { once: true });
      audio.load();
    });
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return result;
    const before = audio.currentTime;
    const expected = target.type === 'range' ? (Number(target.min || 0) + Number(target.max || 100)) / 2 : Number(target.dataset.wordStart ?? target.dataset.ws);
    if (target.type === 'range') {
      target.value = String(expected);
      target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true }));
    } else target.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    audio.pause();
    result.seek = { before, after: audio.currentTime, target: target.type === 'range' ? null : expected, decoded: true };
    result.scrub = Math.abs(audio.currentTime - before) > 0.05 && (target.type === 'range' || Math.abs(audio.currentTime - expected) < 0.4);
    return result;
  });
}

export function compareDesignBehavior(before, after) {
  const codes = [];
  if (before.focusClean && !after.focusClean) codes.push('STRAY_FOCUS');
  if (before.scrub && !after.scrub) codes.push('SCRUB');
  if ((before.reset && !after.reset) || before.questions.some(old => old.clear && !after.questions.some(now => now.key === old.key && now.clear))) codes.push('RESET_CONTROLS');
  return codes;
}
