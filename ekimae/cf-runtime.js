/* 記録の保存先を、Cloudflare 側のサーバー（/api）につなぐ。

claude.ai の保存機能（window.claude.use('db') / use('user')）と同じ形の窓口を作るので、
app.js の同期のコードは、claude.ai で動くときと同じものがそのまま使える。

ログイン済みで /api/me が返る場所（Cloudflare に置いたとき）でだけ有効になる。
GitHub Pages やローカルでは /api が無いので、何もしない（これまでどおり端末の中だけで動く）。
claude.ai の Artifact には最初から window.claude があるので、そのときも何もしない。

変わったことを知る方法は、一定の間隔で版数（/api/ver）を見に行くやり方。
画面が見えているあいだだけ動かし、見えなくなったら止めて、戻ってきたらすぐ確かめる。 */
(function () {
  'use strict';
  const POLL_MS = 20000;

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts || {}));
    if (!res.ok) {
      const e = new Error('api ' + res.status);
      e.code = res.status === 401 || res.status === 403 ? 'not_granted' : (res.status === 413 ? 'quota_exceeded' : 'api_error');
      throw e;
    }
    return res.json();
  }

  function dbPath(p) { return '/api/db?path=' + encodeURIComponent(p); }
  function collPath(p) { return '/api/db?coll=' + encodeURIComponent(p); }
  const write = (method, path, data) => api('/api/db', {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, data }),
  });

  const listeners = new Set(); // { run: () => Promise, scope: 'mine' | 'shared', path }
  let versions = { mine: -1, shared: -1 };
  let timer = null;

  function scopeFor(path) { return path.startsWith('shared/') ? 'shared' : 'mine'; }

  async function refresh(scope) {
    for (const l of [...listeners]) {
      if (!scope || l.scope === scope) { try { await l.run(); } catch (e) { /* 次の周期で取り直す */ } }
    }
  }

  async function poll() {
    try {
      const v = await api('/api/ver');
      const changed = [];
      if (v.mine !== versions.mine) changed.push('mine');
      if (v.shared !== versions.shared) changed.push('shared');
      versions = v;
      for (const s of changed) await refresh(s);
    } catch (e) { /* 電波が弱いときなど。次の周期にまかせる */ }
  }

  function startTimer() {
    if (timer || document.visibilityState === 'hidden') return;
    timer = setInterval(poll, POLL_MS);
  }
  function stopTimer() { clearInterval(timer); timer = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopTimer();
    else { poll(); startTimer(); }
  });

  function subscribe(path, run) {
    const l = { run, scope: scopeFor(path) };
    listeners.add(l);
    run().catch(() => {});
    startTimer();
    return () => { listeners.delete(l); };
  }

  function docRef(path) {
    return {
      collection: (name) => collRef(path + '/' + name),
      get: async () => {
        const r = await api(dbPath(path));
        return { exists: !!r.exists, data: () => r.data };
      },
      set: async (body) => { await write('PUT', path, body); await refresh(scopeFor(path)); },
      delete: async () => { await write('DELETE', path); await refresh(scopeFor(path)); },
      onSnapshot: (cb) => subscribe(path, async () => {
        const r = await api(dbPath(path));
        cb({ exists: !!r.exists, data: () => r.data });
      }),
    };
  }

  function collRef(prefix) {
    return {
      doc: (id) => docRef(prefix + '/' + id),
      onSnapshot: (cb) => subscribe(prefix, async () => {
        const r = await api(collPath(prefix));
        cb({ docs: r.docs.map((d) => ({ id: d.id, data: () => d.data })) });
      }),
    };
  }

  window.__cfReady = (async () => {
    // Artifact には最初から窓口がある。Pages やローカルでは /api が無い
    if (typeof window.claude !== 'undefined') return false;
    let me;
    try {
      const res = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      if (!res.ok || !/json/.test(res.headers.get('content-type') || '')) return false;
      me = await res.json();
    } catch (e) { return false; }
    if (!me || !me.uid) return false;
    const db = { doc: docRef };
    const user = { id: async () => me.uid, isOwner: () => true, canEdit: () => true };
    window.claude = { use: async (name) => (name === 'db' ? db : name === 'user' ? user : null) };
    return true;
  })();
})();
