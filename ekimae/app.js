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
let ui = Object.assign(
  { view: 'list', sort: 'default', q: '', buildings: [], floors: [], cats: [], tags: [], misc: [], filtersOpen: false },
  readJSON(KEY.ui, {})
);

let stores = [];

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

/* ---------------- data assembly ---------------- */

function rebuild() {
  const byId = new Map();
  for (const s of base.stores) byId.set(s.id, s);
  for (const c of custom) {
    const prev = byId.get(c.id);
    byId.set(c.id, prev ? Object.assign({}, prev, c) : c);
  }
  for (const id of deleted) byId.delete(id);
  stores = [...byId.values()].map(normalizeStore);
}

function normalizeStore(s) {
  return Object.assign({}, s, {
    building: Number(s.building) || 1,
    floor: s.floor || 'B1',
    tags: Array.isArray(s.tags) ? s.tags : [],
    closedDays: Array.isArray(s.closedDays) ? s.closedDays : [],
    rating: typeof s.rating === 'number' ? s.rating : null,
    aliases: Array.isArray(s.aliases) ? s.aliases : [],
    verified: s.verified === true,
    source: s.source || 'manual',
    _n: norm([s.name, s.kana, s.category, s.block,
      (s.tags || []).join(' '), (s.aliases || []).join(' ')].join(' ')),
  });
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
      const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*[-–~〜]\s*(\d{1,2}):(\d{2})$/);
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

function sortKey(s) {
  const fi = FLOOR_ORDER.indexOf(s.floor);
  return [s.building, fi < 0 ? 99 : fi, ...blockKey(s.block), s.name];
}

function sorted(list) {
  const arr = list.slice();
  if (ui.sort === 'rating') {
    arr.sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name, 'ja'));
  } else if (ui.sort === 'name') {
    arr.sort((a, b) => (a.kana || a.name).localeCompare(b.kana || b.name, 'ja'));
  } else if (ui.sort === 'recent') {
    arr.sort((a, b) => ((user[b.id] && user[b.id].seenAt) || 0) - ((user[a.id] && user[a.id].seenAt) || 0));
  } else {
    arr.sort((a, b) => {
      const ka = sortKey(a), kb = sortKey(b);
      for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        const x = ka[i] === undefined ? -1 : ka[i];
        const y = kb[i] === undefined ? -1 : kb[i];
        if (x === y) continue;
        return x < y ? -1 : 1;
      }
      return 0;
    });
  }
  return arr;
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
  // 消えた階が選ばれたままだと、外すチップが無いのに0件になって詰む
  const pruned = ui.floors.filter((f) => floorCounts.has(f));
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
  const catList = [...catCounts.entries()]
    .sort((a, b) => CATEGORIES.indexOf(a[0]) - CATEGORIES.indexOf(b[0]))
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
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
    .map(([t, c]) => ({ value: t, label: t + ' ' + c }));
  mk($('#f-tag'), tagList.length ? tagList : [{ value: '__none', label: 'タグ未登録' }], ui.tags, (v) => {
    if (v === '__none') return;
    toggle(ui.tags, v);
  });

  mk($('#f-misc'), MISC_FILTERS.map((m) => ({ value: m.id, label: m.label })), ui.misc, (v) => {
    if ((v === 'visited' && ui.misc.includes('unvisited'))) ui.misc.splice(ui.misc.indexOf('unvisited'), 1);
    if ((v === 'unvisited' && ui.misc.includes('visited'))) ui.misc.splice(ui.misc.indexOf('visited'), 1);
    if (v === 'r35' && ui.misc.includes('r40')) ui.misc.splice(ui.misc.indexOf('r40'), 1);
    if (v === 'r40' && ui.misc.includes('r35')) ui.misc.splice(ui.misc.indexOf('r35'), 1);
    toggle(ui.misc, v);
  });
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

  const keys = [...groups.keys()].sort((a, b) => {
    const [ab, af] = a.split('/'), [bb, bf] = b.split('/');
    return Number(ab) - Number(bb) || FLOOR_ORDER.indexOf(af) - FLOOR_ORDER.indexOf(bf);
  });

  const visible = keys.filter((k) => groups.get(k).some((s) => hitIds.has(s.id)));
  if (!visible.length) {
    box.appendChild(el('p', { class: 'empty', text: '該当する店がありません。' }));
    return;
  }

  const cell = (s, provisional) => {
    const ud = user[s.id] || {};
    const hit = hitIds.has(s.id);
    return el('button', {
      class: 'gridcell' + (hit ? ' is-hit' : ' is-dim') + (provisional ? ' is-provisional' : ''),
      type: 'button',
      style: provisional ? null
        : 'grid-column:' + s.pos.x + ' / span ' + (s.w || 1) + ';grid-row:' + s.pos.y + ' / span ' + (s.h || 1) + ';',
      onclick: () => openDetail(s.id),
    }, [
      el('span', { class: 'gridcell-name', text: (ud.fav ? '★' : '') + s.name }),
      el('span', { class: 'gridcell-sub' }, [
        el('span', { text: s.block || s.category || '' }),
        s.rating ? el('span', { text: s.rating.toFixed(1) }) : null,
      ]),
    ]);
  };

  for (const k of visible) {
    const [b, f] = k.split('/');
    const list = groups.get(k);
    const placed = list.filter((s) => s.pos && s.pos.x > 0 && s.pos.y > 0);
    const flow = list.filter((s) => !(s.pos && s.pos.x > 0 && s.pos.y > 0)).sort(cmpBlock);
    const hitCount = list.filter((s) => hitIds.has(s.id)).length;

    const group = el('div', { class: 'floorgroup' }, [
      el('h2', { text: '第' + b + 'ビル ' + f + '　該当 ' + hitCount + ' / ' + list.length + '件' }),
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
}

function render() {
  renderChips();
  syncFilterBar();
  const hits = sorted(stores.filter(matches));
  $('#count').textContent = hits.length + ' 件 / 登録 ' + stores.length + ' 件';
  const isList = ui.view === 'list';
  $('#view-list').hidden = !isList;
  $('#view-map').hidden = isList;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('is-active', t.dataset.view === ui.view);
  if (isList) renderList(hits); else renderMap(hits);
}

/* ---------------- sheet ---------------- */

function openSheet(nodes) {
  const sheet = $('#sheet');
  const panel = sheet.querySelector('.sheet-panel');
  panel.textContent = '';
  panel.appendChild(el('div', { class: 'sheet-grip' }));
  for (const n of [].concat(nodes)) if (n) panel.appendChild(n);
  panel.scrollTop = 0;
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
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
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', text: '閉じる', onclick: closeSheet }),
      el('button', { class: 'btn btn--ghost btn--danger', type: 'button', text: 'この店を削除', onclick: () => removeStore(s) }),
    ]),
  ]);

  function row(k, v) {
    return el('div', { class: 'detail-row' }, [el('dt', { text: k }), el('dd', { text: v })]);
  }
}

function updateRating(s) {
  const raw = prompt('Googleマップなどの星（例: 3.8）。空で消去。', s.rating != null ? String(s.rating) : '');
  if (raw === null) return;
  const patch = { id: s.id };
  if (raw.trim() === '') {
    patch.rating = null;
    patch.ratingCount = null;
  } else {
    const v = Number(raw);
    if (!(v >= 0 && v <= 5)) { toast('0〜5の数値を入れてください'); return; }
    patch.rating = Math.round(v * 10) / 10;
    const cnt = prompt('レビュー件数（任意）', s.ratingCount != null ? String(s.ratingCount) : '');
    if (cnt !== null && cnt.trim() !== '') patch.ratingCount = Number(cnt) || null;
    patch.ratingSource = s.ratingSource || 'google';
    patch.ratingCheckedAt = todayStr();
  }
  applyPatch(patch);
  toast('外部評価を更新しました');
  openDetail(s.id);
}

function applyPatch(patch) {
  const i = custom.findIndex((c) => c.id === patch.id);
  if (i < 0) custom.push(patch); else custom[i] = Object.assign({}, custom[i], patch);
  saveCustom();
  rebuild();
  render();
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
    toast(isNew ? '登録しました' : '更新しました');
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
  ]);
}

/* ---------------- menu / import / export ---------------- */

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
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
    el('p', { class: 'sheet-sub', text: 'お気に入り・メモ・追加した店は、この端末のブラウザに保存されています。' }),
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
      el('label', { text: 'CSVで一括登録（name,building,floor,block,category,tags,budget,hours,closedDays）' }),
      csvBox(),
    ]),
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', text: '閉じる', onclick: closeSheet }),
      el('button', {
        class: 'btn btn--ghost btn--danger', type: 'button', text: 'この端末の記録を全消去',
        onclick: () => {
          if (!confirm('お気に入り・メモ・追加した店をすべて消します。元に戻せません。')) return;
          localStorage.removeItem(KEY.user);
          localStorage.removeItem(KEY.custom);
          localStorage.removeItem(KEY.deleted);
          user = {}; custom = []; deleted = [];
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
  const ta = el('textarea', { placeholder: '立ち飲み○○,3,B2,B2-31,立ち飲み,立ち飲み|現金のみ,~2000,11:00-21:00,日|祝' });
  const wrap = el('div', {}, [
    ta,
    el('div', { class: 'btnrow' }, [
      el('button', {
        class: 'btn btn--ghost', type: 'button', text: 'CSVを取り込む',
        onclick: () => {
          const added = importCSV(ta.value);
          if (added) { ta.value = ''; toast(added + '件を登録しました'); }
        },
      }),
    ]),
  ]);
  return wrap;
}

function importCSV(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let n = 0;
  for (const line of lines) {
    const c = line.split(',').map((x) => x.trim());
    if (!c[0] || /^name$/i.test(c[0])) continue;
    custom.push({
      id: 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6) + '-' + n,
      name: c[0],
      building: Number(c[1]) || 1,
      floor: c[2] || 'B1',
      block: c[3] || '',
      category: c[4] || '',
      tags: (c[5] || '').split('|').map((t) => t.trim()).filter(Boolean),
      budget: c[6] || '',
      hours: c[7] || '',
      closedDays: (c[8] || '').split('|').map((t) => t.trim()).filter(Boolean),
      pos: null,
      source: 'manual',
      verified: false,
    });
    n++;
  }
  if (n) { saveCustom(); rebuild(); render(); }
  else toast('取り込める行がありませんでした');
  return n;
}

function importPayload(data) {
  if (data && data.kind === 'ekimae-backup') {
    if (!confirm('バックアップを読み込みます。現在の記録は置き換わります。')) return;
    user = data.user || {};
    custom = data.custom || [];
    deleted = data.deleted || [];
    saveUser(); saveCustom(); saveDeleted();
    rebuild();
    render();
    closeSheet();
    toast('バックアップを読み込みました');
    return;
  }
  if (data && Array.isArray(data.stores)) {
    if (!confirm(data.stores.length + '件の店データを取り込みます（既存IDは上書き）。')) return;
    for (const s of data.stores) {
      if (!s || !s.id) continue;
      const i = custom.findIndex((c) => c.id === s.id);
      if (i < 0) custom.push(s); else custom[i] = s;
      const di = deleted.indexOf(s.id);
      if (di >= 0) deleted.splice(di, 1);
    }
    saveCustom(); saveDeleted();
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

  $('#btn-reset').addEventListener('click', () => {
    ui.buildings = []; ui.floors = []; ui.cats = []; ui.tags = []; ui.misc = []; ui.q = '';
    q.value = ''; $('#q-clear').hidden = true;
    saveUI(); render();
  });

  $('#btn-add').addEventListener('click', () => openEditor(null));
  $('#btn-menu').addEventListener('click', openMenu);

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
  rebuild();
  render();

  // manifest を宣言しているページ（=デプロイ版）でだけ Service Worker を使う。
  // 埋め込み表示などでは古いキャッシュが残って更新が届かなくなるため登録しない。
  const hasManifest = document.querySelector('link[rel="manifest"]');
  if (hasManifest && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
