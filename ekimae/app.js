/* 梅田地下メシ — 梅田の地下の飲食店マップ (vanilla JS / 静的ホスティング前提) */
'use strict';

const NS = 'ekimae.v1';
const KEY = {
  user: NS + '.user',
  custom: NS + '.custom',
  deleted: NS + '.deleted',
  ui: NS + '.ui',
  me: NS + '.me',       // 自分が誰か（名前と、合言葉を通ったかどうか）
};

/* 店のある場所。もとは大阪駅前第1〜4ビルだけだったので数字1つで足りていたが、
   梅田のほかの地下にも広げたので、数字と文字列が混ざる形にしてある。

   1〜4 を数字のままにしているのは、店のIDが「場所＋フロア＋店名のhash」で
   決まるため。ここを文字列に変えると既存357件のIDが全部変わり、
   お気に入り・メモ・訪問履歴が全部外れてしまう。 */
const VENUES = [
  { id: 1, short: '第1ビル', name: '大阪駅前第1ビル', area: '駅前ビル', search: '大阪駅前第1ビル' },
  { id: 2, short: '第2ビル', name: '大阪駅前第2ビル', area: '駅前ビル', search: '大阪駅前第2ビル' },
  { id: 3, short: '第3ビル', name: '大阪駅前第3ビル', area: '駅前ビル', search: '大阪駅前第3ビル' },
  { id: 4, short: '第4ビル', name: '大阪駅前第4ビル', area: '駅前ビル', search: '大阪駅前第4ビル' },
  { id: 'kitte', short: 'うめよこ', name: 'KITTE大阪 うめよこ', area: 'うめきた',
    search: 'KITTE大阪 うめよこ', site: 'https://osaka.jp-kitte.jp/shop/gourmet/shoplist04.jsp' },
  { id: 'bar03', short: 'バルチカ03', name: 'イノゲート大阪 バルチカ03', area: '大阪駅',
    search: 'バルチカ03 イノゲート大阪', site: 'https://barchica03.com/' },
  { id: 'lucua', short: 'バルチカ', name: 'ルクア大阪 バルチカ', area: 'ルクア',
    search: 'ルクア大阪 バルチカ', site: 'https://www.lucua.jp/floormap/b2.html' },
];

const VENUE_BY_ID = new Map(VENUES.map((v) => [String(v.id), v]));

function venueOf(id) { return VENUE_BY_ID.get(String(id)) || null; }
function venueShort(id) { const v = venueOf(id); return v ? v.short : String(id); }
function venueName(id) { const v = venueOf(id); return v ? v.name : String(id); }
function venueIndex(id) {
  const i = VENUES.findIndex((v) => String(v.id) === String(id));
  return i < 0 ? 99 : i;
}

// 保存されている値を、定義済みの場所キーに揃える（数字は数字のまま）
function venueKey(raw) {
  const v = venueOf(raw);
  if (v) return v.id;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
const FLOOR_ORDER = ['B2', 'B1', '1F', '2F', '3F', '4F', '5F'];

const CATEGORIES = [
  '居酒屋', '立ち飲み', 'バー', '串カツ', '焼鳥', '焼肉・ホルモン', '寿司', '海鮮',
  '中華', '洋食', '和食', 'ラーメン', 'そば・うどん', 'お好み焼き・粉もん',
  'カレー', '定食', '喫茶', 'スイーツ', 'その他',
];

const TAG_PRESETS = [
  '立ち飲み', '座り飲み', 'カウンターのみ', '個室あり', '一人OK',
  'ランチあり', '昼飲み', '深夜営業', '行列',
  '現金のみ', 'カード可', '予約可', 'テイクアウト',
  '喫煙可', '分煙', '禁煙',
];

const MISC_FILTERS = [
  { id: 'fav', label: '★お気に入り' },
  { id: 'open', label: '営業中' },
  { id: 'memo', label: 'メモあり' },
  { id: 'visited', label: '訪問済み' },
  { id: 'unvisited', label: '未訪問' },
  { id: 'crowd', label: '仲間の記録あり' },
  { id: 'r35', label: '星3.5+' },
  { id: 'r40', label: '星4.0+' },
  { id: 'unverified', label: '未確認' },
];

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

/* ---------------- state ---------------- */

let base = { floors: {}, stores: [] };
let user = readJSON(KEY.user, {});
let custom = readJSON(KEY.custom, []);
let deleted = readJSON(KEY.deleted, []);

// みんなの記録。mates[店のID][メンバーID] = { rating, visits, t }
// 自分のぶんは user[] に入っているので、ここには入れない。
let mates = {};
// メンバーID → 表示名
let memberNames = {};
// 自分が誰か。id はメンバーID、name は表示名、ok は通した合言葉の指紋
let me = readJSON(KEY.me, null);
const UI_DEFAULTS = {
  view: 'list', sort: 'default', q: '',
  buildings: [], floors: [], cats: [], tags: [], misc: [],
  here: null,
};

// 保存されている値をそのまま信じると、型が違うだけで画面が真っ白になる。
// 既定値と同じ型のものだけ受け取る
function sanitizeUI(saved) {
  const out = Object.assign({}, UI_DEFAULTS);
  if (!saved || typeof saved !== 'object') return out;
  for (const k in UI_DEFAULTS) {
    const def = UI_DEFAULTS[k], v = saved[k];
    if (Array.isArray(def)) {
      if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string');
    } else if (typeof def === 'string') {
      if (typeof v === 'string') out[k] = v;
    } else if (typeof def === 'boolean') {
      if (typeof v === 'boolean') out[k] = v;
    } else if (k === 'here') {
      if (v && typeof v === 'object' && venueOf(v.building) && typeof v.floor === 'string') {
        out.here = { building: venueKey(v.building), floor: v.floor };
      }
    }
  }
  return out;
}

let ui = sanitizeUI(readJSON(KEY.ui, {}));

let stores = [];

// 「マップで見る」で飛んだ直後だけ、そのマスを光らせてスクロールする。
// 保存はしない。次に開いたときまで光り続けると邪魔なため。
let focusId = null;

function readJSON(k, fallback) {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {
    toast('保存に失敗しました（容量超過？）');
  }
}

const saveUser = () => { writeJSON(KEY.user, user); cloudPush(); };
const saveCustom = () => { writeJSON(KEY.custom, custom); cloudPush(); };
const saveDeleted = () => { writeJSON(KEY.deleted, deleted); cloudPush(); };
const saveUI = () => writeJSON(KEY.ui, ui);  // 画面の状態は端末ごと。同期しない

// その店に記録を残した人を、自分も含めて並べて返す
function crowd(storeId) {
  const out = [];
  const mine = user[storeId];
  if (mine && (mine.rating || (mine.visits && mine.visits.length))) {
    out.push({ by: myId() || 'me', me: true, rating: mine.rating || 0,
      visits: (mine.visits || []).length });
  }
  const others = mates[storeId] || {};
  for (const id in others) {
    const o = others[id];
    if (!o.rating && !(o.visits && o.visits.length)) continue;
    out.push({ by: id, me: false, rating: o.rating || 0, visits: (o.visits || []).length });
  }
  return out;
}

// みんなの星の平均。1人も付けていなければ null
function crowdRating(storeId) {
  const rs = crowd(storeId).filter((c) => c.rating).map((c) => c.rating);
  if (!rs.length) return null;
  return rs.reduce((a, b) => a + b, 0) / rs.length;
}

function u(id) {
  if (!user[id]) user[id] = { fav: false, memo: '', tags: [], rating: 0, visits: [] };
  const o = user[id];
  if (!Array.isArray(o.tags)) o.tags = [];
  if (!Array.isArray(o.visits)) o.visits = [];
  return o;
}

/* ---------------- フロア平面図（端末内に保存） ----------------

公式の平面図は、区画番号と実際の位置を結びつける唯一の資料。
ただしアプリに同梱すると公式サイトの図を再配布することになるので、
利用者が自分の端末に取り込む方式にしている。保存先は IndexedDB。
（画像は localStorage には大きすぎる）
------------------------------------------------------------------- */

const DB_NAME = 'ekimae';
const DB_STORE = 'plans';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!self.indexedDB) { reject(new Error('この端末では画像を保存できません')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('保存領域を開けませんでした'));
    req.onblocked = () => reject(new Error('保存領域が使用中です'));
  });
  // 一度失敗したまま覚えておくと、以後ずっと同じ失敗を返して再試行できない
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function planKey(building, floor) { return 'b' + building + '-' + floor; }

async function planGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

async function planPut(key, dataUrl) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(dataUrl, key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

async function planDel(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// アプリに同梱してある公式の平面図。個人用なので手元に置いてある。
// 取り込み済みの画像があればそちらを優先する（差し替えできるように）。
const BUNDLED_PLANS = ['b1-B1', 'b1-B2', 'b2-B1', 'b2-B2', 'b3-B1', 'b3-B2', 'b4-B1', 'b4-B2',
  'bkitte-B1', 'bbar03-2F', 'bbar03-3F', 'bbar03-4F', 'bbar03-5F', 'blucua-B2'];

function bundledPlanUrl(key) {
  return BUNDLED_PLANS.includes(key) ? 'plans/' + key + '.jpg' : null;
}

// 取り込み済み → 同梱 の順に探す。IndexedDB が使えない端末でも
// 同梱ぶんだけは見られるように、失敗しても投げない。
async function planResolve(key) {
  let saved = null;
  let broken = null;
  try {
    saved = await planGet(key);
  } catch (e) {
    broken = e;
  }
  if (saved) return { url: saved, kind: 'saved', error: null };
  const b = bundledPlanUrl(key);
  if (b) return { url: b, kind: 'bundled', error: null };
  return { url: null, kind: null, error: broken };
}

async function planKeys() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAllKeys();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

// 端末の保存量を抑えるため、長辺 1600px / JPEG 品質 0.82 に落とす。
// 区画番号が読める程度は十分に残る。
function shrinkImage(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('ファイルを読めませんでした'));
    // onload の中で投げても Promise には届かないので、自分で reject する。
    // ここを握りつぶすと「取り込んでいます…」のまま永久に止まる
    fr.onabort = () => reject(new Error('取り込みが中断されました'));
    fr.onload = () => {
      try {
        const img = new Image();
        img.onerror = () => reject(new Error('画像として読めませんでした'));
        img.onload = () => {
          try {
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            const ctx = cv.getContext('2d');
            if (!ctx) throw new Error('この端末では画像を加工できません');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(cv.toDataURL('image/jpeg', 0.82));
          } catch (e) { reject(e); }
        };
        img.src = fr.result;
      } catch (e) { reject(e); }
    };
    // 端末によっては onload も onerror も来ないことがある
    setTimeout(() => reject(new Error('時間内に読み込めませんでした')), 20000);
    fr.readAsDataURL(file);
  });
}

/* ---------------- 端末間の同期 ----------------

claude.ai の Artifact として開いたときだけ、記録をクラウドに置いて
PC とスマホで同じものを見られるようにする。ログインは claude.ai の
ログインをそのまま使うので、新しい ID もパスワードも作らない。

保存先は「自分だけが読み書きできる領域」で、他の人からは見えない。
GitHub Pages やローカルで開いたときは claude.use が無いので、
これまでどおり端末の中だけで動く（何も壊れない）。

店ごとに1件ずつ持つので、片方の端末で別の店を触っても取り合いにならない。
同じ店を同時に触ったときは、あとから書いたほうが残る。
--------------------------------------------------------------- */

const cloud = {
  on: false,        // 同期が生きているか
  shared: false,    // 友だちとの共有が生きているか
  status: '',       // メニューに出す文言
  notes: null,      // 店ごとの自分の記録（自分の端末だけ）
  meta: null,       // 消した店の一覧（みんなで共有）
  edits: null,      // 店ごとの追加・編集（みんなで共有）
  reviews: null,    // 店ごと・人ごとの星と訪問（みんなで共有）
  members: null,    // メンバーの表示名（みんなで共有）
  config: null,     // 合言葉の指紋（みんなで共有）
  shadowUser: {},   // 送信済みの中身（差分だけ送るため）
  shadowCustom: {},
  shadowMine: {},
  applying: false,  // 受信を反映している最中は送り返さない
  timer: null,
  subs: [],
};

/* ---------------- 自分が誰か ----------------

友だちと共有すると「誰が行ったか」「誰の星か」が要る。claude.ai の
ログインは、招待の仕方によっては相手が「不在」として見えることがあるので、
それだけには頼らない。端末の中に自分のメンバーIDと表示名を持ち、
それを記録に添える。claude.ai 側の ID が取れるときはそれを種に使うので、
同じ人が PC とスマホで開いても1人として扱われる。
--------------------------------------------------------------- */

function randomId() {
  const a = new Uint8Array(8);
  (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a)
    : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256hex(text) {
  const subtle = (window.crypto || {}).subtle;
  if (!subtle) return 'plain:' + text;  // 古い端末では素通し（のれん程度の役目なので）
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function saveMe() { writeJSON(KEY.me, me); }

function myId() { return (me && me.id) || ''; }

function memberLabel(id) {
  if (!id) return '';
  if (id === myId()) return (me && me.name) || '自分';
  return memberNames[id] || '（名前未設定）';
}

function cloudPush() {
  if (!cloud.on || cloud.applying) return;
  clearTimeout(cloud.timer);
  cloud.timer = setTimeout(() => { pushChanges().catch(() => {}); }, 700);
}

function stripMeta(o) {
  const c = Object.assign({}, o);
  delete c.t;
  return c;
}

// 共有に出すのは「星」と「訪問」だけ。お気に入り・メモ・自分タグは
// 自分の備忘なので、友だちには見せず自分の端末間だけで同期する。
function sharePart(o) {
  return {
    rating: Number(o.rating) || 0,
    visits: Array.isArray(o.visits) ? o.visits.slice() : [],
  };
}

function hasShare(p) { return !!(p.rating || p.visits.length); }

async function pushChanges() {
  if (!cloud.on) return;
  const now = Date.now();

  for (const id in user) {
    const body = JSON.stringify(stripMeta(user[id]));
    if (cloud.shadowUser[id] !== body) {
      cloud.shadowUser[id] = body;
      user[id].t = now;
      try { await cloud.notes.doc(id).set(Object.assign({}, user[id])); } catch (e) { cloudTrouble(e); return; }
    }
    // 星と訪問は、みんなが読める場所にも置く
    if (cloud.shared && myId()) {
      const part = sharePart(user[id]);
      const key = id + '~' + myId();
      const mine = JSON.stringify(part);
      if (cloud.shadowMine[key] !== mine) {
        cloud.shadowMine[key] = mine;
        try {
          if (hasShare(part)) {
            await cloud.reviews.doc(key).set(Object.assign({ storeId: id, by: myId(), t: now }, part));
          } else {
            await cloud.reviews.doc(key).delete();
          }
        } catch (e) { cloudTrouble(e); return; }
      }
    }
  }

  const seen = new Set();
  for (const c of custom) {
    if (!c || !c.id) continue;
    seen.add(c.id);
    const body = JSON.stringify(stripMeta(c));
    if (cloud.shadowCustom[c.id] === body) continue;
    cloud.shadowCustom[c.id] = body;
    c.t = now;
    try { await cloud.edits.doc(c.id).set(Object.assign({}, c)); } catch (e) { cloudTrouble(e); return; }
  }
  // 端末側で消えた編集は、クラウドからも消す
  for (const id in cloud.shadowCustom) {
    if (seen.has(id)) continue;
    delete cloud.shadowCustom[id];
    try { await cloud.edits.doc(id).delete(); } catch (e) { /* 消せなくても致命ではない */ }
  }

  try { await cloud.meta.set({ deleted: deleted, t: now }); } catch (e) { cloudTrouble(e); }
}

function cloudTrouble(e) {
  const code = e && e.code;
  if (code === 'revoked' || code === 'not_granted') {
    cloud.on = false;
    cloud.status = '同期は止まっています（権限がありません）';
  } else if (code === 'quota_exceeded') {
    cloud.status = '同期先がいっぱいです';
  } else {
    cloud.status = '同期でつまずきました（' + (e && e.message || '不明') + '）';
  }
}

// 受け取った側が新しければ取り込む。取り込み中は送り返さない
function applyRemote(fn) {
  cloud.applying = true;
  try { fn(); } finally { cloud.applying = false; }
}

/* ---------------- 入口（合言葉） ----------------

友だちに URL を渡して使うので、リンクを拾っただけの人が
そのまま入ってこないように、入口で合言葉を聞く。

これは鍵ではなく「のれん」。ページの中身は誰でも読めるので、
本当の保護は Artifact 側の共有設定（誰に開くか）のほう。
合言葉は平文では持たず、指紋（SHA-256）だけを共有領域に置く。
一度通れば端末に覚えるので、次からは聞かない。
--------------------------------------------------------------- */

let gateEl = null;

function showGate(nodes) {
  if (!gateEl) {
    gateEl = el('div', { class: 'gate' }, [el('div', { class: 'gate-card' })]);
    document.body.appendChild(gateEl);
  }
  document.documentElement.classList.add('is-gated');
  const card = gateEl.querySelector('.gate-card');
  card.textContent = '';
  for (const n of [].concat(nodes)) if (n) card.appendChild(n);
  gateEl.hidden = false;
}

function hideGate() {
  document.documentElement.classList.remove('is-gated');
  if (gateEl) gateEl.hidden = true;
}

function gateWaiting() {
  showGate([
    el('h2', { class: 'gate-title', text: '梅田地下メシ' }),
    el('p', { class: 'gate-note', text: '確認しています…' }),
  ]);
}

// 合言葉を決める／聞く画面を出して、通ったら true を返す
function askGate(opts) {
  return new Promise((resolve) => {
    const pass = el('input', {
      type: 'password', class: 'gate-input', autocomplete: 'current-password',
      placeholder: '合言葉',
    });
    const name = el('input', {
      type: 'text', class: 'gate-input', maxlength: '20',
      placeholder: 'ニックネーム（みんなに見えます）',
      value: (me && me.name) || '',
    });
    const err = el('p', { class: 'gate-err', hidden: 'hidden' });
    const go = el('button', {
      class: 'btn btn--primary', type: 'submit',
      text: opts.setup ? 'この合言葉にする' : '入る',
    });

    const form = el('form', { class: 'gate-form' }, [
      pass, opts.needName ? name : null, err, go,
    ]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = pass.value.trim();
      if (v.length < 4) {
        err.hidden = false;
        err.textContent = '合言葉は4文字以上にしてください';
        return;
      }
      go.disabled = true;
      const hash = await sha256hex(v);
      if (!opts.setup && hash !== opts.hash) {
        go.disabled = false;
        err.hidden = false;
        err.textContent = '合言葉が違います';
        pass.value = '';
        pass.focus();
        return;
      }
      resolve({ hash: hash, name: name.value.trim() });
    });

    showGate([
      el('h2', { class: 'gate-title', text: '梅田地下メシ' }),
      el('p', { class: 'gate-note', text: opts.setup
        ? 'まだ合言葉が決まっていません。仲間に伝える合言葉を決めてください。'
        : '合言葉を入れてください。一度入れたら、この端末では次から聞きません。' }),
      form,
    ]);
    setTimeout(() => pass.focus(), 50);
  });
}

// 共有領域が開けたときだけ呼ばれる。通らないかぎり先へ進まない
async function runGate(seedId) {
  let conf = null;
  try {
    const snap = await cloud.config.get();
    conf = snap.exists ? snap.data() : null;
  } catch (e) {
    // 共有領域が読めない端末。自分の端末の中だけで使う
    cloud.shared = false;
    cloud.status = 'この画面では仲間との共有はできません（記録はこの端末に残ります）';
    hideGate();
    return false;
  }

  const hash = conf && typeof conf.passHash === 'string' ? conf.passHash : '';
  if (!me || !me.id) me = { id: seedId || randomId(), name: '', ok: '' };
  if (!me.id) me.id = seedId || randomId();

  if (hash && me.ok === hash && me.name) { saveMe(); return true; }

  const got = await askGate({
    setup: !hash,
    hash: hash,
    needName: !me.name,
  });

  me.ok = got.hash;
  if (got.name) me.name = got.name;
  if (!me.name) me.name = 'ユーザー' + (Object.keys(memberNames).length + 1);
  saveMe();

  if (!hash) {
    try { await cloud.config.set({ passHash: got.hash, t: Date.now() }); }
    catch (e) { toast('合言葉を共有できませんでした（この端末には覚えました）'); }
  }
  hideGate();
  return true;
}

async function publishMe() {
  if (!cloud.shared || !myId() || !me.name) return;
  try { await cloud.members.doc(myId()).set({ name: me.name, t: Date.now() }); }
  catch (e) { /* 名前が出ないだけなので致命ではない */ }
}

async function initCloud() {
  // どこで転んでも、のれんが上がったままにならないようにする。
  // 上がったままだと「真っ白で何も出ない」という一番困る状態になる。
  // 合言葉の入力を出している最中だけは、下ろさない。
  const dropCurtain = () => {
    if (gateEl && gateEl.querySelector('.gate-form')) return;
    hideGate();
  };
  const safety = setTimeout(dropCurtain, 15000);
  try {
    await connectCloud();
  } finally {
    clearTimeout(safety);
    dropCurtain();
  }
}

async function connectCloud() {
  if (typeof window.claude === 'undefined' || !window.claude.use) { hideGate(); return; }
  let usr = null, db = null;
  try {
    usr = await window.claude.use('user');
    db = await window.claude.use('db');
  } catch (e) { return; }
  if (!usr || !db) return;

  let uid = null;
  try { uid = await usr.id(); } catch (e) { uid = null; }
  if (!uid) { cloud.status = 'この画面では同期できません'; return; }

  const home = 'data/users/' + uid;
  try {
    // 自分だけの領域。お気に入り・メモ・自分タグはここ止まり
    cloud.notes = db.doc(home + '/notes').collection('s');
  } catch (e) { cloud.status = '同期先を開けませんでした'; return; }

  try {
    // みんなで見る領域。店のデータと、誰の星・誰が行ったか
    cloud.edits = db.doc('shared/stores').collection('s');
    cloud.meta = db.doc('shared/meta');
    cloud.reviews = db.doc('shared/reviews').collection('r');
    cloud.members = db.doc('shared/members').collection('m');
    cloud.config = db.doc('shared/config');
    cloud.shared = true;
  } catch (e) {
    cloud.shared = false;
  }

  cloud.on = true;
  cloud.status = cloud.shared ? '同期中（端末間 ＋ 仲間と共有）'
    : '同期中（この端末と他の端末で同じ記録）';

  const onErr = (e) => cloudTrouble(e);

  cloud.subs.push(cloud.notes.onSnapshot((snap) => {
    let changed = false;
    applyRemote(() => {
      for (const d of snap.docs) {
        const body = d.data();
        if (!body) continue;
        const mine = user[d.id];
        if (mine && (mine.t || 0) >= (body.t || 0)) continue;
        user[d.id] = Object.assign({}, body);
        cloud.shadowUser[d.id] = JSON.stringify(stripMeta(user[d.id]));
        changed = true;
      }
      if (changed) writeJSON(KEY.user, user);
    });
    if (changed) { rebuild(); render(); }
  }, onErr));

  cloud.subs.push(cloud.edits.onSnapshot((snap) => {
    let changed = false;
    applyRemote(() => {
      for (const d of snap.docs) {
        const body = d.data();
        if (!body || !body.id) continue;
        const i = custom.findIndex((c) => c.id === body.id);
        if (i >= 0 && (custom[i].t || 0) >= (body.t || 0)) continue;
        const rec = Object.assign({}, body);
        if (i < 0) custom.push(rec); else custom[i] = rec;
        cloud.shadowCustom[body.id] = JSON.stringify(stripMeta(rec));
        changed = true;
      }
      if (changed) writeJSON(KEY.custom, custom);
    });
    if (changed) { rebuild(); render(); }
  }, onErr));

  cloud.subs.push(cloud.meta.onSnapshot((snap) => {
    const body = snap.data();
    if (!body || !Array.isArray(body.deleted)) return;
    if (String(body.deleted) === String(deleted)) return;
    applyRemote(() => {
      deleted = body.deleted.filter((x) => typeof x === 'string');
      writeJSON(KEY.deleted, deleted);
    });
    rebuild();
    render();
  }, onErr));

  if (cloud.shared) {
    // 合言葉を通るまで、みんなの記録には触らない
    const through = await runGate(uid);
    if (!through) { cloudPush(); return; }
    await publishMe();

    cloud.subs.push(cloud.reviews.onSnapshot((snap) => {
      const next = {};
      for (const d of snap.docs) {
        const body = d.data();
        if (!body || !body.storeId || !body.by) continue;
        if (body.by === myId()) continue;  // 自分のぶんは user[] が正
        if (!next[body.storeId]) next[body.storeId] = {};
        next[body.storeId][body.by] = {
          rating: Number(body.rating) || 0,
          visits: Array.isArray(body.visits) ? body.visits : [],
        };
      }
      mates = next;
      rebuild();
      render();
    }, onErr));

    cloud.subs.push(cloud.members.onSnapshot((snap) => {
      const next = {};
      for (const d of snap.docs) {
        const body = d.data();
        if (body && typeof body.name === 'string') next[d.id] = body.name;
      }
      memberNames = next;
      render();
    }, onErr));
  }

  // 端末にしか無い記録を最初に押し上げる
  cloudPush();
}

/* ---------------- data assembly ---------------- */

function rebuild() {
  const byId = new Map();
  for (const s of base.stores) byId.set(s.id, s);
  for (const c of custom) {
    const prev = byId.get(c.id);
    if (prev) { byId.set(c.id, Object.assign({}, prev, c)); continue; }
    // 元の店が stores.json から消えた場合。
    // アプリで追加・編集した店は name を持つので店として残す。
    // 星やお気に入りだけを付けた「部分的な変更」は name を持たないので、
    // そのまま店にすると名前の無い幽霊行（未確認バッジ付き）になる。捨てる。
    if (c.name) byId.set(c.id, c);
  }
  for (const id of deleted) byId.delete(id);
  stores = [...byId.values()].map(normalizeStore);
}

function normalizeStore(s) {
  // 整えたあとの値で検索用の文字列を作る。生の s.tags を使うと、
  // tags が配列でないデータを読んだときにここで落ちる（せっかくの防御が無駄になる）
  const tags = Array.isArray(s.tags) ? s.tags : [];
  const aliases = Array.isArray(s.aliases) ? s.aliases : [];
  return Object.assign({}, s, {
    name: typeof s.name === 'string' ? s.name : String(s.name || ''),
    building: venueKey(s.building),
    floor: s.floor || 'B1',
    tags: tags,
    closedDays: Array.isArray(s.closedDays) ? s.closedDays : [],
    rating: typeof s.rating === 'number' ? s.rating : null,
    aliases: aliases,
    verified: s.verified === true,
    source: s.source || 'manual',
    _n: norm([s.name, s.kana, s.category, s.block, tags.join(' '), aliases.join(' ')].join(' ')),
  });
}

// tools/ingest.py と同じ ID を作るための SHA-1。
// crypto.subtle は非同期で、安全でない接続では使えないこともあるので自前で持つ。
function sha1hex(str) {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  const withPad = new Uint8Array((((len + 8) >> 6) + 1) * 64);
  withPad.set(bytes);
  withPad[len] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, len * 8, false);

  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  const w = new Int32Array(80);
  const rot = (n, b) => (n << b) | (n >>> (32 - b));

  for (let i = 0; i < withPad.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getInt32(i + j * 4, false);
    for (let j = 16; j < 80; j++) w[j] = rot(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f, k;
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const t = (rot(a, 5) + f + e + k + w[j]) | 0;
      e = d; d = c; c = rot(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('');
}

// ID 用の正規化。tools/ekimae_data.py の norm と一字一句そろえること。
// ここがずれると、同じ店がアプリ側と取り込み側で別IDになって二重に出る。
function idNorm(str) {
  return String(str || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s\u3000ー・･\-_/()（）「」【】]/g, '');
}

function makeId(building, floor, name) {
  return 'b' + building + '-' + floor + '-' + sha1hex(idNorm(name)).slice(0, 6);
}

function norm(str) {
  return String(str || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s　ー・･]/g, '');
}

/* ---------------- 営業時間 ---------------- */

function parseRanges(hours) {
  if (!hours) return [];
  return String(hours)
    .split(/[,、]/)
    .map((part) => {
      // 全角で打たれても読めるようにしてから照合する（スマホのIMEでは普通に起きる）
      const m = part.trim().normalize('NFKC').match(/^(\d{1,2}):(\d{2})\s*[-–—ー－~〜]\s*(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const from = Number(m[1]) * 60 + Number(m[2]);
      let to = Number(m[3]) * 60 + Number(m[4]);
      if (to <= from) to += 24 * 60; // 翌日にまたがる
      return { from, to };
    })
    .filter(Boolean);
}

function isOpenNow(s, now = new Date()) {
  const ranges = parseRanges(s.hours);
  if (!ranges.length) return null; // 情報なし
  const mins = now.getHours() * 60 + now.getMinutes();
  const today = DOW[now.getDay()];
  const yday = DOW[(now.getDay() + 6) % 7];
  if (!s.closedDays.includes(today)) {
    if (ranges.some((r) => mins >= r.from && mins < r.to)) return true;
  }
  if (!s.closedDays.includes(yday)) {
    // 前日の深夜営業が続いているケース
    if (ranges.some((r) => r.to > 24 * 60 && mins + 24 * 60 < r.to && mins + 24 * 60 >= r.from)) return true;
  }
  return false;
}

/* ---------------- filtering ---------------- */

function matches(s) {
  if (ui.buildings.length && !ui.buildings.includes(String(s.building))) return false;
  if (ui.floors.length && !ui.floors.includes(s.floor)) return false;
  if (ui.cats.length && !ui.cats.includes(s.category)) return false;

  const ud = user[s.id];
  const allTags = s.tags.concat((ud && ud.tags) || []);
  if (ui.tags.length && !ui.tags.every((t) => allTags.includes(t))) return false;

  for (const m of ui.misc) {
    if (m === 'fav' && !(ud && ud.fav)) return false;
    if (m === 'open' && isOpenNow(s) !== true) return false;
    if (m === 'memo' && !(ud && ud.memo && ud.memo.trim())) return false;
    if (m === 'visited' && !(ud && ud.visits && ud.visits.length)) return false;
    if (m === 'unvisited' && ud && ud.visits && ud.visits.length) return false;
    if (m === 'crowd' && !crowd(s.id).some((c) => !c.me)) return false;
    if (m === 'r35' && !(s.rating >= 3.5)) return false;
    if (m === 'r40' && !(s.rating >= 4.0)) return false;
    if (m === 'unverified' && s.verified) return false;
  }

  const q = norm(ui.q);
  if (q) {
    const hay = s._n + norm(((ud && ud.tags) || []).join(' ')) + norm((ud && ud.memo) || '');
    if (!hay.includes(q)) return false;
  }
  return true;
}

// 「いまここ」のフロアかどうか。地下街は GPS が効かないので手で指定する
function isHere(s) {
  return !!ui.here && String(s.building) === String(ui.here.building) && s.floor === ui.here.floor;
}

// 並べ替えの鍵。区画番号は「28」と「28-1」で長さが変わるので、
// 数値の並びと店名を分けて持つ。混ぜると数値と文字列を突き合わせることになり、
// 比較が非対称になって Array.sort の結果が壊れる。
function sortKey(s) {
  const fi = FLOOR_ORDER.indexOf(s.floor);
  return {
    nums: [isHere(s) ? 0 : 1, venueIndex(s.building), fi < 0 ? 99 : fi, ...blockKey(s.block)],
    name: s.name || '',
  };
}

function sorted(list) {
  const arr = list.slice();
  // 「いまここ」はどの並びでも先頭に来る。マップだけ効いてリストは効かない、
  // という食い違いを避けるため、並べ替えたあとに前へ出す
  const hoistHere = (a) => {
    if (!ui.here) return a;
    const here = a.filter(isHere), rest = a.filter((x) => !isHere(x));
    return here.concat(rest);
  };
  if (ui.sort === 'mates') {
    arr.sort((a, b) => (crowdRating(b.id) || 0) - (crowdRating(a.id) || 0)
      || a.name.localeCompare(b.name, 'ja'));
  } else if (ui.sort === 'rating') {
    arr.sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name, 'ja'));
  } else if (ui.sort === 'name') {
    arr.sort((a, b) => (a.kana || a.name).localeCompare(b.kana || b.name, 'ja'));
  } else if (ui.sort === 'recent') {
    arr.sort((a, b) => ((user[b.id] && user[b.id].seenAt) || 0) - ((user[a.id] && user[a.id].seenAt) || 0));
  } else {
    arr.sort((a, b) => {
      const ka = sortKey(a), kb = sortKey(b);
      for (let i = 0; i < Math.max(ka.nums.length, kb.nums.length); i++) {
        const x = ka.nums[i] === undefined ? -1 : ka.nums[i];
        const y = kb.nums[i] === undefined ? -1 : kb.nums[i];
        if (x !== y) return x - y;
      }
      return ka.name.localeCompare(kb.name, 'ja');
    });
    return arr; // 既定の並びは sortKey の中で「いまここ」を見ている
  }
  return hoistHere(arr);
}

/* ---------------- DOM helpers ---------------- */

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs, children) {
  const n = document.createElement(tag);
  for (const k in attrs || {}) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k === 'text') n.textContent = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
  }
  for (const c of [].concat(children || [])) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  if (isEmbedded()) t.style.top = Math.max(12, lastPointY - 70) + 'px';
  else t.style.top = '';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2000);
}

function starsText(r) {
  if (!r) return '';
  const full = Math.floor(r);
  const half = r - full >= 0.5;
  return '★'.repeat(full) + (half ? '☆' : '') + ' ' + r.toFixed(1);
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function gmapsLink(s) {
  if (s.gmapsUrl) return s.gmapsUrl;
  const q = s.name + ' ' + ((venueOf(s.building) || {}).search || venueName(s.building));
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

// 公式フロア案内。区画番号つきの平面図が載っている唯一の一次情報なので、
// 「この店は図のどこか」を確かめる出口として詳細画面から開けるようにする。
const OFFICIAL_FLOOR_PAGES = {
  1: { B2: 'https://www.1bld.com/floor/floor_b2.html', B1: 'https://www.1bld.com/floor/floor_b1.html',
       '1F': 'https://www.1bld.com/floor/floor_01.html', '2F': 'https://www.1bld.com/floor/floor_02.html' },
  2: { B2: 'https://ekimae2.jp/flg-b2/', B1: 'https://ekimae2.jp/flg-b1/',
       '1F': 'https://ekimae2.jp/flg-1f/', '2F': 'https://ekimae2.jp/flg-2f/' },
  3: { B2: 'https://ekimae3.jp/b2f.html', B1: 'https://ekimae3.jp/b1f.html',
       '1F': 'https://ekimae3.jp/1f.html', '2F': 'https://ekimae3.jp/2f.html' },
  4: { B2: 'https://www.ekimae4.jp/b2.html', B1: 'https://www.ekimae4.jp/b1.html',
       '1F': 'https://www.ekimae4.jp/1f.html', '2F': 'https://www.ekimae4.jp/2f.html' },
};

function floorPlanLink(s) {
  const byFloor = OFFICIAL_FLOOR_PAGES[s.building];
  if (byFloor && byFloor[s.floor]) return byFloor[s.floor];
  // フロアごとのページが無い施設は、公式サイトのトップへ送る
  return (venueOf(s.building) || {}).site || null;
}

function tabelogLink(s) {
  const q = s.name + ' ' + ((venueOf(s.building) || {}).search || venueName(s.building)) + ' 食べログ';
  return 'https://www.google.com/search?q=' + encodeURIComponent(q);
}

/* ---------------- filter chips ---------------- */

function renderChips() {
  const mk = (container, items, selected, onToggle) => {
    if (!container) return;
    container.textContent = '';
    for (const it of items) {
      container.appendChild(el('button', {
        class: 'chip' + (selected.includes(it.value) ? ' is-on' : ''),
        type: 'button',
        text: it.label,
        onclick: () => onToggle(it.value),
      }));
    }
  };

  const toggle = (arr, v) => {
    const i = arr.indexOf(v);
    if (i < 0) arr.push(v); else arr.splice(i, 1);
    saveUI();
    render();
  };

  // 店が1件も無い場所のチップは出さない（バルチカなどは取り込むまで現れない）
  const venueCounts = new Map();
  for (const st of stores) {
    const k = String(st.building);
    venueCounts.set(k, (venueCounts.get(k) || 0) + 1);
  }
  const venueList = VENUES
    .filter((v) => venueCounts.get(String(v.id)) || ui.buildings.includes(String(v.id)))
    .map((v) => ({ value: String(v.id), label: v.short + ' ' + (venueCounts.get(String(v.id)) || 0) }));
  mk($('#f-building'), venueList, ui.buildings, (v) => toggle(ui.buildings, v));

  // フロアは「店が1件でもある階」だけ出す。駅前ビルの 1F / 2F は飲食がほとんど無く、
  // 押しても0件のチップが並ぶだけなので固定リストにはしない。
  // 後で 1F の店を入れれば、その階のチップは自動で現れる。
  const floorCounts = new Map();
  for (const s of stores) {
    if (s.floor) floorCounts.set(s.floor, (floorCounts.get(s.floor) || 0) + 1);
  }
  const floorList = [...floorCounts.entries()]
    .sort((a, b) => FLOOR_ORDER.indexOf(a[0]) - FLOOR_ORDER.indexOf(b[0]))
    .map(([f, n]) => ({ value: f, label: f + ' ' + n }));
  // 消えた階が選ばれたままだと、外すチップが無いのに0件になって詰む。
  // ただし読み込み失敗で0件のときは、選択を消さない（通信が戻れば使えるため）
  const pruned = stores.length ? ui.floors.filter((f) => floorCounts.has(f)) : ui.floors;
  if (pruned.length !== ui.floors.length) {
    ui.floors.length = 0;
    ui.floors.push(...pruned);
    saveUI();
  }
  mk($('#f-floor'), floorList, ui.floors, (v) => toggle(ui.floors, v));

  const catCounts = new Map();
  for (const s of stores) {
    if (s.category) catCounts.set(s.category, (catCounts.get(s.category) || 0) + 1);
  }
  // 選んだものを先頭へ。畳んだ2行の中に必ず入るようにするため
  const catList = [...catCounts.entries()]
    .sort((a, b) => (ui.cats.includes(b[0]) ? 1 : 0) - (ui.cats.includes(a[0]) ? 1 : 0)
      || CATEGORIES.indexOf(a[0]) - CATEGORIES.indexOf(b[0]))
    .map(([c, n]) => ({ value: c, label: c + ' ' + n }));
  mk($('#f-category'), catList, ui.cats, (v) => toggle(ui.cats, v));

  const tagCounts = new Map();
  for (const s of stores) {
    const ud = user[s.id];
    for (const t of s.tags.concat((ud && ud.tags) || [])) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
  }
  const tagList = [...tagCounts.entries()]
    .sort((a, b) => (ui.tags.includes(b[0]) ? 1 : 0) - (ui.tags.includes(a[0]) ? 1 : 0)
      || b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
    .map(([t, c]) => ({ value: t, label: t + ' ' + c }));
  mk($('#f-tag'), tagList.length ? tagList : [{ value: '__none', label: 'タグ未登録' }], ui.tags, (v) => {
    if (v === '__none') return;
    toggle(ui.tags, v);
  });

  // 押しても必ず0件になる条件は出さない。営業時間や星が未入力のうちは
  // 「営業中」「星3.5+」を押しても何も起きず、壊れているように見えるため。
  // データが入れば自動で現れる。
  const miscCount = (id) => stores.filter((s) => {
    const ud = user[s.id];
    if (id === 'fav') return ud && ud.fav;
    if (id === 'open') return isOpenNow(s) === true;
    if (id === 'memo') return ud && ud.memo && ud.memo.trim();
    if (id === 'visited') return ud && ud.visits && ud.visits.length;
    if (id === 'unvisited') return !(ud && ud.visits && ud.visits.length);
    if (id === 'crowd') return crowd(s.id).some((c) => !c.me);
    if (id === 'r35') return s.rating >= 3.5;
    if (id === 'r40') return s.rating >= 4.0;
    if (id === 'unverified') return !s.verified;
    return false;
  }).length;
  const miscList = MISC_FILTERS
    .map((m) => ({ id: m.id, label: m.label, n: miscCount(m.id) }))
    .filter((m) => m.n > 0 || ui.misc.includes(m.id));
  // 選べなくなった条件が選ばれたままだと、外すチップが無いのに0件になって詰む
  const okMisc = new Set(miscList.map((m) => m.id));
  if (ui.misc.some((v) => !okMisc.has(v))) {
    const keep = ui.misc.filter((v) => okMisc.has(v));
    ui.misc.length = 0; ui.misc.push(...keep); saveUI();
  }

  mk($('#f-misc'), miscList.map((m) => ({ value: m.id, label: m.label + ' ' + m.n })), ui.misc, (v) => {
    if ((v === 'visited' && ui.misc.includes('unvisited'))) ui.misc.splice(ui.misc.indexOf('unvisited'), 1);
    if ((v === 'unvisited' && ui.misc.includes('visited'))) ui.misc.splice(ui.misc.indexOf('visited'), 1);
    if (v === 'r35' && ui.misc.includes('r40')) ui.misc.splice(ui.misc.indexOf('r40'), 1);
    if (v === 'r40' && ui.misc.includes('r35')) ui.misc.splice(ui.misc.indexOf('r35'), 1);
    toggle(ui.misc, v);
  });

  syncChipsMore('category');
  syncChipsMore('tag');
}

// 折り返した行が2行に収まらないときだけ「もっと見る」を出す。
// 横スクロールだと「まだ先がある」ことが伝わらず、19種類のうち3つしか
// 見えていないのに気づけなかった。
function syncChipsMore(key) {
  const box = $('#f-' + key);
  const btn = $('#more-' + key);
  if (!box || !btn) return;
  // 畳んだときに選択中のチップが2行目より下に隠れると、パネル上では
  // 何も選んでいないように見える。キーボード操作で勝手にずれた分も戻す
  box.scrollTop = 0;
  const collapsed = box.classList.contains('is-collapsed');
  const overflows = box.scrollHeight > box.clientHeight + 2;
  btn.hidden = collapsed ? !overflows : false;
  btn.textContent = collapsed ? 'もっと見る' : '閉じる';
}

/* ---------------- list view ---------------- */

// 自分以外にも記録がある店は、一覧でそれと分かるようにする
function crowdBadge(storeId) {
  const others = crowd(storeId).filter((c) => !c.me);
  if (!others.length) return null;
  const avg = crowdRating(storeId);
  return el('span', {
    class: 'card-crowd',
    title: others.map((c) => memberLabel(c.by)).join('・') + ' の記録あり',
    text: '👥' + others.length + (avg ? ' ★' + avg.toFixed(1) : ''),
  });
}

function storeCard(s) {
  const ud = user[s.id] || {};
  const open = isOpenNow(s);
  // 一覧は「どこの何屋か」が分かれば足りる。読む量を減らして1行に収める
  const meta = [
    el('span', { text: venueShort(s.building) + ' ' + s.floor }),
    s.block ? el('span', { text: '区画' + s.block }) : null,
    s.category ? el('span', { text: s.category }) : null,
    s.budget ? el('span', { text: '¥' + s.budget }) : null,
    s.rating ? el('span', { class: 'stars', text: starsText(s.rating) }) : null,
    open === null ? null : el('span', { class: open ? 'open-now' : 'open-closed', text: open ? '営業中' : '時間外' }),
  ].filter(Boolean);

  const tags = s.tags.map((t) => el('span', { class: 'tagpill', text: t }))
    .concat((ud.tags || []).map((t) => el('span', { class: 'tagpill tagpill--mine', text: t })));
  if (!s.verified) tags.unshift(el('span', { class: 'tagpill tagpill--warn', text: '未確認' }));

  return el('button', { class: 'card', type: 'button', onclick: () => openDetail(s.id) }, [
    el('div', { class: 'card-head' }, [
      el('span', { class: 'card-name', text: s.name }),
      ud.fav ? el('span', { class: 'card-fav', text: '★' }) : null,
      // 「今日行った」を押しても一覧が何も変わらず、効いていないように見えていた
      ud.visits && ud.visits.length
        ? el('span', { class: 'card-visit', title: '行ったことがある', text: '✓' + (ud.visits.length > 1 ? ud.visits.length : '') })
        : null,
      ud.rating ? el('span', { class: 'card-fav', text: '自' + ud.rating }) : null,
      crowdBadge(s.id),
    ]),
    el('div', { class: 'card-meta' }, meta),
    tags.length ? el('div', { class: 'card-tags' }, tags) : null,
    ud.memo && ud.memo.trim() ? el('div', { class: 'memo-preview', text: ud.memo }) : null,
  ]);
}

function renderList(hits) {
  const box = $('#view-list');
  box.textContent = '';
  if (!hits.length) {
    box.appendChild(el('p', { class: 'empty', text: '条件に合う店がありません。フィルタを緩めるか、＋から店を登録してください。' }));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const s of hits) frag.appendChild(storeCard(s));
  box.appendChild(frag);
}

/* ---------------- map view ---------------- */

function blockKey(block) {
  const m = String(block || '').normalize('NFKC').match(/\d+/g);
  return m ? m.map(Number) : [9999];
}

function cmpBlock(a, b) {
  const ka = blockKey(a.block), kb = blockKey(b.block);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const x = ka[i] === undefined ? -1 : ka[i];
    const y = kb[i] === undefined ? -1 : kb[i];
    if (x !== y) return x - y;
  }
  return a.name.localeCompare(b.name, 'ja');
}

// 1フロアぶんの平面図。区画の位置に点を打ち、絞り込みに該当する店だけ
// 色を付ける。「いまいるフロアの、どこに、条件に合う店があるか」を
// リストでは出せない形で見せるのが狙い。
function planFloor(key, planned, hitIds) {
  const img = el('img', {
    class: 'planmap-img', src: bundledPlanUrl(key), alt: '平面図', loading: 'lazy',
  });
  const stage = el('div', { class: 'planmap-stage' }, [img]);

  // 同じ区画に複数の店があると点が重なる。少しずつずらして両方押せるようにする
  const seen = new Map();
  const hitCount = planned.filter((p) => hitIds.has(p.store.id)).length;
  // 該当が少ないうちは店名も出す。多いと重なって読めないので点だけにする
  const withName = hitCount > 0 && hitCount <= 8;

  for (const p of planned) {
    const s = p.store;
    const ud = user[s.id] || {};
    const hit = hitIds.has(s.id);
    const visited = !!(ud.visits && ud.visits.length);
    const at = p.spot.pos.join(',');
    const n = seen.get(at) || 0;
    seen.set(at, n + 1);

    const dot = el('button', {
      class: 'planmark' + (hit ? ' is-hit' : ' is-dim')
        + (ud.fav ? ' is-fav' : '') + (visited ? ' is-visited' : '')
        + (p.spot.exact ? '' : ' is-near') + (s.id === focusId ? ' is-focus' : ''),
      type: 'button',
      'data-id': s.id,
      title: s.name + '（区画' + (s.block || '?') + '）',
      style: 'left:' + (p.spot.pos[0] * 100) + '%;top:' + (p.spot.pos[1] * 100) + '%;'
        + (n ? 'margin-left:' + (n * 9) + 'px;margin-top:' + (n * 9) + 'px;' : ''),
      onclick: () => openDetail(s.id),
    }, [
      el('span', { class: 'planmark-dot' }),
      hit && withName ? el('span', { class: 'planmark-name', text: s.name }) : null,
    ]);
    stage.appendChild(dot);
  }

  const scroller = el('div', { class: 'planmap-scroll' }, [stage]);
  const zoom = el('button', {
    class: 'btn btn--ghost btn--sm', type: 'button', text: '拡大',
    onclick: () => {
      const on = stage.classList.toggle('is-zoom');
      zoom.textContent = on ? '縮小' : '拡大';
    },
  });
  return el('div', { class: 'planmap' }, [
    scroller,
    el('div', { class: 'planmap-foot' }, [
      el('span', { class: 'planmap-note', text: '点をタップすると店が開きます' }),
      zoom,
    ]),
  ]);
}

function renderMap(hits) {
  const box = $('#view-map');
  box.textContent = '';
  const hitIds = new Set(hits.map((s) => s.id));

  // フロア絞り込みは効かせつつ、同フロアの非該当店も薄く残して位置関係が分かるようにする
  const inScope = stores.filter((s) => {
    if (ui.buildings.length && !ui.buildings.includes(String(s.building))) return false;
    if (ui.floors.length && !ui.floors.includes(s.floor)) return false;
    return true;
  });

  const groups = new Map();
  for (const s of inScope) {
    const k = s.building + '/' + s.floor;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }

  const hereKey = ui.here ? ui.here.building + '/' + ui.here.floor : null;
  const keys = [...groups.keys()].sort((a, b) => {
    // いまいるフロアを一番上に。歩きながら開いたとき、自分の周りがすぐ出る
    if (a === hereKey) return -1;
    if (b === hereKey) return 1;
    const [ab, af] = a.split('/'), [bb, bf] = b.split('/');
    // 場所キーは 1〜4 の数字と 'kitte' などの文字列が混ざるので Number() では比べられない
    // （NaN になって並び順が崩れる）。VENUES の並び順で比べる。
    return venueIndex(ab) - venueIndex(bb) || FLOOR_ORDER.indexOf(af) - FLOOR_ORDER.indexOf(bf);
  });

  const visible = keys.filter((k) => groups.get(k).some((s) => hitIds.has(s.id)));
  if (!visible.length) {
    // ここで捨てておかないと、あとで絞り込みを緩めた拍子に
    // 押した覚えのないマスが光る
    if (focusId) {
      const s = stores.find((x) => x.id === focusId);
      if (s) toast(s.name + ' はいまの絞り込みの外です');
    }
    focusId = null;
    box.appendChild(el('p', { class: 'empty', text: '該当する店がありません。' }));
    return;
  }

  // マップは1マスが小さいので、お気に入り・訪問済みは色の面で出す。
  // それとは別に、「立ち飲みかどうか」だけはマスの上で分かるようにしたい
  // （席があるかどうかで行く／行かないが変わるので、種類より先に知りたい）。
  // 立ち飲みは category と tags の両方に入っていることがあるので両方見る。
  const HIGHLIGHT_TAGS = ['立ち飲み'];
  const cellTags = (s) => {
    const own = [].concat(s.tags || [], s.category ? [s.category] : []);
    const out = HIGHLIGHT_TAGS.filter((t) => own.includes(t));
    if (!s.verified) out.push('未確認');
    return out;
  };

  // 枠線は「絞り込みに該当」で既に使っているため、そこには重ねない。
  const cell = (s, provisional) => {
    const ud = user[s.id] || {};
    const hit = hitIds.has(s.id);
    const visited = !!(ud.visits && ud.visits.length);
    const marks = [];
    if (ud.fav) marks.push(el('span', { class: 'm-fav', text: '★' }));
    if (visited) marks.push(el('span', { class: 'm-visit', text: '✓' }));
    return el('button', {
      class: 'gridcell' + (hit ? ' is-hit' : ' is-dim') + (provisional ? ' is-provisional' : '')
        + (ud.fav ? ' is-fav' : '') + (visited ? ' is-visited' : '')
        + (s.id === focusId ? ' is-focus' : ''),
      'data-id': s.id,
      type: 'button',
      style: provisional ? null
        : 'grid-column:' + s.pos.x + ' / span ' + (s.w || 1) + ';grid-row:' + s.pos.y + ' / span ' + (s.h || 1) + ';',
      onclick: () => openDetail(s.id),
    }, [
      marks.length ? el('span', { class: 'gridcell-marks' }, marks) : null,
      el('span', { class: 'gridcell-name' + (marks.length ? ' has-mark' : ''), text: s.name }),
      // マスが小さいので全部は出せない。種類とタグのうち、探すときに
      // 効くもの（立ち飲みなど）だけを1つ、種類の代わりに出す
      cellTags(s).length
        ? el('span', { class: 'gridcell-tags' },
            cellTags(s).map((t) => el('span', {
              class: 'gridtag' + (t === '未確認' ? ' gridtag--warn' : ''), text: t,
            })))
        : null,
      el('span', { class: 'gridcell-sub' }, [
        el('span', { text: s.block ? '区画' + s.block : (s.category || '') }),
        el('span', { text: s.category && s.block ? s.category : '' }),
      ]),
    ]);
  };

  // 凡例は、実際に印が付く店があるときだけ出す
  const anyFav = inScope.some((s) => user[s.id] && user[s.id].fav);
  const anyVisited = inScope.some((s) => user[s.id] && user[s.id].visits && user[s.id].visits.length);
  if (anyFav || anyVisited) {
    box.appendChild(el('p', { class: 'maplegend' }, [
      anyFav ? el('span', {}, [el('span', { class: 'legend-swatch legend-swatch--fav' }), 'お気に入り']) : null,
      anyVisited ? el('span', {}, [el('span', { class: 'legend-swatch legend-swatch--visit', text: '✓' }), '行った']) : null,
    ]));
  }

  for (const k of visible) {
    const [b, f] = k.split('/');
    const list = groups.get(k);
    const placed = list.filter((s) => s.pos && s.pos.x > 0 && s.pos.y > 0);
    const flow = list.filter((s) => !(s.pos && s.pos.x > 0 && s.pos.y > 0)).sort(cmpBlock);
    const hitCount = list.filter((s) => hitIds.has(s.id)).length;

    const group = el('div', { class: 'floorgroup' }, [
      el('h2', {}, [
        k === hereKey ? el('span', { class: 'herebadge', text: 'いまここ' }) : null,
        el('span', { text: venueShort(b) + ' ' + f + '　該当 ' + hitCount + ' / ' + list.length + '件' }),
      ]),
    ]);

    // 公式の平面図が手元にあるフロアは、図の上に直接置く。
    // 区画番号から位置が分かるので、絞り込んだ店が「どこにあるか」が見える。
    const planned = [];
    const rest = [];
    const planKeyName = planKey(b, f);
    const hasPlan = !!bundledPlanUrl(planKeyName) && !!(blockSpots || {})[planKeyName];
    for (const st of list) {
      const spot = hasPlan ? findBlockSpot(planKeyName, st.block) : null;
      if (spot) planned.push({ store: st, spot: spot });
      else rest.push(st);
    }

    if (planned.length) {
      group.appendChild(planFloor(planKeyName, planned, hitIds));
    }

    if (!planned.length && placed.length) {
      const cols = Math.max(4, ...placed.map((s) => s.pos.x + ((s.w || 1) - 1)));
      const grid = el('div', { class: 'grid', style: 'grid-template-columns: repeat(' + cols + ', var(--cell));' });
      for (const s of placed) grid.appendChild(cell(s, false));
      group.appendChild(el('div', { class: 'gridwrap' }, [grid]));
    }

    // 平面図に置けなかった店（区画番号が図に無い・未登録）は下に並べる。
    // 図の上から消えてしまうと、あるのに無いことになってしまう
    const leftovers = planned.length ? rest : flow;
    if (leftovers.length) {
      group.appendChild(el('p', {
        class: 'gridnote',
        text: planned.length ? '図の上に置けなかった店（区画番号が図に見当たらない）'
          : (placed.length ? '以下は' : '') + '区画番号順（実配置は未設定）',
      }));
      const g = el('div', { class: 'grid grid--flow' });
      for (const st of leftovers.slice().sort(cmpBlock)) g.appendChild(cell(st, true));
      group.appendChild(g);
    }

    box.appendChild(group);
  }

  if (focusId) {
    const cellEl = box.querySelector('.gridcell.is-focus, .planmark.is-focus');
    const target = focusId;
    focusId = null;
    if (cellEl) {
      // レイアウト確定後でないと位置がずれる
      requestAnimationFrame(() => {
        cellEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        const wrap = cellEl.closest('.gridwrap, .planmap-scroll');
        if (wrap) wrap.scrollLeft = Math.max(0, cellEl.offsetLeft - wrap.clientWidth / 2 + cellEl.offsetWidth / 2);
      });
      setTimeout(() => cellEl.classList.remove('is-focus'), 2400);
    } else {
      const s = stores.find((x) => x.id === target);
      toast(s ? s.name + ' はいまの絞り込みの外です' : '見つかりませんでした');
    }
  }
}

/* ---------------- render ---------------- */

function activeFilterCount() {
  return ui.buildings.length + ui.floors.length + ui.cats.length + ui.tags.length + ui.misc.length;
}

// よく使う条件だけ、開かずに押せるところへ出しておく。
// 残りは「こだわり」シートの中。
const QUICK_TOGGLES = [
  { kind: 'misc', value: 'fav', label: '★ お気に入り' },
  { kind: 'misc', value: 'unvisited', label: '未訪問' },
  { kind: 'cat', value: '立ち飲み', label: '立ち飲み' },
  { kind: 'misc', value: 'crowd', label: '仲間の記録あり' },
];

function quickArr(kind) {
  return kind === 'cat' ? ui.cats : ui.misc;
}

function syncFilterBar() {
  renderQuickbar();
}

// いま何で絞っているかが見えていないと、0件になった理由が分からない。
// 選択中の条件はその場で外せるチップとして並べる。
function renderQuickbar() {
  const bar = $('#quickbar');
  if (!bar) return;
  bar.textContent = '';
  const n = activeFilterCount();

  const lead = el('button', {
    class: 'qchip qchip--lead' + (n ? ' is-on' : ''), type: 'button',
    onclick: openFilterSheet,
  }, [
    svgIcon('M3 6h14M3 11h14M3 16h14', [[7, 6], [13, 11], [9, 16]]),
    el('span', { text: 'こだわり' }),
    n ? el('span', { class: 'qbadge', text: String(n) }) : null,
  ]);
  bar.appendChild(lead);

  bar.appendChild(el('button', {
    class: 'qchip' + (ui.here ? ' is-on' : ''), type: 'button',
    text: ui.here ? '📍' + venueShort(ui.here.building) + ' ' + ui.here.floor : 'いまここ',
    onclick: openHerePicker,
  }));

  for (const it of activeFilterChips()) {
    bar.appendChild(el('button', {
      class: 'qchip is-on', type: 'button', title: it.label + ' を外す',
      onclick: () => { it.drop(); saveUI(); render(); },
    }, [el('span', { text: it.label }), el('span', { class: 'qchip-x', text: '×' })]));
  }

  for (const t of QUICK_TOGGLES) {
    const arr = quickArr(t.kind);
    if (arr.includes(t.value)) continue;           // 選択中のものは上の列に出ている
    if (!quickCount(t)) continue;                  // 押しても0件のものは出さない
    bar.appendChild(el('button', {
      class: 'qchip', type: 'button', text: t.label,
      onclick: () => { arr.push(t.value); saveUI(); render(); },
    }));
  }

  if (n || ui.q || ui.here) {
    bar.appendChild(el('button', {
      class: 'qchip qchip--clear', type: 'button', text: 'すべて解除',
      onclick: resetFilters,
    }));
  }
}

function quickCount(t) {
  if (t.kind === 'cat') return stores.some((s) => s.category === t.value);
  return stores.some((s) => {
    const ud = user[s.id];
    if (t.value === 'fav') return ud && ud.fav;
    if (t.value === 'unvisited') return !(ud && ud.visits && ud.visits.length);
    if (t.value === 'crowd') return crowd(s.id).some((c) => !c.me);
    return false;
  });
}

// 選択中の条件を、外せる形で並べる
function activeFilterChips() {
  return []
    .concat(ui.buildings.map((v) => ({ label: venueShort(v), drop: () => remove(ui.buildings, v) })))
    .concat(ui.floors.map((v) => ({ label: v, drop: () => remove(ui.floors, v) })))
    .concat(ui.cats.map((v) => ({ label: v, drop: () => remove(ui.cats, v) })))
    // 種類とタグは同じ名前がある（立ち飲みなど）ので、タグ側に # を付けて区別する
    .concat(ui.tags.map((v) => ({ label: '#' + v, drop: () => remove(ui.tags, v) })))
    .concat(ui.misc.map((v) => {
      const m = MISC_FILTERS.find((x) => x.id === v);
      return { label: (m ? m.label : v), drop: () => remove(ui.misc, v) };
    }));
}

function resetFilters() {
  ui.buildings = []; ui.floors = []; ui.cats = []; ui.tags = []; ui.misc = []; ui.q = '';
  ui.here = null;
  const q = $('#q');
  if (q) { q.value = ''; $('#q-clear').hidden = true; }
  saveUI();
  render();
}

function svgIcon(d, dots) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 22');
  svg.setAttribute('class', 'qicon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);
  for (const [cx, cy] of dots || []) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', '2.2');
    c.setAttribute('fill', 'currentColor');
    svg.appendChild(c);
  }
  return svg;
}

// 「こだわり」シート。中身は #filters-holder に畳んであるものを持ってくる
function openFilterSheet() {
  const box = $('#filters');
  if (!box) return;
  openSheet([
    el('h2', { text: 'こだわり' }),
    box,
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'すべて解除', onclick: resetFilters }),
    ]),
  ]);
  renderChips();
  syncChipsMore('category');
  syncChipsMore('tag');
}

// シートを閉じるとき、借りていた #filters は元の場所へ返す。
// 返さないとシートの中身ごと消えて、次に開いたとき空になる
function stowFilters() {
  const box = $('#filters');
  const holder = $('#filters-holder');
  if (box && holder && box.parentNode !== holder) holder.appendChild(box);
}

function remove(arr, v) {
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1);
}

function render() {
  detectEmbedded();
  renderChips();
  syncFilterBar();
  const hits = sorted(stores.filter(matches));
  $('#count').textContent = hits.length === stores.length
    ? stores.length + ' 件' : hits.length + ' 件 / ' + stores.length + ' 件';
  // 0件でも押せるようにする。ここを押せなくすると、条件を戻す導線が
  // パネルの中から消えて行き止まりに見える
  const apply = $('#btn-apply');
  if (apply) {
    apply.textContent = hits.length ? hits.length + ' 件を見る' : '0件 — 条件を外す';
    apply.dataset.zero = hits.length ? '' : '1';
  }

  // 星が1件も入っていないうちは「星が高い順」が何も起こさないので隠す
  const hasRating = stores.some((s) => s.rating != null);
  const opt = $('#sort').querySelector('option[value="rating"]');
  if (opt) opt.hidden = !hasRating;
  if (!hasRating && ui.sort === 'rating') { ui.sort = 'default'; $('#sort').value = 'default'; saveUI(); }

  // みんなの星も、誰かが付けるまでは出さない
  const hasMates = stores.some((s) => crowdRating(s.id) != null);
  const optM = $('#sort').querySelector('option[value="mates"]');
  if (optM) optM.hidden = !hasMates;
  if (!hasMates && ui.sort === 'mates') { ui.sort = 'default'; $('#sort').value = 'default'; saveUI(); }
  const isList = ui.view === 'list';
  $('#view-list').hidden = !isList;
  $('#view-map').hidden = isList;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('is-active', t.dataset.view === ui.view);
  if (isList) renderList(hits); else renderMap(hits);
}

/* ---------------- sheet ---------------- */

/* 埋め込み表示（Artifact など）の検出。

親ページが枠を中身の高さぶんに伸ばして自分でスクロールする形だと、
枠の中では「画面の高さ = ページ全体の高さ」になる。すると
position: fixed が画面ではなくページ全体を基準にしてしまい、
画面下に出したはずのシートやトーストが数万px下に置かれて見えなくなる。
position: sticky も、枠の中がスクロールしないので効かない。

そういう場合は、固定をやめて「いま触った場所の近く」に出す。 */
function isEmbedded() {
  return document.documentElement.classList.contains('is-embedded');
}

function detectEmbedded() {
  let framed = false;
  try { framed = window.self !== window.top; } catch (e) { framed = true; }
  const noInnerScroll = document.documentElement.scrollHeight <= window.innerHeight + 1;
  const embedded = framed && noInnerScroll;
  document.documentElement.classList.toggle('is-embedded', embedded);

  // 埋め込みでは position:fixed が画面ではなく文書全体を基準にしてしまい、
  // 下のタブバーが2万px下へ飛ぶ。流し込みに戻したうえで、本文より前へ移す
  const bar = document.querySelector('.tabbar');
  const main = document.querySelector('main');
  if (!bar || !main) return;
  if (embedded && bar.nextElementSibling !== main) main.parentNode.insertBefore(bar, main);
  if (!embedded && bar.nextElementSibling === main) document.body.appendChild(bar);
}

// 最後に触った場所。埋め込み時に、シートやトーストをそこへ出すために使う
let lastPointY = 0;
function trackPoint(e) {
  const y = e.pageY || (e.touches && e.touches[0] && e.touches[0].pageY);
  if (y) lastPointY = y;
}

// 埋め込みでは「いま画面のどこを見ているか」を知る手段が無い。
// 分かっているのは最後に触った場所だけなので、そのすぐ上に出す。
// 背の高いシートを下端に収めようと持ち上げると、店名のある先頭が
// 画面の上に外れてしまうので、持ち上げない。
function anchorTop() {
  const margin = 12;
  const bottom = Math.max(margin, document.documentElement.scrollHeight - 140);
  return Math.min(bottom, Math.max(margin, lastPointY - 60));
}

// 画面に収まる高さの見当。埋め込みでは innerHeight がページ全体の
// 高さになってしまうので、端末の画面の大きさから見積もる
function viewportGuess() {
  const h = (window.screen && window.screen.height) || 700;
  return Math.max(340, Math.min(620, Math.round(h * 0.62)));
}

function openSheet(nodes) {
  const sheet = $('#sheet');
  const panel = sheet.querySelector('.sheet-panel');
  stowFilters();   // 前のシートが「こだわり」だった場合、中身を返してから消す
  panel.textContent = '';
  panel.appendChild(el('div', { class: 'sheet-grip' }));
  // 閉じるボタンは中身の末尾にもあるが、長いシートだとそこまで
  // 辿り着けない。いつでも押せるように上にも置く
  panel.appendChild(el('button', {
    class: 'sheet-x', type: 'button', text: '×', title: '閉じる',
    'aria-label': '閉じる', onclick: closeSheet,
  }));
  for (const n of [].concat(nodes)) if (n) panel.appendChild(n);
  panel.scrollTop = 0;
  sheet.hidden = false;

  if (isEmbedded()) {
    panel.style.maxHeight = viewportGuess() + 'px';
    panel.style.top = anchorTop() + 'px';
  } else {
    panel.style.maxHeight = '';
    panel.style.top = '';
    // 背後のページが動くと、シートを閉じたときに元の場所を見失う
    document.body.style.overflow = 'hidden';
  }
}

// 非同期でシートを組み立てている最中に閉じられたかを見分ける番号。
// 見ないと、閉じたはずのシートが読み込み完了後に開き直る
let sheetSeq = 0;

function closeSheet() {
  sheetSeq++;
  stowFilters();
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
}

/* ---------------- detail ---------------- */

// 「誰が行ったか・誰の星か」を並べる。共有していないときは出さない。
// 自分が星や訪問を変えた直後にも描き直したいので、中身だけ作って返す
function crowdBody(storeId) {
  const rows = crowd(storeId);
  if (!rows.length) return el('p', { class: 'crowd-empty', text: 'まだ誰も記録していません。' });
  rows.sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0) || b.rating - a.rating);
  return el('ul', { class: 'crowd' }, rows.map((c) => el('li', { class: 'crowd-row' + (c.me ? ' is-me' : '') }, [
    el('span', { class: 'crowd-name', text: memberLabel(c.by) + (c.me ? '（自分）' : '') }),
    el('span', { class: 'crowd-stars', text: c.rating ? '★'.repeat(c.rating) : '—' }),
    el('span', { class: 'crowd-visits', text: c.visits ? c.visits + '回' : '未訪問' }),
  ])));
}

function openDetail(id) {
  const s = stores.find((x) => x.id === id);
  if (!s) return;
  const ud = u(id);
  ud.seenAt = Date.now();
  saveUser();

  const open = isOpenNow(s);

  const favBtn = el('button', { class: 'btn' + (ud.fav ? ' btn--primary' : ''), type: 'button' });
  const syncFav = () => {
    favBtn.textContent = ud.fav ? '★ お気に入り' : '☆ お気に入り';
    favBtn.className = 'btn' + (ud.fav ? ' btn--primary' : '');
  };
  favBtn.addEventListener('click', () => {
    ud.fav = !ud.fav;
    saveUser();
    syncFav();
    render();
  });
  syncFav();

  // 自分が星や訪問を変えたら、その場で「みんなの記録」も描き直す
  const crowdSlot = el('div', { class: 'crowd-slot' });
  const drawCrowd = () => {
    crowdSlot.textContent = '';
    crowdSlot.appendChild(crowdBody(id));
  };

  const myStars = el('div', { class: 'mystars' });
  const drawStars = () => {
    myStars.textContent = '';
    for (let i = 1; i <= 5; i++) {
      myStars.appendChild(el('button', {
        type: 'button',
        class: i <= (ud.rating || 0) ? 'is-on' : '',
        text: '★',
        onclick: () => {
          ud.rating = ud.rating === i ? 0 : i;
          saveUser();
          drawStars();
          drawCrowd();
          render();
        },
      }));
    }
  };
  drawStars();
  drawCrowd();

  const memo = el('textarea', { placeholder: '味・混み具合・頼むべきもの・次回メモなど' });
  memo.value = ud.memo || '';
  memo.addEventListener('input', () => {
    ud.memo = memo.value;
    saveUser();
  });
  memo.addEventListener('blur', render);

  const myTags = el('input', { type: 'text', placeholder: '例: ひとり飲み, 接待向き（カンマ区切り）' });
  myTags.value = (ud.tags || []).join(', ');
  myTags.addEventListener('change', () => {
    ud.tags = myTags.value.split(/[,、]/).map((t) => t.trim()).filter(Boolean);
    saveUser();
    render();
  });

  // 押しても文言が変わらず、記録済みでも「追加しました」と出ていたので、
  // いまの状態を映して、もう一度押せば今日の分を取り消せるようにする
  const visitBtn = el('button', { class: 'btn', type: 'button' });
  const drawVisitBtn = () => {
    const done = ud.visits.includes(todayStr());
    visitBtn.textContent = done ? '今日は記録済み（取り消す）' : '今日行った';
    visitBtn.classList.toggle('btn--done', done);
  };
  visitBtn.addEventListener('click', () => {
    const d = todayStr();
    const i = ud.visits.indexOf(d);
    if (i < 0) { ud.visits.push(d); toast('今日行ったことにしました'); }
    else { ud.visits.splice(i, 1); toast('今日の記録を取り消しました'); }
    drawCrowd();
    saveUser();
    drawVisits();
    drawVisitBtn();
    render();
  });

  const visitsBox = el('ul', { class: 'visits' });
  const drawVisits = () => {
    visitsBox.textContent = '';
    if (!ud.visits.length) {
      visitsBox.appendChild(el('li', { text: 'まだ記録なし' }));
      return;
    }
    ud.visits.slice().sort().reverse().forEach((d) => {
      visitsBox.appendChild(el('li', {}, [
        d + ' ',
        el('button', {
          class: 'linkbtn', type: 'button', text: '削除',
          onclick: () => {
            ud.visits.splice(ud.visits.indexOf(d), 1);
            drawCrowd();
            saveUser();
            drawVisits();
            drawVisitBtn();
            render();
          },
        }),
      ]));
    });
  };
  drawVisits();
  drawVisitBtn();

  const dl = el('dl', {}, [
    row('場所', venueName(s.building) + ' ' + s.floor + (s.block ? '　区画' + s.block : '')),
    row('カテゴリ', s.category || '—'),
    row('予算', s.budget ? '¥' + s.budget : '—'),
    row('営業', (s.hours || '—') + (s.closedDays.length ? '（休: ' + s.closedDays.join('・') + '）' : '')
      + (open === null ? '' : open ? ' → 営業中' : ' → 時間外')),
    row('外部評価', s.rating
      ? starsText(s.rating) + (s.ratingCount ? '（' + s.ratingCount + '件' : '（')
        + (s.ratingSource || 'google') + (s.ratingCheckedAt ? ' / ' + s.ratingCheckedAt + '時点' : '') + '）'
      : '未記録'),
    s.tags.length ? row('タグ', s.tags.join('・')) : null,
    s.phone ? linkRow('電話', s.phone, 'tel:' + s.phone.replace(/[^\d+]/g, '')) : null,
    s.url ? linkRow('サイト', siteLabel(s.url), s.url) : null,
    row('出どころ', (s.verified ? '確認済み' : '未確認') + '（' + s.source + '）'),
    s.infoSource ? infoRow(s) : null,
  ].filter(Boolean));

  openSheet([
    el('h2', { text: s.name }),
    el('p', { class: 'sheet-sub', text: s.kana || '' }),
    s.verified ? null : el('div', { class: 'banner' }, [
      'この店は階や区画がまだ裏取りできていません。現地で合っていたらボタンを押してください。',
      el('div', {}, [el('button', {
        class: 'btn btn--primary', type: 'button', text: '現地で確認した',
        onclick: () => {
          applyPatch({ id: s.id, verified: true, source: 'onsite' });
          toast('確認済みにしました');
          openDetail(s.id);
        },
      })]),
    ]),
    dl,
    el('div', { class: 'btnrow' }, [favBtn, visitBtn]),
    el('div', { class: 'btnrow' }, [
      el('button', {
        class: 'btn', type: 'button', text: 'マップで見る',
        onclick: () => {
          focusId = s.id;
          ui.view = 'map';
          saveUI();
          closeSheet();
          render();
        },
      }),
      el('button', { class: 'btn', type: 'button', text: '平面図で見る', onclick: () => openPlanViewer(s) }),
    ]),
    el('div', { class: 'btnrow' }, [
      floorPlanLink(s) ? el('a', {
        class: 'btn btn--ghost', href: floorPlanLink(s), target: '_blank', rel: 'noopener',
        text: '公式の平面図を開く',
      }) : null,
    ]),
    el('div', { class: 'btnrow' }, [
      el('a', { class: 'btn', href: gmapsLink(s), target: '_blank', rel: 'noopener', text: 'Googleマップ' }),
      el('a', { class: 'btn', href: tabelogLink(s), target: '_blank', rel: 'noopener', text: '食べログ検索' }),
    ]),
    el('div', { class: 'field' }, [el('label', { text: '自分の評価' }), myStars]),
    cloud.shared ? el('div', { class: 'field' }, [
      el('label', { text: 'みんなの記録' }), crowdSlot,
    ]) : null,
    el('div', { class: 'field' }, [el('label', { text: '自分のタグ' }), myTags]),
    el('div', { class: 'field' }, [el('label', { text: 'メモ（自動保存）' }), memo]),
    el('div', { class: 'field' }, [el('label', { text: '訪問履歴' }), visitsBox]),
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', text: '外部評価を更新', onclick: () => updateRating(s) }),
      el('button', { class: 'btn btn--ghost', type: 'button', text: '店情報を編集', onclick: () => openEditor(s) }),
    ]),
    // 削除は「閉じる」の隣に置かない。誤爆する位置なので編集画面の末尾へ移した
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', text: '閉じる', onclick: closeSheet }),
    ]),
  ]);

  function row(k, v) {
    return el('div', { class: 'detail-row' }, [el('dt', { text: k }), el('dd', { text: v })]);
  }

  // 店のデータは仲間が編集できるので、javascript: などは開かせない
  function linkRow(k, text, href) {
    const ok = /^(https?:|tel:)/i.test(href || '');
    return el('div', { class: 'detail-row' }, [
      el('dt', { text: k }),
      el('dd', {}, [ok
        ? el('a', { href: href, target: href.startsWith('tel:') ? null : '_blank', rel: 'noopener', text: text })
        : text]),
    ]);
  }

  // 営業時間や予算は、場所（出どころ）とは別に「ネットで調べた」ものかどうかを出す。
  // 古い情報を鵜呑みにしないよう、調べた日と出典をいっしょに見せる
  function infoRow(st) {
    const label = { websearch: 'ネットで調べた情報', official: '公式サイトの情報', onsite: '現地で確かめた情報', manual: 'アプリで入力した情報' }[st.infoSource]
      || st.infoSource;
    const ok = /^https?:/i.test(st.infoUrl || '');
    return el('div', { class: 'detail-row' }, [
      el('dt', { text: '店の情報' }),
      el('dd', {}, [
        label + (st.infoCheckedAt ? '（' + st.infoCheckedAt + '時点）' : ''),
        ok ? ' ' : null,
        ok ? el('a', { class: 'src', href: st.infoUrl, target: '_blank', rel: 'noopener', text: '出典' }) : null,
        st.infoNote ? el('p', { class: 'detail-note', text: st.infoNote }) : null,
      ]),
    ]);
  }
}

function siteLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return url;
  }
}

function updateRating(s) {
  const input = prompt('Googleマップなどの星（例: 3.8）。空で消去。', s.rating != null ? String(s.rating) : '');
  if (input === null) return;
  const raw = input.normalize('NFKC');  // 全角で打たれても読めるように
  const patch = { id: s.id };
  if (raw.trim() === '') {
    patch.rating = null;
    patch.ratingCount = null;
  } else {
    const v = Number(raw);
    if (!(v >= 0 && v <= 5)) { toast('0〜5の数値を入れてください'); return; }
    patch.rating = Math.round(v * 10) / 10;
    const cnt = prompt('レビュー件数（任意・空で消す）', s.ratingCount != null ? String(s.ratingCount) : '');
    // 空にしたのに前の件数が残ると、星は今日の値・件数は前回という嘘になる
    if (cnt !== null) {
      const v = Number(cnt.trim());
      patch.ratingCount = cnt.trim() === '' || !Number.isFinite(v) ? null : v;
    }
    patch.ratingSource = s.ratingSource || 'google';
    patch.ratingCheckedAt = todayStr();
  }
  applyPatch(patch);
  toast('外部評価を更新しました');
  openDetail(s.id);
}

function applyPatch(patch, defer) {
  const i = custom.findIndex((c) => c.id === patch.id);
  if (i < 0) custom.push(patch); else custom[i] = Object.assign({}, custom[i], patch);
  saveCustom();
  if (defer) { scheduleRefresh(); return; }
  rebuild();
  render();
}

// 星のまとめ入力では1件ごとに363件を描き直すと重い。まとめて1回にする
let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { rebuild(); render(); }, 400);
}

function removeStore(s) {
  if (!confirm(s.name + ' を一覧から消します。よろしいですか？')) return;
  if (!deleted.includes(s.id)) deleted.push(s.id);
  saveDeleted();
  rebuild();
  render();
  closeSheet();
  toast('削除しました');
}

/* ---------------- editor ---------------- */

function openEditor(s) {
  const isNew = !s;
  const draft = Object.assign(
    { id: '', name: '', kana: '', building: ui.buildings.length === 1 ? venueKey(ui.buildings[0]) : 1, floor: 'B2', block: '', category: '', tags: [], budget: '', hours: '', closedDays: [], pos: null },
    s || {}
  );

  const f = {};
  const mkField = (key, label, attrs) => {
    const input = el('input', Object.assign({ type: 'text', value: draft[key] == null ? '' : draft[key] }, attrs || {}));
    f[key] = input;
    return el('div', { class: 'field' }, [el('label', { text: label }), input]);
  };

  const selBuilding = el('select', {}, VENUES.map((v) =>
    el('option', { value: String(v.id), selected: String(draft.building) === String(v.id), text: v.name })));
  const selFloor = el('select', {}, FLOOR_ORDER.map((fl) =>
    el('option', { value: fl, selected: draft.floor === fl, text: fl })));
  const selCategory = el('select', {}, [el('option', { value: '', text: '—' })].concat(
    CATEGORIES.map((c) => el('option', { value: c, selected: draft.category === c, text: c }))));

  const tagBox = el('div', { class: 'tagpick' });
  let pickedTags = draft.tags.slice();
  const drawTags = () => {
    tagBox.textContent = '';
    const all = [...new Set(TAG_PRESETS.concat(pickedTags))];
    for (const t of all) {
      tagBox.appendChild(el('button', {
        class: 'chip' + (pickedTags.includes(t) ? ' is-on' : ''),
        type: 'button', text: t,
        onclick: () => {
          const i = pickedTags.indexOf(t);
          if (i < 0) pickedTags.push(t); else pickedTags.splice(i, 1);
          drawTags();
        },
      }));
    }
  };
  drawTags();

  const dowBox = el('div', { class: 'tagpick' });
  let picked = draft.closedDays.slice();
  const drawDow = () => {
    dowBox.textContent = '';
    for (const d of DOW.concat(['祝'])) {
      dowBox.appendChild(el('button', {
        class: 'chip' + (picked.includes(d) ? ' is-on' : ''),
        type: 'button', text: d,
        onclick: () => {
          const i = picked.indexOf(d);
          if (i < 0) picked.push(d); else picked.splice(i, 1);
          drawDow();
        },
      }));
    }
  };
  drawDow();

  const posX = el('input', { type: 'number', min: '0', value: draft.pos ? draft.pos.x : '' });
  const posY = el('input', { type: 'number', min: '0', value: draft.pos ? draft.pos.y : '' });

  const save = () => {
    const name = f.name.value.trim();
    if (!name) { toast('店名を入れてください'); return; }
    const x = Number(posX.value), y = Number(posY.value);
    const patch = {
      id: draft.id || 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      name,
      kana: f.kana.value.trim(),
      building: venueKey(selBuilding.value),
      floor: selFloor.value,
      block: f.block.value.trim(),
      category: selCategory.value,
      tags: pickedTags,
      budget: f.budget.value.trim(),
      hours: f.hours.value.trim(),
      closedDays: picked,
      gmapsUrl: f.gmapsUrl.value.trim(),
      pos: x > 0 && y > 0 ? { x, y } : null,
    };
    if (isNew) {
      patch.source = 'manual';
      patch.verified = false;
    }
    // 営業時間や予算を手で直したら、「ネットで調べた」という出どころはもう当てはまらない
    const infoEdited = ['budget', 'hours'].some((k) => (draft[k] || '') !== patch[k])
      || (draft.closedDays || []).join() !== picked.join();
    if (!isNew && draft.infoSource && infoEdited) {
      Object.assign(patch, { infoSource: 'manual', infoCheckedAt: todayStr(), infoUrl: '', infoNote: '' });
    }
    applyPatch(patch);
    closeSheet();
    // 絞り込みの外に入ると「登録しました」と出るのに一覧に出てこない。
    // 歩きながら登録する使い方と正面から衝突するので、見えるようにする
    const saved = stores.find((x) => x.id === patch.id);
    if (saved && !matches(saved)) {
      ui.buildings = []; ui.floors = []; ui.cats = []; ui.tags = []; ui.misc = [];
      ui.q = ''; $('#q').value = ''; $('#q-clear').hidden = true;
      saveUI();
      render();
      toast((isNew ? '登録しました' : '更新しました') + '（一覧に出すため絞り込みを解除しました）');
    } else {
      toast(isNew ? '登録しました' : '更新しました');
    }
  };

  openSheet([
    el('h2', { text: isNew ? '店を追加' : '店情報を編集' }),
    el('p', { class: 'sheet-sub', text: '保存先はこの端末のブラウザです。メニューから書き出してバックアップできます。' }),
    mkField('name', '店名 *'),
    mkField('kana', 'よみ（検索用・ひらがな）'),
    el('div', { class: 'field-2col' }, [
      el('div', { class: 'field' }, [el('label', { text: '場所' }), selBuilding]),
      el('div', { class: 'field' }, [el('label', { text: 'フロア' }), selFloor]),
    ]),
    el('div', { class: 'field-2col' }, [
      el('div', { class: 'field' }, [el('label', { text: '区画番号' }), (f.block = el('input', { type: 'text', value: draft.block || '' }))]),
      el('div', { class: 'field' }, [el('label', { text: 'カテゴリ' }), selCategory]),
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'タグ' }), tagBox]),
    el('div', { class: 'field-2col' }, [
      el('div', { class: 'field' }, [el('label', { text: '予算（例: 2000-3000）' }), (f.budget = el('input', { type: 'text', value: draft.budget || '' }))]),
      el('div', { class: 'field' }, [el('label', { text: '営業時間（例: 11:00-14:00,17:00-23:00）' }), (f.hours = el('input', { type: 'text', value: draft.hours || '' }))]),
    ]),
    el('div', { class: 'field' }, [el('label', { text: '定休日' }), dowBox]),
    el('div', { class: 'field' }, [
      el('label', { text: 'マップ上の位置（列X / 行Y・空なら未配置）' }),
      el('div', { class: 'field-2col' }, [
        el('div', { class: 'field' }, [posX]),
        el('div', { class: 'field' }, [posY]),
      ]),
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'GoogleマップURL（空なら店名で検索）' }), (f.gmapsUrl = el('input', { type: 'url', value: draft.gmapsUrl || '' }))]),
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn btn--primary', type: 'button', text: '保存', onclick: save }),
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'キャンセル', onclick: closeSheet }),
    ]),
    isNew ? null : el('div', { class: 'dangerzone' }, [
      el('button', { class: 'btn btn--ghost btn--danger', type: 'button', text: 'この店を一覧から消す', onclick: () => removeStore(s) }),
    ]),
  ]);
}

/* ---------------- menu / import / export ---------------- */

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a);
  a.click();
  // 0ms で捨てると、保存が始まる前に無効化されて何も保存されない端末がある
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
}

function mergedDataFile() {
  return JSON.stringify({
    version: 2,
    updatedAt: todayStr(),
    floors: base.floors,
    stores: stores.map((s) => {
      const o = Object.assign({}, s);
      delete o._n;
      return o;
    }),
  }, null, 2);
}

function openStarEntry() {
  // Google のフロア案内と違い、星は API では取れない（後述の理由）。
  // 手で入れる前提なので、1件ずつ詳細を開かずに済む一覧を用意する。
  const target = sorted(stores.filter(matches));
  const onlyEmpty = { v: true };
  const listBox = el('div', {});
  const progress = el('p', { class: 'sheet-sub', text: '' });

  const countDone = () => target.filter((s) => s.rating != null).length;

  const refreshProgress = () => {
    progress.textContent = '入力済み ' + countDone() + ' / ' + target.length + ' 件'
      + (target.length < stores.length ? '（いまの絞り込みの中だけ）' : '');
  };

  const draw = () => {
    listBox.textContent = '';
    const rows = onlyEmpty.v ? target.filter((s) => s.rating == null) : target;
    if (!rows.length) {
      listBox.appendChild(el('p', { class: 'sheet-sub', text: '対象がありません。' }));
      return;
    }
    for (const s of rows) {
      const id = s.id;
      const star = el('input', {
        type: 'text', inputmode: 'decimal', class: 'star-in',
        placeholder: '3.8', value: s.rating != null ? String(s.rating) : '',
      });
      const cnt = el('input', {
        type: 'text', inputmode: 'numeric', class: 'star-in star-in--cnt',
        placeholder: '件数', value: s.ratingCount != null ? String(s.ratingCount) : '',
      });
      const mark = el('span', { class: 'star-mark', text: s.rating != null ? '✓' : '' });

      const save = () => {
        const raw = star.value.trim().normalize('NFKC');
        const patch = { id: id };
        // 星が空のまま件数だけ打たれたときに消しにいくと、
        // 欄には数字が残るのに保存されない、という食い違いになる
        if (raw === '' && cnt.value.trim() !== '' && s.rating == null) {
          toast('先に星（例 3.8）を入れてください');
          star.focus();
          return;
        }
        if (raw === '') {
          patch.rating = null;
          patch.ratingCount = null;
        } else {
          const v = Number(raw);
          if (!(v >= 0 && v <= 5)) { toast('0〜5の数値を入れてください'); star.focus(); return; }
          patch.rating = Math.round(v * 10) / 10;
          const c = cnt.value.trim();
          const cv = Number(c);
          patch.ratingCount = c === '' || !Number.isFinite(cv) ? null : cv;
          patch.ratingSource = 'google';
          patch.ratingCheckedAt = todayStr();
        }
        applyPatch(patch, true);
        // 描画を後回しにしているぶん stores はまだ古い。
        // 進捗の数え直しはこの一覧の控えを見ているので、ここも合わせて更新する
        s.rating = patch.rating;
        s.ratingCount = patch.ratingCount !== undefined ? patch.ratingCount : s.ratingCount;
        mark.textContent = patch.rating != null ? '✓' : '';
        refreshProgress();
      };
      star.addEventListener('change', save);
      cnt.addEventListener('change', save);

      listBox.appendChild(el('div', { class: 'star-row' }, [
        el('div', { class: 'star-row-head' }, [
          el('span', { class: 'star-row-name', text: s.name }),
          el('span', { class: 'star-row-loc', text: venueShort(s.building) + ' ' + s.floor + (s.block ? ' / ' + s.block : '') }),
        ]),
        el('div', { class: 'star-row-ctl' }, [
          el('a', { class: 'btn btn--ghost', href: gmapsLink(s), target: '_blank', rel: 'noopener', text: 'Googleマップ' }),
          star, cnt, mark,
        ]),
      ]));
    }
  };

  const toggle = el('button', {
    class: 'btn btn--ghost', type: 'button', text: '未入力だけ ✓',
    onclick: () => {
      onlyEmpty.v = !onlyEmpty.v;
      toggle.textContent = onlyEmpty.v ? '未入力だけ ✓' : '未入力だけ';
      draw();
    },
  });

  refreshProgress();
  draw();

  openSheet([
    el('h2', { text: '星をまとめて入れる' }),
    el('p', { class: 'sheet-sub', text: 'Googleマップで見た星を手で入れます。「Googleマップ」を押して星を見て、戻って数字を入れる、の繰り返しです。確認した日付は自動で残ります。' }),
    progress,
    el('div', { class: 'btnrow' }, [
      toggle,
      el('button', { class: 'btn btn--ghost', type: 'button', text: '閉じる', onclick: () => { rebuild(); render(); closeSheet(); } }),
    ]),
    listBox,
  ]);
}

function openHerePicker() {
  const grid = el('div', { class: 'heregrid' });
  // 場所によって使っている階が違う（うめよこは B1 だけ）。
  // 全部の組み合わせを出すと空のマスばかりになるので、店がある階だけ出す
  for (const v of VENUES) {
    const floors = [...new Set(stores.filter((s) => String(s.building) === String(v.id)).map((s) => s.floor))]
      .sort((a, b) => FLOOR_ORDER.indexOf(a) - FLOOR_ORDER.indexOf(b));
    for (const f of floors) {
      const b = v.id;
      const on = !!ui.here && String(ui.here.building) === String(b) && ui.here.floor === f;
      const n = stores.filter((s) => String(s.building) === String(b) && s.floor === f).length;
      grid.appendChild(el('button', {
        class: 'herecell' + (on ? ' is-on' : '') + (n ? '' : ' is-empty'),
        type: 'button',
        onclick: () => {
          ui.here = on ? null : { building: b, floor: f };
          saveUI();
          render();
          closeSheet();
          toast(ui.here ? v.short + ' ' + f + ' を先頭に出します' : 'いまここを解除しました');
        },
      }, [
        el('span', { class: 'herecell-b', text: v.short }),
        el('span', { class: 'herecell-f', text: f }),
        el('span', { class: 'herecell-n', text: n + '件' }),
      ]));
    }
  }

  openSheet([
    el('h2', { text: 'いまここ' }),
    el('p', { class: 'sheet-sub', text: '地下は電波が届かず現在地が取れないので、いる場所を手で選びます。選んだフロアがリストとマップの先頭に来ます。絞り込みではないので、他のフロアも消えません。' }),
    grid,
    el('div', { class: 'btnrow' }, [
      ui.here ? el('button', {
        class: 'btn btn--ghost', type: 'button', text: '解除する',
        onclick: () => { ui.here = null; saveUI(); render(); closeSheet(); },
      }) : null,
      el('button', { class: 'btn btn--ghost', type: 'button', text: '閉じる', onclick: closeSheet }),
    ]),
  ]);
}

async function openPlanManager() {
  const seq = sheetSeq;
  const floors = [...new Set(stores.map((x) => x.floor))]
    .sort((a, b) => FLOOR_ORDER.indexOf(a) - FLOOR_ORDER.indexOf(b));
  let have = [];
  let storeBroken = false;
  try {
    have = await planKeys();
  } catch (e) {
    storeBroken = true;
    toast('この端末では平面図を保存できません（' + e.message + '）');
  }

  const file = el('input', { type: 'file', accept: 'image/*', hidden: 'hidden' });
  let pending = null;
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f || !pending) return;
    try {
      toast('取り込んでいます…');
      await planPut(planKey(pending.b, pending.f), await shrinkImage(f));
      toast(venueShort(pending.b) + ' ' + pending.f + ' の平面図を保存しました');
      openPlanManager();
    } catch (e) {
      toast('保存できませんでした: ' + e.message);
    }
  });

  const rows = el('div', {});
  for (const v of VENUES) {
    const b = v.id;
    const vFloors = [...new Set(stores.filter((x) => String(x.building) === String(b)).map((x) => x.floor))]
      .sort((a, c) => FLOOR_ORDER.indexOf(a) - FLOOR_ORDER.indexOf(c));
    for (const f of vFloors) {
      const key = planKey(b, f);
      const has = have.includes(key);
      const bundled = !!bundledPlanUrl(key);
      const state = has ? '差し替え済み' : (bundled ? 'アプリに同梱' : '未取り込み');
      rows.appendChild(el('div', { class: 'planrow' }, [
        el('span', { class: 'planrow-name', text: venueShort(b) + ' ' + f }),
        el('span', { class: 'planrow-state' + (has || bundled ? ' is-on' : ''), text: state }),
        el('button', {
          class: 'btn btn--ghost', type: 'button', text: has || bundled ? '差し替え' : '取り込む',
          onclick: () => { pending = { b: b, f: f }; file.click(); },
        }),
        has ? el('button', {
          class: 'btn btn--ghost btn--danger', type: 'button',
          text: bundled ? '同梱のものに戻す' : '消す',
          onclick: async () => {
            try { await planDel(key); } catch (e) { toast('消せませんでした: ' + e.message); }
            openPlanManager();
          },
        }) : null,
      ]));
    }
  }

  if (seq !== sheetSeq) return; // 読み込み中に閉じられた
  openSheet([
    el('h2', { text: 'フロアの平面図' }),
    el('p', { class: 'sheet-sub', text: '店の詳細から平面図を開いて「区画番号がどこか」をその場で確かめられます。手に入っているフロアの図はアプリに同梱してあるので、取り込まなくてもそのまま見られます。' }),
    el('p', { class: 'sheet-sub', text: '同梱していないフロア（下の「未取り込み」）は、公式サイトの平面図を長押しして保存 → ここで選ぶと使えるようになります。取り込んだ画像はこの端末の中だけに保存され、どこにも送られません。' }),
    storeBroken ? el('div', { class: 'banner', text: 'この端末では画像を保存できません。プライベートブラウズを使っていると保存領域が使えないことがあります。' }) : null,
    file,
    rows,
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', text: '閉じる', onclick: closeSheet }),
    ]),
  ]);
}

// 公式の平面図に書かれている区画番号が、図のどこにあるか（縦横の割合）。
// plans/blocks.json から読む。無くても動く（自動ピンが出ないだけ）。
let blockSpots = null;
let blockSpotsPromise = null;

function loadBlockSpots() {
  if (blockSpots) return Promise.resolve(blockSpots);
  if (!blockSpotsPromise) {
    blockSpotsPromise = fetch('plans/blocks.json')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((j) => { blockSpots = j || {}; return blockSpots; });
  }
  return blockSpotsPromise;
}

// 区画番号の「枝番の親」。23-1 も 23-2 も、元は同じ 23 の区画。
function blockRoot(block) {
  return String(block || '').split('-')[0];
}

// その店の区画が図のどこかを返す。ぴったり無ければ、同じ親番号の
// 区画（たとえば 49 に対する 49-1）でだいたいの位置を返す。
function findBlockSpot(key, block) {
  const table = (blockSpots || {})[key];
  const b = String(block || '');
  if (!table || !b) return null;
  if (table[b]) return { pos: table[b], exact: true, label: b };
  const root = blockRoot(b);
  if (!root) return null;
  const near = Object.keys(table)
    .filter((k) => blockRoot(k) === root)
    .sort();
  if (!near.length) return null;
  return { pos: table[near[0]], exact: false, label: near[0] };
}

// 平面図を開いて、その店の場所にピンを置けるようにする。
// 350件ぶんの座標を machine で当てるのは無理なので、歩きながら1件ずつ
// 置いてもらう。置いた位置は端末内（user[id].pin）に残る。
async function openPlanViewer(store) {
  const seq = sheetSeq;
  const key = planKey(store.building, store.floor);
  const [got] = await Promise.all([planResolve(key), loadBlockSpots()]);
  if (seq !== sheetSeq) return; // 読み込み中に閉じられた
  const url = got.url;
  if (!url) {
    if (got.error) {
      // 「まだありません」で取り込み画面に送ると、保存できない端末では往復し続ける
      toast('この端末では平面図を保存できません（' + got.error.message + '）');
      return;
    }
    toast(venueShort(store.building) + ' ' + store.floor + ' の平面図がまだありません');
    openPlanManager();
    return;
  }

  const ud = u(store.id);
  let placing = false;
  const img = el('img', { class: 'planimg', src: url, alt: '平面図' });
  const pin = el('div', { class: 'planpin', hidden: 'hidden' }, [el('span', { text: '▼' })]);

  // 区画番号から割り出した位置。自分で置いたピンとは別の印にして、
  // 「番号から出した目安」であることが見て分かるようにする
  const auto = got.kind === 'bundled' ? findBlockSpot(key, store.block) : null;
  const autoPin = el('div', { class: 'planauto', hidden: 'hidden' }, [
    el('span', { class: 'planauto-dot' }),
    el('span', { class: 'planauto-tag', text: auto ? auto.label : '' }),
  ]);
  if (auto) {
    autoPin.hidden = false;
    autoPin.style.left = (auto.pos[0] * 100) + '%';
    autoPin.style.top = (auto.pos[1] * 100) + '%';
  }

  const stage = el('div', { class: 'planstage' }, [img, autoPin, pin]);
  const scroller = el('div', { class: 'planscroll' }, [stage]);

  // 削除ボタンは常に作って出し入れする。開いた瞬間の状態で作ると、
  // その場で初めて置いたピンを消せない
  const delBtn = el('button', {
    class: 'btn btn--ghost btn--danger', type: 'button', text: 'ピンを消す',
    onclick: () => {
      delete ud.pin;
      saveUser();
      placing = false;
      stage.classList.remove('is-placing');
      placeBtn.textContent = 'ここだ！とピンを置く';
      drawPin();
      toast('ピンを消しました');
    },
  });

  const drawPin = () => {
    if (ud.pin) {
      pin.hidden = false;
      pin.style.left = (ud.pin.x * 100) + '%';
      pin.style.top = (ud.pin.y * 100) + '%';
    } else {
      pin.hidden = true;
    }
    delBtn.hidden = !ud.pin;
  };

  stage.addEventListener('click', (e) => {
    if (!placing) return;
    const r = img.getBoundingClientRect();
    ud.pin = {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
    saveUser();
    placing = false;
    stage.classList.remove('is-placing');
    placeBtn.textContent = 'ピンを置き直す';
    drawPin();
    toast('位置を覚えました');
  });

  const placeBtn = el('button', {
    class: 'btn btn--primary', type: 'button', text: ud.pin ? 'ピンを置き直す' : 'ここだ！とピンを置く',
    onclick: () => {
      placing = !placing;
      stage.classList.toggle('is-placing', placing);
      placeBtn.textContent = placing ? '図の上をタップ（やめる）' : (ud.pin ? 'ピンを置き直す' : 'ここだ！とピンを置く');
    },
  });

  let zoomed = false;
  const zoomBtn = el('button', {
    class: 'btn btn--ghost', type: 'button', text: '拡大',
    onclick: () => {
      zoomed = !zoomed;
      stage.classList.toggle('is-zoom', zoomed);
      zoomBtn.textContent = zoomed ? '縮小' : '拡大';
    },
  });

  drawPin();

  openSheet([
    el('h2', { text: store.name }),
    el('p', { class: 'sheet-sub' }, [
      el('strong', { text: venueShort(store.building) + ' ' + store.floor }),
      store.block ? el('strong', { class: 'planblock', text: '区画 ' + store.block }) : null,
      el('span', {
        text: !store.block ? '　区画番号が未登録です'
          : auto && auto.exact ? '　図の○印がその区画です'
          : auto ? '　図の○印は区画' + auto.label + '。その並びにあります'
          : '　この番号を図の中から探してください',
      }),
    ]),
    scroller,
    el('div', { class: 'btnrow' }, [placeBtn, zoomBtn]),
    el('div', { class: 'btnrow' }, [
      delBtn,
      el('button', { class: 'btn btn--ghost', type: 'button', text: '閉じる', onclick: () => openDetail(store.id) }),
    ]),
  ]);
}

// 仲間の一覧と、自分の名前・合言葉の変更
function groupBox() {
  const ids = Object.keys(memberNames);
  if (myId() && !ids.includes(myId())) ids.push(myId());
  return el('div', { class: 'field' }, [
    el('label', { text: '仲間（' + ids.length + '人）' }),
    el('ul', { class: 'crowd' }, ids.map((id) => el('li', { class: 'crowd-row' + (id === myId() ? ' is-me' : '') }, [
      el('span', { class: 'crowd-name', text: memberLabel(id) + (id === myId() ? '（自分）' : '') }),
    ]))),
    el('div', { class: 'btnrow' }, [
      el('button', {
        class: 'btn btn--ghost', type: 'button', text: '自分の名前を変える',
        onclick: async () => {
          const v = prompt('みんなに見える名前', (me && me.name) || '');
          if (v === null) return;
          const name = v.trim().slice(0, 20);
          if (!name) { toast('名前は空にできません'); return; }
          me.name = name;
          saveMe();
          await publishMe();
          toast('名前を変えました');
          openMenu();
        },
      }),
      el('button', {
        class: 'btn btn--ghost', type: 'button', text: '合言葉を変える',
        onclick: async () => {
          const v = prompt('新しい合言葉（4文字以上）。今までの合言葉で入った端末も、次から聞かれます。');
          if (v === null) return;
          const pass = v.trim();
          if (pass.length < 4) { toast('4文字以上にしてください'); return; }
          const hash = await sha256hex(pass);
          try {
            await cloud.config.set({ passHash: hash, t: Date.now() });
            me.ok = hash;
            saveMe();
            toast('合言葉を変えました');
          } catch (e) {
            toast('変えられませんでした: ' + (e.message || '権限がないようです'));
          }
        },
      }),
    ]),
  ]);
}

function openMenu() {
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importPayload(JSON.parse(String(reader.result)));
      } catch (e) {
        toast('読み込めませんでした: ' + e.message);
      }
    };
    reader.readAsText(file);
  });

  const unverified = stores.filter((s) => !s.verified).length;

  openSheet([
    el('h2', { text: 'メニュー' }),
    el('p', { class: 'sheet-sub', text: 'お気に入り・メモ・追加した店は、この端末のブラウザに保存されています。バックアップには取り込んだ平面図は含まれません（画像が大きいため）。' }),
    el('div', { class: 'syncline' + (cloud.on ? ' is-on' : '') }, [
      el('span', { class: 'syncdot' }),
      el('span', { text: cloud.on
        ? (cloud.shared ? '同期中 — PC・スマホ・仲間と共有しています' : '同期中 — PCとスマホで同じ記録になります')
        : (cloud.status || 'この端末だけに保存中（同期していません）') }),
    ]),
    cloud.shared ? groupBox() : null,
    unverified ? el('div', { class: 'banner' }, [
      '未確認の店が ' + unverified + ' 件あります。階や区画の裏が取れていないので、現地で確認したら詳細画面のボタンを押してください。',
      el('div', {}, [el('button', {
        class: 'btn btn--ghost', type: 'button', text: '未確認だけ表示',
        onclick: () => {
          if (!ui.misc.includes('unverified')) ui.misc.push('unverified');
          saveUI();
          closeSheet();
          render();
        },
      })]),
    ]) : null,
    el('div', { class: 'btnrow' }, [
      el('button', {
        class: 'btn btn--primary', type: 'button', text: '星をまとめて入れる',
        onclick: () => openStarEntry(),
      }),
    ]),
    el('div', { class: 'btnrow' }, [
      el('button', {
        class: 'btn', type: 'button', text: 'フロアの平面図',
        onclick: () => openPlanManager(),
      }),
    ]),
    el('div', { class: 'btnrow' }, [
      el('button', {
        class: 'btn', type: 'button', text: 'バックアップを書き出す',
        onclick: () => {
          download('ekimae-backup-' + todayStr() + '.json',
            JSON.stringify({ kind: 'ekimae-backup', version: 1, user, custom, deleted }, null, 2));
        },
      }),
      el('button', { class: 'btn', type: 'button', text: '読み込む', onclick: () => fileInput.click() }),
    ]),
    el('div', { class: 'btnrow' }, [
      el('button', {
        class: 'btn btn--ghost', type: 'button', text: 'stores.json 形式で書き出す',
        onclick: () => download('stores.json', mergedDataFile()),
      }),
    ]),
    el('p', { class: 'sheet-sub', text: '書き出した stores.json を ekimae/data/stores.json に置いて公開すると、全員がその店リストを見られます。' }),
    el('div', { class: 'field' }, [
      el('label', { text: 'CSVで一括登録（1行目の見出しから列を判別します。店名・区画・業種・タグ・予算・営業時間・定休日・よみ・電話・URL に対応）' }),
      csvBox(),
    ]),
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', text: '閉じる', onclick: closeSheet }),
      el('button', {
        class: 'btn btn--ghost btn--danger', type: 'button', text: 'この端末の記録を全消去',
        onclick: () => {
          if (!confirm('お気に入り・メモ・追加した店・取り込んだ平面図をすべて消します。元に戻せません。')) return;
          localStorage.removeItem(KEY.user);
          localStorage.removeItem(KEY.custom);
          localStorage.removeItem(KEY.deleted);
          localStorage.removeItem(KEY.ui);
          user = {}; custom = []; deleted = [];
          ui = sanitizeUI({});
          // 取り込んだ平面図も端末内の記録。残すと数MBが居座り続ける
          planKeys().then((ks) => Promise.all(ks.map(planDel))).catch(() => {});
          rebuild();
          render();
          closeSheet();
          toast('消去しました');
        },
      }),
    ]),
    fileInput,
  ]);
}

function csvBox() {
  const ta = el('textarea', {
    placeholder: '区画,店名,業種\n68,立呑パーラー 西澤商店,立ち飲み\n\n1行目に見出しがあれば、並び順は問いません。',
  });

  // 見出しに ビル / フロア が無いCSV（data/stores.template.csv がそう）を
  // 貼ったときに、どこの階として入れるかを決める
  const selB = el('select', {}, VENUES.map((v) => el('option', { value: String(v.id), text: v.name })));
  const selF = el('select', {}, ['B2', 'B1', '1F', '2F'].map((f) => el('option', { value: f, text: f })));

  const run = () => {
    const b = Number(selB.value), f = selF.value;
    let read;
    try {
      read = readCSV(ta.value, b, f);
    } catch (e) {
      toast('読み取れませんでした: ' + e.message);
      return;
    }
    if (!read.items.length) {
      toast(read.skipped.length ? '取り込める行がありませんでした（' + read.skipped[0].why + '）' : '中身が空です');
      return;
    }
    // 列の取り違えに気づけないまま登録されるのが一番困るので、必ず一度見せる
    const first = read.items[0];
    const sample = '1行目はこう読みました:\n'
      + '  店名: ' + first.name + '\n'
      + '  場所: ' + venueShort(first.building) + ' ' + first.floor + (first.block ? ' / ' + first.block : '') + '\n'
      + '  業種: ' + (first.category || '—') + '\n'
      + '  タグ: ' + (first.tags.join('、') || '—') + '\n\n';
    const skipNote = read.skipped.length
      ? read.skipped.length + '行は飛ばします（' + read.skipped.slice(0, 3).map((x) => x.why).join('、') + '）\n'
      : '';
    const noteText = read.notes.length ? read.notes.join('\n') + '\n' : '';
    if (!confirm(read.items.length + '件を取り込みます（' + read.mode + '）。\n\n' + sample + noteText + skipNote + '続けますか？')) return;

    const r = applyCSV(read.items);
    ta.value = '';
    toast('新規 ' + r.added + '件 / 更新 ' + r.updated + '件');
  };

  return el('div', {}, [
    ta,
    el('div', { class: 'csvwhere' }, [
      el('span', { text: '見出しに ビル / フロア が無いとき:' }),
      selB, selF,
    ]),
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'CSVを取り込む', onclick: run }),
    ]),
  ]);
}

// 列の見出しの揺れ。tools/ingest.py の ALIASES と合わせてある
const CSV_ALIASES = {
  name: ['name', '店名', '店舗名', '名称'],
  kana: ['kana', 'よみ', 'ヨミ', 'かな', '読み'],
  building: ['building', 'venue', '場所', '施設', 'ビル', '建物', '号館'],
  floor: ['floor', 'フロア', '階'],
  block: ['block', '区画', '区画番号', '号', '室'],
  category: ['category', '業種', 'カテゴリ', 'ジャンル', '種別'],
  tags: ['tags', 'タグ'],
  budget: ['budget', '予算'],
  hours: ['hours', '営業時間', '時間'],
  closedDays: ['closeddays', '定休日', '休み', '休'],
  phone: ['phone', 'tel', '電話', '電話番号'],
  url: ['url', 'サイト', 'ホームページ', 'hp'],
};

// 見出しが無いときの並び。CSV欄のラベルと揃えること
// CSV の「場所」欄。番号・正式名・略称・キーのどれでも受ける
function readVenueCell(raw, fallback) {
  const t = String(raw == null ? '' : raw).normalize('NFKC').trim();
  if (!t) return fallback;
  const hit = VENUES.find((v) => String(v.id) === t || v.short === t || v.name === t);
  if (hit) return hit.id;
  const digits = t.replace(/[^0-9]/g, '');
  const n = Number(digits);
  if (digits && venueOf(n)) return n;
  return null;
}

const CSV_POSITIONS = ['name', 'building', 'floor', 'block', 'category', 'tags', 'budget', 'hours', 'closedDays'];

// 引用符に対応した CSV/TSV の読み取り。
// 単純な split(',') だと "11:00-14:30,17:00-22:00" のような値が割れる
function parseCSV(text) {
  const src = String(text).replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

function headerField(raw) {
  const k = String(raw || '').normalize('NFKC').trim().toLowerCase();
  if (!k) return null;
  for (const field in CSV_ALIASES) {
    if (CSV_ALIASES[field].some((a) => a.toLowerCase() === k)) return field;
  }
  return null;
}

const splitList = (v) => String(v || '').split(/[|,、]/).map((x) => x.trim()).filter(Boolean);

/* CSV を読み取って、取り込む内容を組み立てる（まだ保存はしない）。

   以前は列の位置で決め打ちしていたため、README が案内している
   data/stores.template.csv（見出しが 区画,店名,よみ,… で並びも違う）を
   貼ると、見出し行まで店として登録され、店名の欄に「区画」が入るなど
   デタラメな行が端末に残っていた。見出しから列を判別する。 */
function readCSV(text, fallbackBuilding, fallbackFloor) {
  const rows = parseCSV(text);
  if (!rows.length) return { items: [], skipped: [], mode: '' };

  const mapped = rows[0].map(headerField);
  const hasHeader = mapped.some(Boolean);
  const map = hasHeader ? mapped : CSV_POSITIONS;
  const body = hasHeader ? rows.slice(1) : rows;

  // 読めなかった見出しは、その列が丸ごと捨てられる。黙って捨てると
  // 「ビルディング」と書いただけで全部が第1ビルに化ける
  const unknown = hasHeader
    ? rows[0].filter((h, i) => h !== '' && !mapped[i])
    : [];

  const items = [], skipped = [], notes = [];
  if (unknown.length) notes.push('読めない見出し: ' + unknown.join('、'));
  for (const r of body) {
    const rec = {};
    r.forEach((cell, i) => { if (map[i] && cell !== '') rec[map[i]] = cell; });
    if (!rec.name) { skipped.push({ row: r.join(','), why: '店名が空' }); continue; }

    // 「３」「第3ビル」「バルチカ03」「gg03」のどれでも受ける。
    // 全角を直してから読まないと「３」が読めず、既定の場所に化けたまま
    // 不正としても弾かれない
    const building = readVenueCell(rec.building, fallbackBuilding);
    if (rec.building && building === null) {
      skipped.push({ row: rec.name, why: '場所が読めない（' + rec.building + '）' });
      continue;
    }
    const floor = String(rec.floor || fallbackFloor).normalize('NFKC').toUpperCase();
    if (!FLOOR_ORDER.includes(floor)) { skipped.push({ row: rec.name, why: 'フロアが不正（' + floor + '）' }); continue; }

    if (rec.category && !CATEGORIES.includes(rec.category)) notes.push('業種「' + rec.category + '」は一覧に無いので空にします');
    const closed = splitList(rec.closedDays);
    const closedOk = closed.filter((d) => DOW.includes(d) || d === '祝');
    if (closed.length !== closedOk.length) notes.push('定休日は 日月火水木金土祝 のみ（' + closed.filter((d) => !closedOk.includes(d)).join('、') + ' を無視）');

    items.push({
      id: makeId(building, floor, rec.name),
      name: rec.name,
      kana: rec.kana || '',
      building: building,
      floor: floor,
      block: rec.block || '',
      category: CATEGORIES.includes(rec.category) ? rec.category : '',
      tags: splitList(rec.tags),
      budget: rec.budget || '',
      hours: rec.hours || '',
      closedDays: closedOk,
      phone: rec.phone || '',
      url: rec.url || '',
    });
  }
  // 同じビル・フロア・店名は同じ ID になるので1件にまとまる。
  // 「2件を取り込みます」と言って1件しかできないと混乱する
  const uniq = new Map();
  for (const it of items) uniq.set(it.id, it);
  if (uniq.size !== items.length) notes.push((items.length - uniq.size) + '行は同じ店なのでまとめます');
  return {
    items: [...uniq.values()], skipped: skipped,
    notes: [...new Set(notes)],
    mode: hasHeader ? '見出しあり' : '位置で判別',
  };
}

function applyCSV(items) {
  const baseIds = new Set(base.stores.map((x) => x.id));
  let added = 0, updated = 0;
  for (const it of items) {
    const i = custom.findIndex((c) => c.id === it.id);
    // 配布データに同じ店があるなら、全部を上書きせず、書いてある項目だけ足す
    const payload = baseIds.has(it.id)
      ? Object.keys(it).reduce((o, k) => {
        const v = it[k];
        if (k === 'id' || (Array.isArray(v) ? v.length : v !== '')) o[k] = v;
        return o;
      }, {})
      : Object.assign({}, it, { pos: null, source: 'manual', verified: false });
    if (i < 0) { custom.push(payload); added++; } else { custom[i] = Object.assign({}, custom[i], payload); updated++; }
  }
  if (added || updated) { saveCustom(); rebuild(); render(); }
  return { added: added, updated: updated };
}

function importPayload(data) {
  if (data && data.kind === 'ekimae-backup') {
    if (!confirm('バックアップを読み込みます。現在の記録は置き換わります。')) return;
    // 中身を検めずに保存すると、壊れた値が端末に残って次回起動から開けなくなる
    if ((data.user && typeof data.user !== 'object') || (data.custom && !Array.isArray(data.custom))
        || (data.deleted && !Array.isArray(data.deleted))) {
      toast('バックアップの中身が壊れています');
      return;
    }
    user = data.user || {};
    custom = (data.custom || []).filter((c) => c && c.id);
    deleted = (data.deleted || []).filter((x) => typeof x === 'string');
    saveUser(); saveCustom(); saveDeleted();
    rebuild();
    render();
    closeSheet();
    toast('バックアップを読み込みました');
    return;
  }
  if (data && Array.isArray(data.stores)) {
    if (!confirm(data.stores.length + '件の店データを、この端末の中にまるごと取り込みます。\n'
        + '以後この端末では、取り込んだ内容が優先され、配布側の店リストを直しても反映されなくなります。\n'
        + '続けますか？')) return;
    // 形を検めてから入れる。壊れた行をそのまま保存すると、
    // この場は失敗に見えるのに次回起動で開けなくなり、記録ごと失う
    const ok = [], bad = [];
    for (const s of data.stores) {
      if (!s || typeof s !== 'object' || !s.id || !s.name) { bad.push(s); continue; }
      if (!venueOf(s.building)) { bad.push(s); continue; }
      if (!FLOOR_ORDER.includes(String(s.floor))) { bad.push(s); continue; }
      ok.push(Object.assign({}, s, {
        building: venueKey(s.building),
        tags: Array.isArray(s.tags) ? s.tags : [],
        aliases: Array.isArray(s.aliases) ? s.aliases : [],
        closedDays: Array.isArray(s.closedDays) ? s.closedDays : [],
      }));
    }
    if (!ok.length) { toast('取り込める店がありませんでした（' + bad.length + '件が不正）'); return; }
    for (const s of ok) {
      const i = custom.findIndex((c) => c.id === s.id);
      if (i < 0) custom.push(s); else custom[i] = s;
      const di = deleted.indexOf(s.id);
      if (di >= 0) deleted.splice(di, 1);
    }
    saveCustom(); saveDeleted();
    if (bad.length) toast(bad.length + '件は形が違うので飛ばしました');
    rebuild();
    render();
    closeSheet();
    toast('取り込みました');
    return;
  }
  toast('対応していないファイルです');
}

/* ---------------- wiring ---------------- */

function bind() {
  const q = $('#q');
  q.value = ui.q;
  $('#q-clear').hidden = !ui.q;
  let t;
  q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      ui.q = q.value;
      $('#q-clear').hidden = !ui.q;
      saveUI();
      render();
    }, 120);
  });
  $('#q-clear').addEventListener('click', () => {
    q.value = ''; ui.q = ''; $('#q-clear').hidden = true; saveUI(); render(); q.focus();
  });

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => { ui.view = tab.dataset.view; saveUI(); render(); });
  }

  const sortSel = $('#sort');
  sortSel.value = ui.sort;
  sortSel.addEventListener('change', () => { ui.sort = sortSel.value; saveUI(); render(); });

  // 条件を変えるたびに閉じて確かめる往復が要らないよう、ここで件数を返す
  $('#btn-apply').addEventListener('click', (e) => {
    if (e.currentTarget.dataset.zero === '1') {
      ui.buildings = []; ui.floors = []; ui.cats = []; ui.tags = []; ui.misc = [];
      saveUI();
      render();
      return;
    }
    closeSheet();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  for (const key of ['category', 'tag']) {
    $('#more-' + key).addEventListener('click', () => {
      $('#f-' + key).classList.toggle('is-collapsed');
      syncChipsMore(key);
    });
  }

  $('#btn-add').addEventListener('click', () => openEditor(null));
  $('#btn-menu').addEventListener('click', openMenu);

  document.addEventListener('click', trackPoint, true);
  document.addEventListener('touchstart', trackPoint, { capture: true, passive: true });
  window.addEventListener('resize', detectEmbedded);

  $('#sheet').addEventListener('click', (e) => { if (e.target.hasAttribute('data-close')) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
}

async function boot() {
  bind();
  try {
    const res = await fetch('data/stores.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    base = await res.json();
    if (!Array.isArray(base.stores)) base.stores = [];
  } catch (e) {
    base = { floors: {}, stores: [] };
    toast('初期データを読めませんでした（' + e.message + '）');
  }
  // 端末内の記録が壊れていると、ここで落ちて画面が空のままになる。
  // そうなるとブラウザのデータ削除以外に戻す手段が無くなるので、拾って案内する
  try {
    rebuild();
    render();
  } catch (e) {
    if (confirm('端末内に保存した記録が壊れていて、開けませんでした。\n'
        + '記録（お気に入り・メモ・追加した店）を消して開き直しますか？\n\n' + e.message)) {
      // 画面の状態（ui）が壊れている場合もここに来る。消し忘れると
      // 記録だけ消えて画面は空のまま、という最悪の結果になる
      localStorage.removeItem(KEY.user);
      localStorage.removeItem(KEY.custom);
      localStorage.removeItem(KEY.deleted);
      localStorage.removeItem(KEY.ui);
      user = {}; custom = []; deleted = [];
      ui = sanitizeUI({});
      rebuild();
      render();
    } else {
      throw e;
    }
  }

  // Artifact として開いたときは、合言葉の確認が済むまで中身を見せない。
  // ローカルや GitHub Pages では claude が無いので、のれんは出さない
  if (typeof window.claude !== 'undefined' && window.claude.use) gateWaiting();

  // 区画の位置表（マップを平面図で出すのに要る）。届いたら描き直す。
  // 読めなくてもアプリは動く（マップが昔の区画番号順の並びに戻るだけ）
  loadBlockSpots().then(() => { if (ui.view === 'map') render(); }).catch(() => {});

  // 同期は画面が出たあとに静かに始める。使えない場所では何も起きない
  initCloud().catch(() => {});

  // manifest を宣言しているページ（=デプロイ版）でだけ Service Worker を使う。
  // 埋め込み表示などでは古いキャッシュが残って更新が届かなくなるため登録しない。
  const hasManifest = document.querySelector('link[rel="manifest"]');
  if (hasManifest && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
