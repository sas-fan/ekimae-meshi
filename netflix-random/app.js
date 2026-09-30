import * as store from './store.js';
import { GENRES, GENRE_ORDER, MOODS, DURATIONS } from './genres.js';
import { pickTitles, clearCache, titleUrl, watchUrl } from './catalog.js';

const $ = (sel) => document.querySelector(sel);
const els = {
  perf: $('#perf'),
  modeButtons: document.querySelectorAll('[data-mode]'),
  moodField: $('#moodField'),
  genreField: $('#genreField'),
  mood: $('#mood'),
  genre: $('#genre'),
  durations: $('#durations'),
  type: $('#type'),
  count: $('#count'),
  pick: $('#pick'),
  favToggle: $('#favToggle'),
  favCount: $('#favCount'),
  resultbar: $('#resultbar'),
  resultText: $('#resultText'),
  luckyPlay: $('#luckyPlay'),
  notice: $('#notice'),
  grid: $('#grid'),
  clearCache: $('#clearCache'),
  cardTpl: $('#cardTpl'),
  skeletonTpl: $('#skeletonTpl'),
};

const DEFAULT_SETTINGS = { mode: 'mood', mood: MOODS[0].id, genre: GENRE_ORDER[0], durations: [], type: 'any', count: 10 };
const RECENT_LIMIT = 200;

let settings = { ...DEFAULT_SETTINGS };
let favorites = []; // 追加した順
let recent = [];
let lastPicked = [];
let view = 'pick';
let running = null;

// ---------- 表示用の小物 ----------

function formatMinutes(m) {
  if (!m) return null;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h}時間${mm ? `${mm}分` : ''}` : `${mm}分`;
}

function metaLine(item) {
  const parts = [];
  if (item.kind === 'movie') parts.push('映画');
  if (item.kind === 'series') parts.push(item.seasons ? `シリーズ・シーズン${item.seasons}` : 'シリーズ');
  const len = formatMinutes(item.minutes);
  if (len) parts.push(item.kind === 'series' ? `1話 約${len}` : len);
  if (item.year) parts.push(item.year);
  if (item.rating) parts.push(item.rating);
  return parts.join('　·　');
}

const sec = (ms) => (ms / 1000).toFixed(1);

function showPerf({ stats, items }) {
  const avg = stats.fetches ? sec(stats.fetchMs / stats.fetches) : '0.0';
  els.perf.textContent =
    `計${sec(stats.totalMs)}s（一覧${sec(stats.listMs)} / 詳細${sec(stats.detailMs)}` +
    ` | fetch ${avg}×${stats.fetches}件・キャッシュ${stats.cacheHits}件）`;
  els.perf.title = `${items.length}件をピック`;
}

function showNotice(lines, { error = false } = {}) {
  els.notice.hidden = false;
  els.notice.classList.toggle('error', error);
  els.notice.replaceChildren();
  for (const [i, line] of lines.entries()) {
    if (i) els.notice.append(document.createElement('br'));
    els.notice.append(line);
  }
}

function hideNotice() {
  els.notice.hidden = true;
}

function strong(s) {
  const el = document.createElement('strong');
  el.textContent = s;
  return el;
}

// ---------- カード ----------

function isFavorite(id) {
  return favorites.some((f) => f.id === id);
}

function renderCard(item) {
  const node = els.cardTpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = item.id;

  const thumb = node.querySelector('.thumb');
  const img = node.querySelector('.thumb-img');
  node.querySelector('.thumb-fallback').textContent = item.title;
  if (item.image) {
    img.src = item.image;
    img.alt = item.title;
    img.addEventListener('error', () => {
      img.hidden = true;
      thumb.classList.add('no-image');
    }, { once: true });
  } else {
    img.hidden = true;
    thumb.classList.add('no-image');
  }

  const link = node.querySelector('.title-link');
  link.textContent = item.title;
  link.href = titleUrl(item.id);

  node.querySelector('.genre').textContent = item.genre || item.sourceGenre || '';
  node.querySelector('.meta').textContent = metaLine(item);

  const syn = node.querySelector('.synopsis');
  syn.textContent = item.synopsis || '（あらすじ情報なし）';
  syn.classList.toggle('empty', !item.synopsis);

  const watch = node.querySelector('.watch');
  watch.href = watchUrl(item.id);
  watch.setAttribute('aria-label', `${item.title}を視聴する`);

  const fav = node.querySelector('.fav');
  syncFavButton(fav, item);
  fav.addEventListener('click', () => toggleFavorite(item, fav));
  return node;
}

function syncFavButton(btn, item) {
  const on = isFavorite(item.id);
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? `${item.title}をお気に入りから外す` : `${item.title}をお気に入りに追加`);
}

async function toggleFavorite(item, btn) {
  if (isFavorite(item.id)) favorites = favorites.filter((f) => f.id !== item.id);
  else favorites.push(stripItem(item));
  await store.set('favorites', favorites);
  for (const b of document.querySelectorAll(`.card[data-id="${item.id}"] .fav`)) syncFavButton(b, item);
  syncFavButton(btn, item);
  updateFavCount();
}

function stripItem(item) {
  const { id, title, image, genre, sourceGenre, synopsis, kind, minutes, seasons, year, rating } = item;
  return { id, title, image, genre, sourceGenre, synopsis, kind, minutes, seasons, year, rating };
}

function updateFavCount() {
  els.favCount.textContent = favorites.length ? String(favorites.length) : '';
}

// ---------- 条件 ----------

function buildControls() {
  for (const m of MOODS) els.mood.add(new Option(`${m.emoji} ${m.label}`, m.id));
  for (const id of GENRE_ORDER) els.genre.add(new Option(GENRES[id], String(id)));
  for (const d of DURATIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.duration = d.id;
    b.textContent = d.label;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      settings.durations = [...els.durations.querySelectorAll('[aria-pressed="true"]')].map((x) => x.dataset.duration);
      saveSettings();
    });
    els.durations.append(b);
  }

  for (const b of els.modeButtons) {
    b.addEventListener('click', () => {
      settings.mode = b.dataset.mode;
      applySettings();
      saveSettings();
    });
  }
  els.mood.addEventListener('change', () => { settings.mood = els.mood.value; saveSettings(); });
  els.genre.addEventListener('change', () => { settings.genre = Number(els.genre.value); saveSettings(); });
  els.type.addEventListener('change', () => { settings.type = els.type.value; saveSettings(); });
  els.count.addEventListener('change', () => { settings.count = Number(els.count.value); saveSettings(); });
}

function applySettings() {
  for (const b of els.modeButtons) b.setAttribute('aria-pressed', String(b.dataset.mode === settings.mode));
  els.moodField.hidden = settings.mode !== 'mood';
  els.genreField.hidden = settings.mode !== 'genre';
  els.mood.value = settings.mood;
  els.genre.value = String(settings.genre);
  els.type.value = settings.type;
  els.count.value = String(settings.count);
  for (const b of els.durations.children) {
    b.setAttribute('aria-pressed', String(settings.durations.includes(b.dataset.duration)));
  }
}

function saveSettings() {
  store.set('settings', settings);
}

function currentGenreIds() {
  if (settings.mode === 'genre') return [Number(settings.genre)];
  return (MOODS.find((m) => m.id === settings.mood) ?? MOODS[0]).genres;
}

function conditionLabel() {
  if (settings.mode === 'genre') return GENRES[settings.genre];
  const m = MOODS.find((x) => x.id === settings.mood) ?? MOODS[0];
  return `${m.emoji} ${m.label}`;
}

// ---------- ピック ----------

async function runPick() {
  setView('pick');
  running?.abort();
  const controller = new AbortController();
  running = controller;

  const count = settings.count;
  hideNotice();
  els.resultbar.hidden = true;
  els.grid.replaceChildren(...Array.from({ length: count }, () => els.skeletonTpl.content.firstElementChild.cloneNode(true)));
  els.pick.disabled = true;
  els.pick.lastChild.textContent = ' ピック中…';
  els.perf.textContent = '';
  lastPicked = [];

  try {
    const result = await pickTitles({
      genreIds: currentGenreIds(),
      count,
      type: settings.type,
      durations: settings.durations,
      recent,
      signal: controller.signal,
      onItem: (item) => {
        if (controller.signal.aborted) return;
        lastPicked.push(item);
        const slot = els.grid.querySelector('.skeleton');
        const card = renderCard(item);
        if (slot) slot.replaceWith(card);
        else els.grid.append(card);
      },
    });
    if (controller.signal.aborted) return;

    for (const s of els.grid.querySelectorAll('.skeleton')) s.remove();
    showPerf(result);

    recent = [...result.items.map((i) => i.id), ...recent.filter((id) => !result.items.some((i) => i.id === id))].slice(0, RECENT_LIMIT);
    store.set('recent', recent);

    if (!result.items.length) {
      showNotice([strong('条件に合う作品が見つかりませんでした。'), '再生時間や種別の条件をゆるめて、もう一度ピックしてください。']);
    } else {
      els.resultbar.hidden = false;
      els.resultText.textContent = `${conditionLabel()} から ${result.items.length}件をピックしました（候補 ${result.poolSize}件）`;
      if (result.items.length < count) {
        showNotice([`条件に合う作品が ${result.items.length}件しか見つかりませんでした。`, 'もう一度ピックすると別の候補から探します。']);
      }
    }
  } catch (e) {
    if (controller.signal.aborted) return;
    console.error(e);
    els.grid.replaceChildren();
    showNotice(
      [
        strong('Netflix から作品一覧を取得できませんでした。'),
        'ネットワーク接続を確認して、時間をおいてもう一度お試しください。',
        `詳細: ${e.message}`,
      ],
      { error: true },
    );
  } finally {
    if (running === controller) {
      running = null;
      els.pick.disabled = false;
      els.pick.lastChild.textContent = ' ピック';
    }
  }
}

// ---------- お気に入り ----------

function setView(next) {
  view = next;
  els.favToggle.setAttribute('aria-pressed', String(view === 'fav'));
  els.favToggle.querySelector('.fav-icon').textContent = view === 'fav' ? '♥' : '♡';
}

function showFavorites() {
  running?.abort();
  setView('fav');
  hideNotice();
  const items = [...favorites].reverse();
  if (!items.length) {
    els.resultbar.hidden = true;
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'お気に入りはまだありません。カード右上の ♡ で追加できます。';
    els.grid.replaceChildren(p);
    return;
  }
  els.resultbar.hidden = false;
  els.resultText.textContent = `お気に入り ${items.length}件`;
  els.grid.replaceChildren(...items.map(renderCard));
}

function showLastPicked() {
  setView('pick');
  hideNotice();
  if (!lastPicked.length) {
    els.resultbar.hidden = true;
    els.grid.replaceChildren();
    return;
  }
  els.resultbar.hidden = false;
  els.resultText.textContent = `${conditionLabel()} から ${lastPicked.length}件をピックしました`;
  els.grid.replaceChildren(...lastPicked.map(renderCard));
}

function luckyPlay() {
  const ids = [...els.grid.querySelectorAll('.card[data-id]')].map((c) => c.dataset.id);
  if (!ids.length) return;
  const id = ids[Math.floor(Math.random() * ids.length)];
  window.open(watchUrl(id), '_blank', 'noopener');
}

// ---------- 起動 ----------

async function init() {
  buildControls();
  const [saved, favs, rec] = await Promise.all([
    store.get('settings', {}),
    store.get('favorites', []),
    store.get('recent', []),
  ]);
  settings = { ...DEFAULT_SETTINGS, ...saved };
  favorites = favs;
  recent = rec;
  applySettings();
  updateFavCount();

  els.pick.addEventListener('click', runPick);
  els.favToggle.addEventListener('click', () => (view === 'fav' ? showLastPicked() : showFavorites()));
  els.luckyPlay.addEventListener('click', luckyPlay);
  els.clearCache.addEventListener('click', async () => {
    await clearCache();
    els.perf.textContent = '';
    showNotice(['キャッシュを削除しました。次のピックでは最新の一覧を取り直します。']);
  });

  const p = document.createElement('p');
  p.className = 'empty-state';
  p.textContent = '条件を選んで「ピック」を押すと、Netflix の作品をランダムに選びます。';
  els.grid.replaceChildren(p);
}

init();
