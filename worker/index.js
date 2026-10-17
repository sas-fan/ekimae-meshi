/* 梅田地下メシ — 記録を保存する小さなサーバー（Cloudflare Worker + D1）

アプリ（静的ファイル）と同じドメインの /api/* だけをここで受ける。
誰が開いたかは Cloudflare Access（メールでログイン）が決める。Access を通った
リクエストには署名つきの証明（Cf-Access-Jwt-Assertion）が付くので、それを検証して
メールアドレスを取り出す。検証できないものは何も返さない。

保存の形は「パス → JSON」の1種類だけ。claude.ai の保存機能と同じ形にして、
アプリ側の同期のコードを変えずに使えるようにしてある。

  data/users/<自分のID>/...   自分だけが読み書きできる（お気に入り・メモなど）
  shared/...                   ログインした全員が読み書きできる（星・訪問・店の編集など）

<自分のID> はメールアドレスから作る（メールそのものは保存しない）。
*/

const MAX_BODY = 200 * 1024;
const PATH_RE = /^[A-Za-z0-9_\-~.%　-鿿＀-￯/]{1,300}$/;

let jwksCache = null; // { at, keys }

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function getJwks(env) {
  // テスト用: 鍵を環境変数で渡せる。本番では設定しない
  if (env.ACCESS_JWKS_JSON) return JSON.parse(env.ACCESS_JWKS_JSON).keys;
  const now = Date.now();
  if (jwksCache && now - jwksCache.at < 3600e3) return jwksCache.keys;
  const res = await fetch('https://' + env.ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs');
  if (!res.ok) throw new Error('certs ' + res.status);
  const keys = (await res.json()).keys || [];
  jwksCache = { at: now, keys };
  return keys;
}

// Access の証明を検証して、ログインしたメールアドレスを返す。だめなら null
export async function verifyAccess(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    if (header.alg !== 'RS256') return null;
    const jwk = (await getJwks(env)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) return null;
    const aud = [].concat(payload.aud || []);
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (payload.iss !== 'https://' + env.ACCESS_TEAM_DOMAIN) return null;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return typeof payload.email === 'string' && payload.email ? payload.email.toLowerCase() : null;
  } catch (e) {
    return null;
  }
}

async function uidOf(email) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ekimae:' + email));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

let ready = null;
function ensureTables(env) {
  if (!ready) {
    ready = env.DB.batch([
      env.DB.prepare('CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS scopes (scope TEXT PRIMARY KEY, ver INTEGER NOT NULL)'),
    ]).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// どのパスを触れるか。自分の領域と共有の領域だけ。
// 戻り値は「どの版数を進めるか」（自分の領域なら uid、共有なら 'shared'）
function scopeOf(path, uid) {
  if (!PATH_RE.test(path) || path.includes('..') || path.includes('//') || path.startsWith('/') || path.endsWith('/')) return null;
  if (path.startsWith('data/users/' + uid + '/')) return uid;
  if (path.startsWith('shared/')) return 'shared';
  return null;
}

function bump(env, scope) {
  return env.DB.prepare(
    'INSERT INTO scopes (scope, ver) VALUES (?1, 1) ON CONFLICT(scope) DO UPDATE SET ver = ver + 1').bind(scope);
}

export async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const email = await verifyAccess(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  if (!env.DB) return json({ error: 'no_database' }, 503);
  await ensureTables(env);
  const uid = await uidOf(email);

  if (url.pathname === '/api/me') return json({ uid, email });

  // 版数。自分の領域と共有の領域のどちらかが変わったかだけを安く調べる
  if (url.pathname === '/api/ver') {
    const rows = await env.DB.prepare('SELECT scope, ver FROM scopes WHERE scope IN (?1, ?2)').bind(uid, 'shared').all();
    const v = { mine: 0, shared: 0 };
    for (const r of rows.results || []) v[r.scope === 'shared' ? 'shared' : 'mine'] = r.ver;
    return json(v);
  }

  if (url.pathname !== '/api/db') return json({ error: 'not_found' }, 404);

  // GET ?path=...        → 1件
  // GET ?coll=...        → 直下の子を全部（孫は含めない）
  if (request.method === 'GET') {
    const coll = url.searchParams.get('coll');
    if (coll !== null) {
      if (!scopeOf(coll + '/x', uid)) return json({ error: 'forbidden' }, 403);
      const rows = await env.DB.prepare('SELECT path, body FROM docs WHERE path >= ?1 AND path < ?2')
        .bind(coll + '/', coll + '0').all();
      const docs = [];
      for (const r of rows.results || []) {
        const id = r.path.slice(coll.length + 1);
        if (id.includes('/')) continue;
        docs.push({ id, data: JSON.parse(r.body) });
      }
      return json({ docs });
    }
    const path = url.searchParams.get('path') || '';
    if (!scopeOf(path, uid)) return json({ error: 'forbidden' }, 403);
    const row = await env.DB.prepare('SELECT body FROM docs WHERE path = ?1').bind(path).first();
    return json(row ? { exists: true, data: JSON.parse(row.body) } : { exists: false });
  }

  if (request.method === 'PUT' || request.method === 'DELETE') {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: 'too_large' }, 413);
    let req;
    try { req = JSON.parse(text); } catch (e) { return json({ error: 'bad_json' }, 400); }
    const path = String(req.path || '');
    const scope = scopeOf(path, uid);
    if (!scope) return json({ error: 'forbidden' }, 403);
    if (request.method === 'PUT') {
      if (req.data === undefined || req.data === null) return json({ error: 'no_data' }, 400);
      await env.DB.batch([
        env.DB.prepare('INSERT INTO docs (path, body, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(path) DO UPDATE SET body = ?2, updated_at = ?3')
          .bind(path, JSON.stringify(req.data), Date.now()),
        bump(env, scope),
      ]);
    } else {
      await env.DB.batch([env.DB.prepare('DELETE FROM docs WHERE path = ?1').bind(path), bump(env, scope)]);
    }
    return json({ ok: true });
  }
  return json({ error: 'method_not_allowed' }, 405);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleApi(request, env, ctx);
    } catch (e) {
      return json({ error: 'server_error' }, 500);
    }
  },
};
