// chrome.storage.local の薄いラッパー。拡張機能の外で開いたときはメモリに置く
const area = globalThis.chrome?.storage?.local;
const mem = new Map();

export async function get(key, fallback = undefined) {
  if (!area) return mem.has(key) ? mem.get(key) : fallback;
  const r = await area.get(key);
  return key in r ? r[key] : fallback;
}

export async function set(key, value) {
  if (!area) return void mem.set(key, value);
  await area.set({ [key]: value });
}

export async function removeByPrefix(prefix) {
  if (!area) {
    for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k);
    return;
  }
  const all = await area.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(prefix));
  if (keys.length) await area.remove(keys);
}
