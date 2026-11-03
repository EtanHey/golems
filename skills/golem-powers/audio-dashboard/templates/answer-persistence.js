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
    const owns = field => prefix ? field.startsWith(prefix) : !field.startsWith('_notes:');
    const id = document.querySelector('meta[name=dashboard-id]')?.content;
    if (id) key = 'dbx:' + id + (prefix ? '.notes' : '');
    const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const clone = value => JSON.parse(JSON.stringify(value));
    let values = {}, snapshot = {}, loading = account, problem = '', loadProblem = '';
    const pending = new Map(), sending = new Set(), touched = new Set();
    const report = () => status(problem || loadProblem || (loading ? 'Loading account answers…' : pending.size ? 'Saving answers to your account…' : account ? 'Answers saved to your account.' : 'Answers saved on this device only.'), Boolean(problem || loadProblem));
    if (!account) {
      try { values = record(JSON.parse(localStorage.getItem(key) || '{}')); }
      catch { problem = 'Storage unavailable · use Copy answers'; }
    }
    snapshot = clone(values);
    function apply(field, value) {
      if (value == null) { delete values[field]; delete snapshot[field]; }
      else { values[field] = clone(value); snapshot[field] = clone(value); }
      change(field, value);
    }
    async function send(field) {
      if (loading || sending.has(field) || !pending.has(field)) return;
      const item = pending.get(field);
      sending.add(field);
      let ok = false;
      try {
        const result = await remote.save(prefix + field, item.value);
        ok = result?.ok === true;
        if (!ok) problem = 'Account saving unavailable · keep this page open; use Copy answers';
        else if (pending.get(field) === item) { pending.delete(field); problem = ''; }
      } catch { problem = 'Account saving unavailable · keep this page open; use Copy answers'; }
      finally { sending.delete(field); report(); }
      if (ok && pending.has(field)) send(field);
    }
    function flush() {
      for (const field of pending.keys()) send(field);
      try { Promise.resolve(remote?.flush?.()).catch(() => {}); } catch {}
    }
    const ready = account ? Promise.resolve().then(async () => {
      try {
        const loaded = record(await remote.load());
        for (const [remoteField, value] of Object.entries(loaded)) {
          if (!owns(remoteField)) continue;
          const field = remoteField.slice(prefix.length);
          if (!touched.has(field)) apply(field, value);
        }
        loading = false; problem = ''; flush();
      } catch { loading = false; loadProblem = 'Account answers unavailable · reload to retry; use Copy answers'; flush(); }
      report();
    }) : Promise.resolve();
    if (account) {
      listen(remote, 'onRemoteChange', (remoteField, value) => {
        if (!owns(remoteField)) return;
        const field = remoteField.slice(prefix.length);
        if (pending.has(field)) return;
        touched.add(field); apply(field, value);
      });
      listen(remote, 'onStatus', (field, text) => { if (!pending.size && !loading && !loadProblem && text) status('Account: ' + text, false); });
    }
    win.addEventListener('pagehide', flush);
    win.addEventListener('online', flush);
    report();
    return {
      values, ready,
      save(next) {
        if (!account) {
          try { localStorage.setItem(key, JSON.stringify(next)); values = clone(next); snapshot = clone(next); problem = ''; report(); return true; }
          catch { problem = 'Storage unavailable · use Copy answers'; report(); return false; }
        }
        for (const field of new Set([...Object.keys(snapshot), ...Object.keys(next)])) {
          if (JSON.stringify(snapshot[field]) === JSON.stringify(next[field])) continue;
          touched.add(field); pending.set(field, { value: clone(next[field] ?? null) });
        }
        values = clone(next); snapshot = clone(next); report(); flush(); return true;
      },
    };
  };
})();
