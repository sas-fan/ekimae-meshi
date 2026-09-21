/* 駅前ビル飯 — 大阪駅前ビルの飲食店マップ (vanilla JS / 静的ホスティング前提) */
'use strict';

const NS = 'ekimae.v1';
const KEY = {
  user: NS + '.user',
  custom: NS + '.custom',
  deleted: NS + '.deleted',
  ui: NS + '.ui',
};

const BUILDINGS = [1, 2, 3, 4];
const FLOOR_ORDER = ['B2', 'B1', '1F', '2F', '3F'];

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
const UI_DEFAULTS = {
  view: 'list', sort: 'default', q: '',
  buildings: [], floors: [], cats: [], tags: [], misc: [],
  filtersOpen: false, here: null,
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
      if (v && typeof v === 'object' && BUILDINGS.includes(Number(v.building)) && typeof v.floor === 'string') {
        out.here = { building: Number(v.building), floor: v.floor };
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

const saveUser = () => writeJSON(KEY.user, user);
const saveCustom = () => writeJSON(KEY.custom, custom);
const saveDeleted = () => writeJSON(KEY.deleted, deleted);
const saveUI = () => writeJSON(KEY.ui, ui);

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
    building: Number(s.building) || 1,
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
  return !!ui.here && s.building === ui.here.building && s.floor === ui.here.floor;
}

// 並べ替えの鍵。区画番号は「28」と「28-1」で長さが変わるので、
// 数値の並びと店名を分けて持つ。混ぜると数値と文字列を突き合わせることになり、
// 比較が非対称になって Array.sort の結果が壊れる。
function sortKey(s) {
  const fi = FLOOR_ORDER.indexOf(s.floor);
  return {
    nums: [isHere(s) ? 0 : 1, s.building, fi < 0 ? 99 : fi, ...blockKey(s.block)],
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
  if (ui.sort === 'rating') {
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
  const q = s.name + ' 大阪駅前第' + s.building + 'ビル';
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
  return (byFloor && byFloor[s.floor]) || null;
}

function tabelogLink(s) {
  const q = s.name + ' 大阪駅前第' + s.building + 'ビル 食べログ';
  return 'https://www.google.com/search?q=' + encodeURIComponent(q);
}

/* ---------------- filter chips ---------------- */

function renderChips() {
  const mk = (container, items, selected, onToggle) => {
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

  mk($('#f-building'), BUILDINGS.map((b) => ({ value: String(b), label: '第' + b })), ui.buildings, (v) => toggle(ui.buildings, v));

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

function storeCard(s) {
  const ud = user[s.id] || {};
  const open = isOpenNow(s);
  const meta = [
    el('span', { text: '第' + s.building + ' ' + s.floor + (s.block ? ' / ' + s.block : '') }),
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
      ud.rating ? el('span', { class: 'card-fav', text: '自' + ud.rating }) : null,
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
    return Number(ab) - Number(bb) || FLOOR_ORDER.indexOf(af) - FLOOR_ORDER.indexOf(bf);
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
      el('span', { class: 'gridcell-sub' }, [
        el('span', { text: s.block || s.category || '' }),
        s.rating ? el('span', { text: s.rating.toFixed(1) }) : null,
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
        el('span', { text: '第' + b + 'ビル ' + f + '　該当 ' + hitCount + ' / ' + list.length + '件' }),
      ]),
    ]);

    if (placed.length) {
      const cols = Math.max(4, ...placed.map((s) => s.pos.x + ((s.w || 1) - 1)));
      const grid = el('div', { class: 'grid', style: 'grid-template-columns: repeat(' + cols + ', var(--cell));' });
      for (const s of placed) grid.appendChild(cell(s, false));
      group.appendChild(el('div', { class: 'gridwrap' }, [grid]));
    }

    // 座標が未設定のうちは区画番号順に並べる。歩く順番におおむね一致する。
    if (flow.length) {
      group.appendChild(el('p', { class: 'gridnote', text: (placed.length ? '以下は' : '') + '区画番号順（実配置は未設定）' }));
      const g = el('div', { class: 'grid grid--flow' });
      for (const s of flow) g.appendChild(cell(s, true));
      group.appendChild(g);
    }

    box.appendChild(group);
  }

  if (focusId) {
    const cellEl = box.querySelector('.gridcell.is-focus');
    const target = focusId;
    focusId = null;
    if (cellEl) {
      // レイアウト確定後でないと位置がずれる
      requestAnimationFrame(() => {
        cellEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        const wrap = cellEl.closest('.gridwrap');
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

function syncFilterBar() {
  const n = activeFilterCount();
  const badge = $('#f-count');
  badge.textContent = n ? String(n) : '';
  badge.hidden = !n;
  $('#filters').hidden = !ui.filtersOpen;
  $('#btn-filters').setAttribute('aria-expanded', String(ui.filtersOpen));
  // パネルが閉じている間は高さが 0 なので、はみ出しを測れない。開いた直後に測り直す
  if (ui.filtersOpen) { syncChipsMore('category'); syncChipsMore('tag'); }
  $('#btn-reset').hidden = !(n || ui.q || ui.here);
  const here = $('#btn-here');
  here.textContent = ui.here ? '第' + ui.here.building + ' ' + ui.here.floor : 'いまここ';
  here.classList.toggle('is-on', !!ui.here);
  renderActiveFilters();
}

// パネルを閉じると「絞り込み ①」としか出ず、何で絞ったのか分からなかった。
// 選択中の条件を常に並べ、その場で外せるようにする。
function renderActiveFilters() {
  const box = $('#active-filters');
  box.textContent = '';
  const items = []
    .concat(ui.buildings.map((v) => ({ label: '第' + v, drop: () => remove(ui.buildings, v) })))
    .concat(ui.floors.map((v) => ({ label: v, drop: () => remove(ui.floors, v) })))
    .concat(ui.cats.map((v) => ({ label: v, drop: () => remove(ui.cats, v) })))
    // 種類とタグは同じ名前がある（立ち飲みなど）ので、タグ側に # を付けて区別する
    .concat(ui.tags.map((v) => ({ label: '#' + v, drop: () => remove(ui.tags, v) })))
    .concat(ui.misc.map((v) => {
      const m = MISC_FILTERS.find((x) => x.id === v);
      return { label: (m ? m.label : v), drop: () => remove(ui.misc, v) };
    }));
  box.hidden = !items.length;
  for (const it of items) {
    box.appendChild(el('button', {
      class: 'activechip', type: 'button',
      title: it.label + ' を外す',
      onclick: () => { it.drop(); saveUI(); render(); },
    }, [el('span', { text: it.label }), el('span', { class: 'activechip-x', text: '×' })]));
  }
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
  $('#count').textContent = hits.length + ' 件 / 登録 ' + stores.length + ' 件';
  // 0件でも押せるようにする。ここを押せなくすると、条件を戻す導線が
  // パネルの中から消えて行き止まりに見える
  $('#btn-apply').textContent = hits.length ? hits.length + ' 件を見る' : '0件 — 条件を外す';
  $('#btn-apply').disabled = false;
  $('#btn-apply').dataset.zero = hits.length ? '' : '1';

  // 星が1件も入っていないうちは「星が高い順」が何も起こさないので隠す
  const hasRating = stores.some((s) => s.rating != null);
  const opt = $('#sort').querySelector('option[value="rating"]');
  if (opt) opt.hidden = !hasRating;
  if (!hasRating && ui.sort === 'rating') { ui.sort = 'default'; $('#sort').value = 'default'; saveUI(); }
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
  document.documentElement.classList.toggle('is-embedded', framed && noInnerScroll);
}

// 最後に触った場所。埋め込み時に、シートやトーストをそこへ出すために使う
let lastPointY = 0;
function trackPoint(e) {
  const y = e.pageY || (e.touches && e.touches[0] && e.touches[0].pageY);
  if (y) lastPointY = y;
}

function anchorTop(height) {
  const margin = 12;
  const max = Math.max(margin, document.documentElement.scrollHeight - height - margin);
  return Math.min(max, Math.max(margin, lastPointY - 40));
}

function openSheet(nodes) {
  const sheet = $('#sheet');
  const panel = sheet.querySelector('.sheet-panel');
  panel.textContent = '';
  panel.appendChild(el('div', { class: 'sheet-grip' }));
  for (const n of [].concat(nodes)) if (n) panel.appendChild(n);
  panel.scrollTop = 0;
  sheet.hidden = false;

  if (isEmbedded()) {
    // 先に表示してから測らないと高さが取れない
    panel.style.top = anchorTop(0) + 'px';
    requestAnimationFrame(() => {
      panel.style.top = anchorTop(panel.getBoundingClientRect().height) + 'px';
    });
  } else {
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
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
}

/* ---------------- detail ---------------- */

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
          render();
        },
      }));
    }
  };
  drawStars();

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
            saveUser();
            drawVisits();
            render();
          },
        }),
      ]));
    });
  };
  drawVisits();

  const dl = el('dl', {}, [
    row('場所', '第' + s.building + 'ビル ' + s.floor + (s.block ? ' ' + s.block : '')),
    row('カテゴリ', s.category || '—'),
    row('予算', s.budget ? '¥' + s.budget : '—'),
    row('営業', (s.hours || '—') + (s.closedDays.length ? '（休: ' + s.closedDays.join('・') + '）' : '')
      + (open === null ? '' : open ? ' → 営業中' : ' → 時間外')),
    row('外部評価', s.rating
      ? starsText(s.rating) + (s.ratingCount ? '（' + s.ratingCount + '件' : '（')
        + (s.ratingSource || 'google') + (s.ratingCheckedAt ? ' / ' + s.ratingCheckedAt + '時点' : '') + '）'
      : '未記録'),
    s.tags.length ? row('タグ', s.tags.join('・')) : null,
    row('出どころ', (s.verified ? '確認済み' : '未確認') + '（' + s.source + '）'),
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
    el('div', { class: 'btnrow' }, [
      favBtn,
      el('button', {
        class: 'btn', type: 'button', text: '今日行った',
        onclick: () => {
          const d = todayStr();
          if (!ud.visits.includes(d)) ud.visits.push(d);
          saveUser();
          drawVisits();
          render();
          toast('訪問記録を追加しました');
        },
      }),
    ]),
    el('div', { class: 'field' }, [el('label', { text: '自分の評価' }), myStars]),
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
    { id: '', name: '', kana: '', building: ui.buildings.length === 1 ? Number(ui.buildings[0]) : 1, floor: 'B2', block: '', category: '', tags: [], budget: '', hours: '', closedDays: [], pos: null },
    s || {}
  );

  const f = {};
  const mkField = (key, label, attrs) => {
    const input = el('input', Object.assign({ type: 'text', value: draft[key] == null ? '' : draft[key] }, attrs || {}));
    f[key] = input;
    return el('div', { class: 'field' }, [el('label', { text: label }), input]);
  };

  const selBuilding = el('select', {}, BUILDINGS.map((b) =>
    el('option', { value: String(b), selected: Number(draft.building) === b, text: '第' + b + 'ビル' })));
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
      building: Number(selBuilding.value),
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
      el('div', { class: 'field' }, [el('label', { text: 'ビル' }), selBuilding]),
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
          el('span', { class: 'star-row-loc', text: '第' + s.building + ' ' + s.floor + (s.block ? ' / ' + s.block : '') }),
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
  const floors = [...new Set(stores.map((s) => s.floor))]
    .sort((a, b) => FLOOR_ORDER.indexOf(a) - FLOOR_ORDER.indexOf(b));
  const grid = el('div', { class: 'heregrid' });
  for (const b of BUILDINGS) {
    for (const f of floors) {
      const on = ui.here && ui.here.building === b && ui.here.floor === f;
      const n = stores.filter((s) => s.building === b && s.floor === f).length;
      grid.appendChild(el('button', {
        class: 'herecell' + (on ? ' is-on' : '') + (n ? '' : ' is-empty'),
        type: 'button',
        onclick: () => {
          ui.here = on ? null : { building: b, floor: f };
          saveUI();
          render();
          closeSheet();
          toast(ui.here ? '第' + b + 'ビル ' + f + ' を先頭に出します' : 'いまここを解除しました');
        },
      }, [
        el('span', { class: 'herecell-b', text: '第' + b + 'ビル' }),
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
      toast('第' + pending.b + 'ビル ' + pending.f + ' の平面図を保存しました');
      openPlanManager();
    } catch (e) {
      toast('保存できませんでした: ' + e.message);
    }
  });

  const rows = el('div', {});
  for (const b of BUILDINGS) {
    for (const f of floors) {
      const key = planKey(b, f);
      const has = have.includes(key);
      rows.appendChild(el('div', { class: 'planrow' }, [
        el('span', { class: 'planrow-name', text: '第' + b + 'ビル ' + f }),
        el('span', { class: 'planrow-state' + (has ? ' is-on' : ''), text: has ? '取り込み済み' : '未取り込み' }),
        el('button', {
          class: 'btn btn--ghost', type: 'button', text: has ? '差し替え' : '取り込む',
          onclick: () => { pending = { b: b, f: f }; file.click(); },
        }),
        has ? el('button', {
          class: 'btn btn--ghost btn--danger', type: 'button', text: '消す',
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
    el('p', { class: 'sheet-sub', text: '公式サイトの平面図を保存しておくと、店の詳細から開いて「区画番号がどこか」をその場で確かめられます。地下で電波が届かなくても見られます。画像はこの端末の中だけに保存され、どこにも送られません。' }),
    el('p', { class: 'sheet-sub', text: '取り込み方: 店の詳細にある「公式の平面図を開く」から平面図の画像を長押しして保存 → ここで選ぶ。' }),
    storeBroken ? el('div', { class: 'banner', text: 'この端末では画像を保存できません。プライベートブラウズを使っていると保存領域が使えないことがあります。' }) : null,
    file,
    rows,
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', text: '閉じる', onclick: closeSheet }),
    ]),
  ]);
}

// 平面図を開いて、その店の場所にピンを置けるようにする。
// 350件ぶんの座標を machine で当てるのは無理なので、歩きながら1件ずつ
// 置いてもらう。置いた位置は端末内（user[id].pin）に残る。
async function openPlanViewer(store) {
  const seq = sheetSeq;
  let url = null;
  try {
    url = await planGet(planKey(store.building, store.floor));
  } catch (e) {
    // 「まだありません」で取り込み画面に送ると、保存できない端末では往復し続ける
    toast('この端末では平面図を保存できません（' + e.message + '）');
    return;
  }
  if (seq !== sheetSeq) return; // 読み込み中に閉じられた
  if (!url) {
    toast('第' + store.building + 'ビル ' + store.floor + ' の平面図がまだありません');
    openPlanManager();
    return;
  }

  const ud = u(store.id);
  let placing = false;
  const img = el('img', { class: 'planimg', src: url, alt: '平面図' });
  const pin = el('div', { class: 'planpin', hidden: 'hidden' }, [el('span', { text: '▼' })]);
  const stage = el('div', { class: 'planstage' }, [img, pin]);
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
      el('strong', { text: '第' + store.building + 'ビル ' + store.floor }),
      store.block ? el('strong', { class: 'planblock', text: '区画 ' + store.block }) : null,
      el('span', { text: store.block ? '　この番号を図の中から探してください' : '　区画番号が未登録です' }),
    ]),
    scroller,
    el('div', { class: 'btnrow' }, [placeBtn, zoomBtn]),
    el('div', { class: 'btnrow' }, [
      delBtn,
      el('button', { class: 'btn btn--ghost', type: 'button', text: '閉じる', onclick: () => openDetail(store.id) }),
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
    unverified ? el('div', { class: 'banner' }, [
      '未確認の店が ' + unverified + ' 件あります。階や区画の裏が取れていないので、現地で確認したら詳細画面のボタンを押してください。',
      el('div', {}, [el('button', {
        class: 'btn btn--ghost', type: 'button', text: '未確認だけ表示',
        onclick: () => {
          if (!ui.misc.includes('unverified')) ui.misc.push('unverified');
          ui.filtersOpen = true;
          saveUI();
          render();
          closeSheet();
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
  const selB = el('select', {}, BUILDINGS.map((b) => el('option', { value: String(b), text: '第' + b + 'ビル' })));
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
      + '  場所: 第' + first.building + 'ビル ' + first.floor + (first.block ? ' / ' + first.block : '') + '\n'
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
  building: ['building', 'ビル', '建物', '号館'],
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

    // フロアと同じく全角を直してから読む。ここを抜かすと「３」が読めず
    // 既定のビルに化けたまま、不正としても弾かれない
    const rawB = String(rec.building || '').normalize('NFKC').replace(/[^0-9]/g, '');
    if (rec.building && !rawB) { skipped.push({ row: rec.name, why: 'ビルが読めない（' + rec.building + '）' }); continue; }
    const building = Number(rawB) || fallbackBuilding;
    const floor = String(rec.floor || fallbackFloor).normalize('NFKC').toUpperCase();
    if (!BUILDINGS.includes(building)) { skipped.push({ row: rec.name, why: 'ビルが不正' }); continue; }
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
      if (!BUILDINGS.includes(Number(s.building))) { bad.push(s); continue; }
      if (!FLOOR_ORDER.includes(String(s.floor))) { bad.push(s); continue; }
      ok.push(Object.assign({}, s, {
        building: Number(s.building),
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

  $('#btn-filters').addEventListener('click', () => {
    ui.filtersOpen = !ui.filtersOpen;
    saveUI();
    syncFilterBar();
  });

  $('#btn-here').addEventListener('click', openHerePicker);

  // 条件を変えるたびに閉じて確かめる往復が要らないよう、ここで件数を返す
  $('#btn-apply').addEventListener('click', (e) => {
    if (e.currentTarget.dataset.zero === '1') {
      ui.buildings = []; ui.floors = []; ui.cats = []; ui.tags = []; ui.misc = [];
      saveUI();
      render();
      return;
    }
    ui.filtersOpen = false;
    saveUI();
    syncFilterBar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  for (const key of ['category', 'tag']) {
    $('#more-' + key).addEventListener('click', () => {
      $('#f-' + key).classList.toggle('is-collapsed');
      syncChipsMore(key);
    });
  }

  $('#btn-reset').addEventListener('click', () => {
    ui.buildings = []; ui.floors = []; ui.cats = []; ui.tags = []; ui.misc = []; ui.q = '';
    ui.here = null;
    q.value = ''; $('#q-clear').hidden = true;
    saveUI(); render();
  });

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

  // manifest を宣言しているページ（=デプロイ版）でだけ Service Worker を使う。
  // 埋め込み表示などでは古いキャッシュが残って更新が届かなくなるため登録しない。
  const hasManifest = document.querySelector('link[rel="manifest"]');
  if (hasManifest && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
