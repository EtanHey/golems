import { expect, test } from 'bun:test';
import { boot, scene } from './decision-flow-harness.mjs';

const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
// A prior batch just completed. Text waits max(now + 10s, lastBatch + 60s),
// including empty strings and tombstones; discrete picks schedule a 1.2s batch.
function bridge(account, hold = false) {
  const pending = new Map(), calls = [], releases = [];
  let now = 0, due = Infinity, flushes = 0;
  const commit = () => {
    for (const [key, value] of pending) { if (value === null) delete account[key]; else account[key] = value; }
    pending.clear(); due = Infinity;
  };
  const store = {
    load: async () => ({ ...account, ...Object.fromEntries(pending) }),
    save(key, value) {
      calls.push([key, value]); pending.set(key, value);
      due = Math.min(due, key.endsWith('-free') ? Math.max(now + 10000, 60000) : now + 1200);
      return hold ? new Promise(resolve => releases.push(() => resolve({ ok: true, queued: true }))) : Promise.resolve({ ok: true, queued: true });
    },
    status: () => pending.size ? 'Saving…' : 'Saved',
    flush() { flushes++; commit(); },
  };
  return { store, calls, releases, get flushes() { return flushes; }, advance(ms) { now += ms; if (due <= now) commit(); } };
}
const config = (id, answerStore) => ({
  answerStore, scenes: [scene('s')],
  decisions: [{ id, title: 'Synthetic card', options: id.startsWith('info-') ? [] : ['Keep', 'Change'], sceneIds: ['s'] }],
});
function input(run, value) {
  const area = run.document.querySelector('.df-free');
  area.value = value; area.dispatchEvent(new run.window.Event('input', { bubbles: true }));
}

for (const id of ['info-synthetic', 'decision-synthetic']) for (const action of ['input', 'Clear']) {
  test(`${id}: ${action} of a saved note reaches the account during a typing hold and stays empty on fresh load`, async () => {
    const key = id + '-free', account = { [key]: 'Synthetic saved note', untouched: 'Retain' };
    const b = bridge(account), run = boot(config(id, b.store)); let fresh;
    try {
      await settle(); expect(run.document.querySelector('.df-free').value).toBe('Synthetic saved note');
      if (action === 'input') input(run, '');
      else {
        run.document.querySelector('.df-clear').click();
        expect(b.calls).toEqual([]); // The first click only opens confirmation.
        run.document.querySelector('.df-clear-apply').click();
      }
      await settle(); b.advance(11000); await settle();
      expect(b.calls).toEqual([[key, action === 'input' ? '' : null]]);
      expect(account[key] ?? '').toBe(''); expect(account.untouched).toBe('Retain');
      fresh = boot(config(id, bridge(account).store)); await settle();
      expect(run.document.querySelector('.df-free').value).toBe('');
      expect(fresh.document.querySelector('.df-free').value).toBe('');
    } finally { await run.window.happyDOM.close(); if (fresh) await fresh.window.happyDOM.close(); }
  });
}

test('confirmed Clear also removes a radio pick, without changing another answer', async () => {
  const account = { 'decision-synthetic': 'Keep', untouched: 'Retain' }, b = bridge(account);
  const run = boot(config('decision-synthetic', b.store)); let fresh;
  try {
    await settle(); expect(run.document.querySelector('input:checked').value).toBe('Keep');
    run.document.querySelector('.df-clear').click(); run.document.querySelector('.df-clear-apply').click();
    await settle(); b.advance(11000); await settle();
    expect(b.calls).toEqual([['decision-synthetic', null]]);
    expect(account).toEqual({ untouched: 'Retain' });
    fresh = boot(config('decision-synthetic', bridge(account).store)); await settle();
    expect(fresh.document.querySelector('input:checked')).toBeNull();
  } finally { await run.window.happyDOM.close(); if (fresh) await fresh.window.happyDOM.close(); }
});

test('ordinary nonempty typing keeps the bridge batching window', async () => {
  const account = { 'info-synthetic-free': 'Synthetic saved note' }, b = bridge(account);
  const run = boot(config('info-synthetic', b.store));
  try {
    await settle(); input(run, 'Synthetic next note'); await settle(); b.advance(11000);
    expect(b.calls).toEqual([['info-synthetic-free', 'Synthetic next note']]);
    expect(b.flushes).toBe(0); expect(account['info-synthetic-free']).toBe('Synthetic saved note');
    b.advance(49000); expect(account['info-synthetic-free']).toBe('Synthetic next note');
  } finally { await run.window.happyDOM.close(); }
});

test('clearing waits for the queued handoff acknowledgement before requesting the bridge flush', async () => {
  const account = { 'info-synthetic-free': 'Synthetic saved note' }, b = bridge(account, true);
  const run = boot(config('info-synthetic', b.store));
  try {
    await settle(); input(run, ''); await settle();
    expect(b.calls).toEqual([['info-synthetic-free', '']]); expect(b.flushes).toBe(0);
    b.releases.shift()(); await settle();
    expect(b.flushes).toBe(1); expect(account['info-synthetic-free']).toBe('');
  } finally { await run.window.happyDOM.close(); }
});
