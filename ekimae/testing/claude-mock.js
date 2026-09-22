/* claude.ai の Artifact ランタイムの、ごく小さな代役。
   手元で「合言葉」「仲間との共有」を確かめるためだけのもので、
   アプリ本体には含めない（index.html からは読み込まない）。
   共有領域は localStorage に置くので、同じブラウザの中でだけ共有される。 */
(function () {
  'use strict';
  const STORE = '__mock_db__';
  const UID = '__mock_uid__';

  const read = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { return {}; } };
  const write = (o) => localStorage.setItem(STORE, JSON.stringify(o));

  const listeners = [];
  function fire() { for (const fn of listeners.slice()) { try { fn(); } catch (e) {} } }

  function docRef(path) {
    return {
      collection: (name) => collRef(path + '/' + name),
      get: async () => {
        const d = read()[path];
        return { exists: d !== undefined, data: () => d };
      },
      set: async (body) => { const all = read(); all[path] = body; write(all); fire(); },
      delete: async () => { const all = read(); delete all[path]; write(all); fire(); },
      onSnapshot: (cb) => {
        const run = () => { const d = read()[path]; cb({ exists: d !== undefined, data: () => d }); };
        listeners.push(run);
        setTimeout(run, 0);
        return () => { const i = listeners.indexOf(run); if (i >= 0) listeners.splice(i, 1); };
      },
    };
  }

  function collRef(prefix) {
    return {
      doc: (id) => docRef(prefix + '/' + id),
      onSnapshot: (cb) => {
        const run = () => {
          const all = read();
          const docs = Object.keys(all)
            .filter((k) => k.startsWith(prefix + '/') && k.slice(prefix.length + 1).indexOf('/') < 0)
            .map((k) => ({ id: k.slice(prefix.length + 1), data: () => all[k] }));
          cb({ docs: docs });
        };
        listeners.push(run);
        setTimeout(run, 0);
        return () => { const i = listeners.indexOf(run); if (i >= 0) listeners.splice(i, 1); };
      },
    };
  }

  const db = { doc: docRef };
  const user = {
    id: async () => {
      let v = localStorage.getItem(UID);
      if (!v) { v = 'mock-' + Math.random().toString(16).slice(2, 8); localStorage.setItem(UID, v); }
      return v;
    },
    isOwner: () => true,
    canEdit: () => true,
  };

  window.claude = {
    use: async (name) => (name === 'db' ? db : name === 'user' ? user : null),
  };
})();
