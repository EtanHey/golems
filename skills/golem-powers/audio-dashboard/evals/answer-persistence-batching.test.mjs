import { expect, test } from 'bun:test';
import vm from 'node:vm';
import { ANSWER_RUNTIME } from '../src/answer-persistence.mjs';

const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function setup(remote, local = { getItem: () => null, setItem() {} }, prefix = '') {
  const events = {}, timers = new Map(), intervals = new Map(); let timer = 0;
  const win = { __answerStore: remote, addEventListener(name, cb) { events[name] = cb; },
    setTimeout(cb) { timers.set(++timer, cb); return timer; }, clearTimeout(id) { timers.delete(id); }, setInterval(cb) { intervals.set(++timer, cb); return timer; }, clearInterval(id) { intervals.delete(id); } };
  const document = { defaultView: win, querySelector: () => ({ content: 'batch-proof' }) };
  const context = vm.createContext({ document, localStorage: local });
  vm.runInContext(ANSWER_RUNTIME, context);
  let text, error; const changes = [];
  const consumer = win.AudioDashboardAnswers({ key: 'dbx:batch-proof', prefix, status: (t, e) => { text = t; error = e; }, change: (...args) => changes.push(args) });
  return { consumer, events, timers, intervals, changes, context, get text() { return text; }, get error() { return error; } };
}
function bridge() {
  let text = 'Saved', notify, remoteChange; const saves = []; let flushes = 0;
  const remote = { load: async () => ({}), save: async (key, value) => { saves.push([key, value]); text = 'Saving…'; notify?.(key, text); return { ok: true, queued: true }; },
    status: () => text, onStatus(cb) { notify = cb; }, onRemoteChange(cb) { remoteChange = cb; }, flush() { flushes++; } };
  return { remote, saves, get flushes() { return flushes; }, emit(key, state, aggregate = state) { text = aggregate; notify(key, state); }, change(key, value) { remoteChange(key, value); } };
}

test('queued acknowledgement stays pending, respects batching and reports retry/quota/refusal until confirmed', async () => {
  const b = bridge(), h = setup(b.remote); await h.consumer.ready;
  h.consumer.save({ 'q-free': 'Keep this edit' }); await settle();
  expect(b.saves).toEqual([['q-free', 'Keep this edit']]); expect(b.flushes).toBe(0);
  expect(h.text).toBe('Saving…'); expect(h.error).toBe(false);
  for (const text of ['Saved on this device · retrying', 'Saved on this device · syncs to your account at 12:00', 'Saved on this device · sync refused: capacity']) {
    b.emit('q-free', text); expect(h.text).toBe(text); expect(h.error).toBe(true);
  }
  b.emit('q-free', 'Saved'); expect(h.text).toBe('Answers saved to your account.'); expect(h.error).toBe(false);
});

test('a successful field does not hide aggregate bridge pending/error state', async () => {
  const b = bridge(), h = setup(b.remote); await h.consumer.ready;
  h.consumer.save({ 'q-free': 'one', q: 'Keep' }); await settle();
  b.emit('q', 'Saved', 'Saved on this device · retrying');
  expect(h.text).toBe('Saved on this device · retrying');
  b.emit('', 'Saved'); expect(h.text).toBe('Answers saved to your account.');
});

test('status events alone can confirm queued fields without confirming the other pending field', async () => {
  const b = bridge(); delete b.remote.status;
  const h = setup(b.remote); await h.consumer.ready;
  h.consumer.save({ 'q-free': 'one', q: 'Keep' }); await settle();
  expect(h.text).toBe('Saving…');
  b.emit('q-free', 'Saved on this device · retrying'); b.emit('q', 'Saved');
  expect(h.text).toBe('Saved on this device · retrying');
  b.emit('q-free', 'Saved'); expect(h.text).toBe('Answers saved to your account.');
});

test('aggregate status-only events report queued quota holds and confirmation', async () => {
  const b = bridge(); delete b.remote.status;
  const h = setup(b.remote); await h.consumer.ready;
  h.consumer.save({ q: 'Keep' }); await settle();
  b.emit('', 'Saved on this device · syncs to your account at 12:00');
  expect(h.text).toBe('Saved on this device · syncs to your account at 12:00');
  b.emit('', 'Saved'); expect(h.text).toBe('Answers saved to your account.');
});

test('queued ack without status capabilities cannot claim server confirmation', async () => {
  const h = setup({ load: async () => ({}), save: async () => ({ ok: true, queued: true }) });
  await h.consumer.ready; h.consumer.save({ q: 'Keep' }); await settle();
  expect(h.text).toBe('Saving answers to your account…');
});

test('fast typing coalesces while enqueue is in flight and durably hands off the latest value', async () => {
  const b = bridge(); let release;
  const save = b.remote.save;
  b.remote.save = async (...args) => { if (!release) await new Promise(resolve => { release = resolve; }); return save(...args); };
  const h = setup(b.remote); await h.consumer.ready;
  h.consumer.save({ 'q-free': 'x' }); await settle();
  for (let i = 2; i <= 70; i++) h.consumer.save({ 'q-free': 'x'.repeat(i) });
  release(); await settle();
  expect(b.saves.map(([, value]) => value.length)).toEqual([1, 70]);
  expect(b.flushes).toBe(0); expect(h.text).toBe('Saving…');
});

for (const event of ['pagehide', 'online']) test(`${event} flush waits for an in-flight enqueue and includes its latest successor`, async () => {
  const b = bridge(); let release;
  const save = b.remote.save;
  b.remote.save = async (...args) => { if (!release) await new Promise(resolve => { release = resolve; }); return save(...args); };
  const h = setup(b.remote); await h.consumer.ready;
  h.consumer.save({ 'q-free': 'first' }); await settle(); h.consumer.save({ 'q-free': 'latest' });
  const lifecycle = h.events[event](); await settle(); expect(b.flushes).toBe(0);
  release(); await lifecycle;
  expect(b.saves.at(-1)).toEqual(['q-free', 'latest']); expect(b.flushes).toBe(1);
});

test('legacy confirmed acknowledgements, rejection and timer recovery retain their behavior', async () => {
  let accept = false; const saved = [];
  const h = setup({ load: async () => ({}), save: async (key, value) => { saved.push([key, value]); return { ok: accept }; } });
  await h.consumer.ready; h.consumer.save({ q: 'Keep' }); await settle();
  expect(h.text).toContain('unavailable'); expect(h.error).toBe(true);
  accept = true; for (const cb of [...h.timers.values()]) cb(); await settle();
  expect(saved).toEqual([['q', 'Keep'], ['q', 'Keep']]); expect(h.text).toBe('Answers saved to your account.');
});

test('bridge status read failure never becomes false saved', async () => {
  const b = bridge(); b.remote.status = () => { throw new Error('unavailable'); };
  const h = setup(b.remote); await h.consumer.ready;
  expect(h.text).toContain('status unavailable'); expect(h.error).toBe(true);
});

test('load failure stays visible during enqueue and successful retry preserves the local edit', async () => {
  let recover = false;
  const b = bridge(); b.remote.load = async () => { if (!recover) throw new Error('offline'); return { q: 'Old', other: 'Restored' }; };
  const h = setup(b.remote); await settle(); h.consumer.save({ q: 'New' }); await settle();
  expect(h.text).toBe('Account answers unavailable · retrying…');
  recover = true; for (const cb of [...h.timers.values()]) cb(); await h.consumer.ready;
  expect(b.saves).toEqual([['q', 'New']]); expect(h.changes).toEqual([['other', 'Restored']]);
});

test('device fallback and read/write errors stay explicit', async () => {
  const h = setup(null); h.consumer.save({ q: 'Keep' }); expect(h.text).toContain('this device only');
  const bad = setup(null, { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); } });
  expect(bad.text).toContain('Storage unavailable'); expect(bad.consumer.save({ q: 'Keep' })).toBe(false);
  expect(bad.error).toBe(true);
});

test('JSON answers from a separate realm retain objects, arrays and native text values', async () => {
  const b = bridge(), h = setup(b.remote); await h.consumer.ready;
  const answer = vm.runInContext(`({'q-notes':[{quote:'שלום',text:'A note'}], 'q-checks':{0:true}, 'q-free':'שלום English'})`, h.context);
  h.consumer.save(answer); await settle();
  expect(Object.fromEntries(b.saves)).toEqual(answer); expect(b.flushes).toBe(0);
});

for (const prefix of ['', '_notes:']) for (const aggregate of [false, true]) test(`early confirmation before queued ack: ${prefix || 'answers'} / ${aggregate ? 'aggregate' : 'field'}`, async () => {
  let notify; const releases = [];
  const remote = { load: async () => ({}), onStatus(cb) { notify = cb; },
    save(key) { notify(key, 'Saving…'); return new Promise(resolve => releases.push(() => resolve({ok:true,queued:true}))); } };
  const h = setup(remote, undefined, prefix); await h.consumer.ready;
  const field = aggregate ? '' : prefix + 'q';
  h.consumer.save({q:'first'}); await settle();
  notify(field, 'Saved'); releases.shift()(); await settle();
  expect(h.text).toBe('Answers saved to your account.');
  h.consumer.save({q:'second'}); await settle();
  expect(h.text).toBe('Saving…');
  h.consumer.save({q:'latest'}); notify(field, 'Saved'); releases.shift()(); await settle();
  expect(h.text).toBe('Saving…');
  notify(field, 'Saved'); releases.shift()(); await settle();
  expect(h.text).toBe('Answers saved to your account.');
});

test('aggregate status silently confirmed by another client refreshes and stops the pending watcher', async () => {
  const b = bridge(), h = setup(b.remote); await h.consumer.ready;
  h.consumer.save({'q-free':'cross-tab edit'}); await settle();
  expect(h.text).toBe('Saving…');
  b.remote.status = () => 'Saved';
  for (const cb of [...h.intervals.values()]) cb();
  expect(h.text).toBe('Answers saved to your account.');
  expect(h.intervals.size).toBe(0);
});
