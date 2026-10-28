/* In-browser mock of the claude.ai artifact runtime (db, user, sample) for local testing.
   Configure with window.__MOCK before app scripts run: { role: 'associate'|'manager', canEdit, name, email, seed: {path: data} } */
(function () {
  const cfg = Object.assign({ role: 'associate', canEdit: false, name: 'Taylor Associate', email: 'taylor@example.com', id: 'u_test000000000000000001', seed: {}, sampleDelay: 50 }, window.__MOCK || {});
  const store = new Map(); // path -> data
  for (const k of Object.keys(cfg.seed)) store.set(k, cfg.seed[k]);
  const listeners = []; // {kind:'doc'|'col', path, fn}
  const segs = p => p.split('/').filter(Boolean);
  const meta = { fromCache: false, hasPendingWrites: false };
  const snapOf = (path) => { const d = store.get(path); return { id: segs(path).pop(), exists: !!d, data: () => d ? JSON.parse(JSON.stringify(d)) : undefined, metadata: meta }; };
  function notify(path) {
    const ps = segs(path); const col = ps.slice(0, -1).join('/');
    for (const l of listeners.slice()) {
      if (l.kind === 'doc' && l.path === path) setTimeout(() => l.fn(snapOf(path)), 0);
      if (l.kind === 'col' && l.path === col) setTimeout(() => l.fn(querySnap(l.path, l.q)), 0);
    }
  }
  function docsIn(col) { const n = segs(col).length + 1; const out = []; for (const [p] of store) { const s = segs(p); if (s.length === n && p.startsWith(col + '/')) out.push(p); } return out.sort(); }
  function applyQuery(paths, q) {
    let docs = paths.map(snapOf);
    for (const w of (q.where || [])) docs = docs.filter(s => { const v = s.data()[w[0]]; switch (w[1]) { case '==': return v === w[2]; case '!=': return v !== w[2]; case '<': return v < w[2]; case '<=': return v <= w[2]; case '>': return v > w[2]; case '>=': return v >= w[2]; case 'in': return w[2].includes(v); case 'not-in': return !w[2].includes(v); case 'array-contains': return Array.isArray(v) && v.includes(w[2]); } return true; });
    if (q.orderBy) { const [f, dir] = q.orderBy; docs.sort((a, b) => { const x = a.data()[f], y = b.data()[f]; return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); }); }
    if (q.limit) docs = docs.slice(0, q.limit);
    return docs;
  }
  function querySnap(col, q) { const docs = applyQuery(docsIn(col), q || {}); return { docs, size: docs.length, empty: !docs.length, docChanges: () => docs.map((d, i) => ({ type: 'added', doc: d, oldIndex: -1, newIndex: i })), metadata: meta }; }
  function docRef(path) {
    if (segs(path).length % 2 !== 0) throw new TypeError('doc path must have an even number of segments: ' + path);
    return {
      id: segs(path).pop(), path,
      get: async () => snapOf(path),
      set: async (data) => { if (typeof data !== 'object' || Array.isArray(data)) throw { code: 'invalid_argument', message: 'body must be an object' }; store.set(path, JSON.parse(JSON.stringify(data))); notify(path); },
      update: async (data) => { if (!store.has(path)) throw { code: 'invalid_argument', message: 'update requires existing doc ' + path }; const cur = store.get(path); const merge = (a, b) => { for (const k of Object.keys(b)) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) merge(a[k], b[k]); else a[k] = JSON.parse(JSON.stringify(b[k])); } }; merge(cur, data); store.set(path, cur); notify(path); },
      delete: async () => { store.delete(path); notify(path); },
      acquire: async () => ({ acquired: true }),
      onSnapshot: (fn) => { const l = { kind: 'doc', path, fn }; listeners.push(l); setTimeout(() => fn(snapOf(path)), 0); return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); }; },
      collection: (sub) => colRef(path + '/' + sub),
    };
  }
  function colRef(path, q) {
    if (segs(path).length % 2 !== 1) throw new TypeError('collection path must have an odd number of segments: ' + path);
    q = q || {};
    const self = {
      path,
      doc: (id) => docRef(path + '/' + (id || ('m' + Math.random().toString(36).slice(2, 10)))),
      add: async (data) => { const r = self.doc(); await r.set(data); return r; },
      where: (f, op, v) => colRef(path, Object.assign({}, q, { where: (q.where || []).concat([[f, op, v]]) })),
      orderBy: (f, dir) => colRef(path, Object.assign({}, q, { orderBy: [f, dir || 'asc'] })),
      limit: (n) => colRef(path, Object.assign({}, q, { limit: n })),
      get: async () => querySnap(path, q),
      onSnapshot: (fn) => { const l = { kind: 'col', path, fn, q }; listeners.push(l); setTimeout(() => fn(querySnap(path, q)), 0); return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); }; },
    };
    return self;
  }
  const db = { doc: docRef, collection: p => colRef(p) };
  const user = {
    isOwner: async () => !!cfg.isOwner, canEdit: async () => !!cfg.canEdit, can: async (n) => n === 'data.write' ? true : null,
    me: async () => ({ id: cfg.id, name: cfg.name, email: cfg.email, avatarUrl: '', color: '#888', isOwner: !!cfg.isOwner, canEdit: !!cfg.canEdit }),
    id: async () => cfg.id, name: async () => cfg.name, email: async () => cfg.email, avatarUrl: async () => null,
    profiles: async (ids) => { const o = {}; for (const i of [].concat(ids)) o[i] = { id: i, name: i === cfg.id ? cfg.name : 'Someone', avatarUrl: '', color: '#888', email: null, isMe: i === cfg.id, guest: false }; return o; },
    search: async () => [],
  };
  const replies = ['Yeah g\'day, who\'s this?', 'Oh right. Look, we\'re not really thinking about selling at the moment.', 'How did you get my number?', 'Hmm. I suppose a market report wouldn\'t hurt. What\'s involved?', 'Alright, Thursday at 4 works for me. See you then.\nEND OF CALL'];
  let n = 0;
  const sample = async (input, opts) => {
    const text = Array.isArray(input) ? replies[Math.min(n++, replies.length - 1)] : 'OK';
    await new Promise(r => setTimeout(r, cfg.sampleDelay));
    if (opts && opts.signal && opts.signal.aborted) throw { code: 'cancelled', message: 'aborted' };
    if (opts && opts.onText) opts.onText({ text, delta: text });
    return { text, truncated: false, modelTierApplied: (opts && opts.modelTier) || 'default' };
  };
  sample.json = async () => { await new Promise(r => setTimeout(r, cfg.sampleDelay)); return { scores: [{ criterion: 'Introduced self and office', score: 2, note: 'Clear.' }, { criterion: 'Gave a courtesy reason', score: 1, note: 'A bit rushed.' }, { criterion: 'Offered two times', score: 2, note: 'Good close.' }], total: 5, max: 6, strengths: ['Warm opening', 'Closed with two times'], improve: ['Slow down on the reason for the call'], oneThing: 'Pause after you give the reason and let them answer.', wordForWord: 'Does 2pm or 4pm suit?' }; };
  sample.limits = async () => ({ maxPromptBytes: 262144 });
  window.claude = { use: async (name) => ({ db, user, sample })[name] || null };
  window.__MOCK_STORE = store;
})();
