// Netflix の公開ページ（ログインしていなくても見られるページ）から作品を集める。
// 会員向けの画面はログイン状態で中身が変わるので、Cookie を送らずに取得する。
import * as store from './store.js';
import { GENRES, DURATIONS } from './genres.js';

const ORIGIN = 'https://www.netflix.com';
const REGION = 'jp';
const LIST_TTL = 12 * 60 * 60 * 1000;
const DETAIL_TTL = 7 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 5;

export const genreUrl = (id) => `${ORIGIN}/${REGION}/browse/genre/${id}`;
export const titleUrl = (id) => `${ORIGIN}/${REGION}/title/${id}`;
export const watchUrl = (id) => `${ORIGIN}/watch/${id}`;

export class CatalogError extends Error {}

// ---------- 取得 ----------

async function fetchDoc(url, signal, stats) {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(url, {
      credentials: 'omit',
      signal,
      headers: { 'Accept-Language': 'ja-JP,ja;q=0.9' },
    });
  } finally {
    stats.fetches += 1;
    stats.fetchMs += performance.now() - t0;
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new CatalogError(`HTTP ${res.status}: ${url}`);
  if (/\/login\b/.test(res.url)) throw new CatalogError('ログインページに転送されました');
  const html = await res.text();
  return { html, doc: new DOMParser().parseFromString(html, 'text/html') };
}

async function getGenreList(genreId, signal, stats) {
  const key = `g:${genreId}`;
  const cached = await store.get(key);
  if (cached && Date.now() - cached.ts < LIST_TTL && cached.items.length) {
    stats.cacheHits += 1;
    return cached.items;
  }
  const page = await fetchDoc(genreUrl(genreId), signal, stats);
  const items = page ? parseGenrePage(page.doc, page.html) : [];
  if (!items.length) throw new CatalogError(`「${GENRES[genreId] ?? genreId}」の一覧を読み取れませんでした`);
  for (const it of items) it.genreId = genreId;
  await store.set(key, { ts: Date.now(), items });
  return items;
}

async function getDetail(id, signal, stats) {
  const key = `d:${id}`;
  const cached = await store.get(key);
  if (cached && Date.now() - cached.ts < DETAIL_TTL) {
    stats.cacheHits += 1;
    return cached.data;
  }
  const page = await fetchDoc(titleUrl(id), signal, stats);
  const data = page ? parseTitlePage(page.doc, page.html) : { missing: true };
  await store.set(key, { ts: Date.now(), data });
  return data;
}

export async function clearCache() {
  await store.removeByPrefix('g:');
  await store.removeByPrefix('d:');
}

// ---------- 解析 ----------

const squash = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = (el) => squash(el?.textContent);
const titleIdOf = (href) => href?.match(/\/title\/(\d+)/)?.[1] ?? null;

function absUrl(src) {
  if (!src || src.startsWith('data:')) return null;
  try {
    return new URL(src, ORIGIN).href;
  } catch {
    return null;
  }
}

function imgSrc(img) {
  if (!img) return null;
  return (
    absUrl(img.getAttribute('src')) ||
    absUrl(img.getAttribute('data-src')) ||
    absUrl((img.getAttribute('srcset') || '').split(/\s+/)[0])
  );
}

function jsonLd(doc) {
  const out = [];
  const visit = (v) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== 'object') return;
    out.push(v);
    if (v['@graph']) visit(v['@graph']);
    if (v.itemListElement) visit(v.itemListElement);
    if (v.item) visit(v.item);
  };
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(s.textContent));
    } catch {
      /* 壊れた JSON-LD は無視 */
    }
  }
  return out;
}

const firstOf = (v) => (Array.isArray(v) ? v[0] : v);
const imageOf = (v) => {
  const x = firstOf(v);
  return absUrl(typeof x === 'string' ? x : x?.url);
};

export function parseGenrePage(doc, html) {
  const items = new Map();
  const add = (id, data) => {
    if (!id) return;
    const cur = items.get(id) ?? { id };
    for (const [k, v] of Object.entries(data)) if (v && !cur[k]) cur[k] = v;
    items.set(id, cur);
  };

  for (const a of doc.querySelectorAll('a[href*="/title/"]')) {
    const img = a.querySelector('img');
    const name =
      text(a.querySelector('.nm-collections-title-name, [class*="title-name"], [data-uia*="title-name"]')) ||
      squash(img?.getAttribute('alt')) ||
      squash(a.getAttribute('aria-label')) ||
      text(a);
    add(titleIdOf(a.getAttribute('href')), { title: name.slice(0, 120), image: imgSrc(img) });
  }

  for (const obj of jsonLd(doc)) {
    const id = titleIdOf(obj.url ?? obj['@id']);
    if (id) add(id, { title: squash(obj.name), image: imageOf(obj.image) });
  }

  // マークアップが変わっても ID だけは拾えるようにしておく（名前は詳細ページで補う）
  if (!items.size) {
    for (const m of html.matchAll(/\/title\/(\d{5,})/g)) add(m[1], {});
  }
  return [...items.values()];
}

export function parseMinutes(s) {
  if (!s) return null;
  const iso = /^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?/i.exec(s);
  if (iso && (iso[1] || iso[2])) return Number(iso[1] ?? 0) * 60 + Number(iso[2] ?? 0);
  const h = /(\d+)\s*(?:時間|h|hr|hours?)/i.exec(s);
  const m = /(\d+)\s*(?:分|m(?!o)|min)/i.exec(s);
  if (!h && !m) return null;
  return Number(h?.[1] ?? 0) * 60 + Number(m?.[1] ?? 0);
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const pick = (doc, sel) => text(doc.querySelector(sel));

export function parseTitlePage(doc, html) {
  const lds = jsonLd(doc);
  const ld =
    lds.find((o) => /Movie|TVSeries|TVSeason|CreativeWork/i.test([].concat(o['@type']).join(','))) ?? {};
  const ldType = [].concat(ld['@type'] ?? []).join(',');
  const meta = (p) => doc.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute('content');

  const title =
    squash(ld.name) ||
    pick(doc, '[data-uia="title-info-title"], h1.title-title, h1') ||
    squash(meta('og:title')?.split(/\s*[|｜]\s*/)[0]);

  const synopsis =
    squash(ld.description) ||
    pick(doc, '[data-uia="title-info-synopsis"], .title-info-synopsis, [class*="synopsis"]') ||
    squash(meta('og:description') || meta('description'));

  const genre =
    squash([].concat(ld.genre ?? [])[0]) ||
    pick(doc, '[data-uia="item-genre"], .item-genre, [data-uia="title-info-metadata-item-genre"]');

  const year =
    String(ld.dateCreated ?? ld.datePublished ?? '').slice(0, 4) ||
    pick(doc, '[data-uia="item-year"], .item-year');

  const rating =
    squash(typeof ld.contentRating === 'string' ? ld.contentRating : ld.contentRating?.name) ||
    pick(doc, '[data-uia="item-maturity"], .item-maturity, .maturity-number');

  const runtimeText = pick(doc, '[data-uia="item-runtime"], .item-runtime, .duration');
  const bodyText = squash(doc.body?.textContent).slice(0, 20000);

  let kind = null;
  if (/TVSeries|TVSeason/i.test(ldType) || ld.numberOfSeasons) kind = 'series';
  else if (/Movie/i.test(ldType)) kind = 'movie';
  else if (/シーズン|エピソード|Season|Episode/i.test(runtimeText)) kind = 'series';
  else if (parseMinutes(runtimeText)) kind = 'movie';
  else if (/エピソード|シーズン\s*\d/.test(bodyText)) kind = 'series';

  // 映画は本編の長さ、シリーズは1話の長さ（中央値）を使う
  let minutes = null;
  let seasons = null;
  if (kind === 'series') {
    const eps = [...doc.querySelectorAll('[data-uia="episode-runtime"], .episode-runtime')]
      .map((el) => parseMinutes(el.textContent))
      .filter(Boolean);
    const ldEps = [];
    JSON.stringify(ld, (k, v) => {
      if ((k === 'duration' || k === 'timeRequired') && typeof v === 'string') ldEps.push(parseMinutes(v));
      return v;
    });
    minutes = median(eps) ?? median(ldEps.filter(Boolean));
    seasons =
      Number(ld.numberOfSeasons) ||
      Number(/(?:シーズン|Seasons?)\s*(\d+)|(\d+)\s*(?:シーズン|Seasons?)/i.exec(runtimeText)?.slice(1).find(Boolean)) ||
      null;
  } else {
    minutes = parseMinutes(ld.duration) ?? parseMinutes(runtimeText);
  }

  return {
    title: title || null,
    synopsis: synopsis || null,
    genre: genre || null,
    year: /^\d{4}$/.test(year) ? year : null,
    rating: rating || null,
    image: imageOf(ld.image) || absUrl(meta('og:image')),
    kind,
    minutes,
    seasons,
  };
}

// ---------- ピック ----------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function inDuration(minutes, ids) {
  if (!ids.length) return true;
  if (!minutes) return false;
  return DURATIONS.filter((d) => ids.includes(d.id)).some(
    (d) => (d.min === 0 ? minutes >= 0 : minutes > d.min) && minutes <= d.max,
  );
}

function matches(item, { type, durations }) {
  if (item.missing) return false;
  if (type !== 'any' && item.kind !== type) return false;
  return inDuration(item.minutes, durations);
}

/**
 * ジャンルの一覧から候補を集め、ランダムな順に詳細を取りながら条件に合う作品を count 件選ぶ。
 * 見つかった順に onItem が呼ばれる。
 */
export async function pickTitles({ genreIds, count, type, durations, recent = [], signal, onItem }) {
  const stats = { fetches: 0, fetchMs: 0, cacheHits: 0, listMs: 0, detailMs: 0, totalMs: 0 };
  const t0 = performance.now();

  const settled = await Promise.allSettled(genreIds.map((g) => getGenreList(g, signal, stats)));
  signal?.throwIfAborted();
  stats.listMs = performance.now() - t0;

  const pool = new Map();
  for (const r of settled) if (r.status === 'fulfilled') for (const it of r.value) if (!pool.has(it.id)) pool.set(it.id, it);
  if (!pool.size) {
    const reason = settled.find((r) => r.status === 'rejected')?.reason;
    throw reason instanceof CatalogError ? reason : new CatalogError(reason?.message ?? '作品一覧を取得できませんでした');
  }

  // 最近出した作品は後ろに回して、同じものばかり出ないようにする
  const recentSet = new Set(recent);
  const candidates = [
    ...shuffle([...pool.values()].filter((it) => !recentSet.has(it.id))),
    ...shuffle([...pool.values()].filter((it) => recentSet.has(it.id))),
  ];
  const filtered = type !== 'any' || durations.length > 0;
  const maxTries = Math.min(candidates.length, filtered ? count * 6 + 10 : count + 5);

  const t1 = performance.now();
  const picked = [];
  let next = 0;
  const worker = async () => {
    while (picked.length < count && next < maxTries) {
      const cand = candidates[next++];
      let detail = null;
      try {
        detail = await getDetail(cand.id, signal, stats);
      } catch (e) {
        if (signal?.aborted) throw e;
      }
      signal?.throwIfAborted();
      const item = { ...cand, ...Object.fromEntries(Object.entries(detail ?? {}).filter(([, v]) => v != null)) };
      item.image = cand.image || item.image;
      item.sourceGenre = GENRES[cand.genreId] ?? null;
      if (!item.title || !matches(item, { type, durations }) || picked.length >= count) continue;
      picked.push(item);
      onItem?.(item, picked.length - 1);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  stats.detailMs = performance.now() - t1;
  stats.totalMs = performance.now() - t0;
  return { items: picked, stats, poolSize: pool.size, tried: next };
}
