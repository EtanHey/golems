(function installAnswerPersistence() {
  const win = document.defaultView;
  if (win.AudioDashboardAnswers) return;
  const listeners = new WeakMap();
  function listen(remote, method, callback) {
    if (typeof remote[method] !== 'function') return;
    if (!listeners.has(remote)) listeners.set(remote, {});
    const hub = listeners.get(remote);
    if (!hub[method]) { hub[method] = []; remote[method]((...args) => hub[method].forEach(fn => fn(...args))); }
    hub[method].push(callback);
  }
  win.AudioDashboardAnswers = function ({ key, prefix = '', status, change }) {
    let remote;
    try { remote = win.__answerStore ?? win.parent?.__answerStore; } catch {}
    const account = remote != null;
    const owns = field => field !== '_prefs' && (prefix ? field.startsWith(prefix) : !field.startsWith('_notes:'));
    const id = document.querySelector('meta[name=dashboard-id]')?.content;
    key ||= 'dbx:' + id + (prefix ? '.notes' : '');
    const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const clone = value => JSON.parse(JSON.stringify(value));
    let values = {}, snapshot = {}, loading = account, localError = '', loadError = '';
    const pending = new Map(), sending = new Set(), touched = new Set(), failed = new Set(), retries = new Map();
    const report = () => status(localError || loadError || (failed.size ? 'Account saving unavailable · retrying…' : loading ? 'Loading account answers…' : pending.size ? 'Saving answers to your account…' : account ? 'Answers saved to your account.' : 'Answers saved on this device only.'), Boolean(localError || loadError || failed.size || !account));
    if (!account) {
      try { values = record(JSON.parse(localStorage.getItem(key) || '{}')); delete values._prefs; }
      catch { localError = 'Storage unavailable · use Copy answers'; }
    }
    snapshot = clone(values);
    function apply(field, value) {
      if (value == null) { delete values[field]; delete snapshot[field]; }
      else { values[field] = clone(value); snapshot[field] = clone(value); }
      change(field, value);
    }
    async function send(field) {
      if (sending.has(field) || !pending.has(field)) return;
      win.clearTimeout(retries.get(field)); retries.delete(field);
      const item = pending.get(field);
      sending.add(field);
      let ok = false;
      try {
        const result = await remote.save(prefix + field, item.value);
        ok = result?.ok === true;
      } catch {}
      sending.delete(field);
      if (ok) { failed.delete(field); if (pending.get(field) === item) pending.delete(field); }
      else { failed.add(field); retries.set(field, win.setTimeout(() => send(field), 3000)); }
      report();
      if (ok && pending.has(field)) send(field);
    }
    function flush() {
      for (const field of pending.keys()) send(field);
      try { Promise.resolve(remote?.flush?.()).catch(() => {}); } catch {}
    }
    const ready = account ? Promise.resolve().then(async () => {
      for (;;) {
        let loaded;
        try { loaded = record(await remote.load()); }
        catch {
          loadError = 'Account answers unavailable · retrying…'; report();
          await new Promise(resolve => win.setTimeout(resolve, 3000));
          continue;
        }
        for (const [remoteField, value] of Object.entries(loaded)) {
          if (!owns(remoteField)) continue;
          const field = remoteField.slice(prefix.length);
          if (!touched.has(field)) apply(field, value);
        }
        loading = false; loadError = ''; report(); flush(); return;
      }
    }) : Promise.resolve();
    if (account) {
      listen(remote, 'onRemoteChange', (remoteField, value) => {
        if (!owns(remoteField)) return;
        const field = remoteField.slice(prefix.length);
        if (pending.has(field)) return;
        touched.add(field); apply(field, value);
      });
      listen(remote, 'onStatus', report);
    }
    win.addEventListener('pagehide', flush);
    win.addEventListener('online', flush);
    report();
    return {
      values, ready,
      save(next) {
        if (!account) {
          try {
            const raw = localStorage.getItem(key);
            let device = {}; try { device = record(JSON.parse(raw || '{}')); } catch {}
            const prefs = device._prefs;
            localStorage.setItem(key, JSON.stringify({ ...next, ...(prefs === undefined ? {} : { _prefs: prefs }) }));
            values = clone(next); snapshot = clone(next); localError = ''; report(); return true;
          } catch { localError = 'Storage unavailable · use Copy answers'; report(); return false; }
        }
        for (const field of new Set([...Object.keys(snapshot), ...Object.keys(next)])) {
          if (!owns(prefix + field) || JSON.stringify(snapshot[field]) === JSON.stringify(next[field])) continue;
          touched.add(field); pending.set(field, { value: clone(next[field] ?? null) });
        }
        values = clone(next); snapshot = clone(next); report(); flush(); return true;
      },
    };
  };
})();
