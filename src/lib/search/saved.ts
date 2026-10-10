import { all, put } from '../db';
import { kvGet } from '../db';
import { DEFAULT_SETTINGS } from '../defaults';
import type { SavedSearch, Settings } from '../types';
import { searchAll, type Hit } from './providers';

export async function runSaved(s: SavedSearch, settings?: Settings): Promise<{ fresh: Hit[]; all: Hit[] }> {
  const st = settings || (await kvGet<Settings>('settings', DEFAULT_SETTINGS));
  const r = await searchAll({ query: s.query, yearFrom: s.yearFrom, settings: st, limit: 25 }, s.providers.length ? s.providers : st.providers);
  const seen = new Set(s.seen);
  const fresh = r.hits.filter((h) => !seen.has(h.key));
  // la prima esecuzione segna tutto come visto
  const first = !s.lastRun;
  await put('searches', {
    ...s,
    lastRun: Date.now(),
    seen: [...new Set([...s.seen, ...r.hits.map((h) => h.key)])].slice(-2000),
    newCount: first ? 0 : s.newCount + fresh.length,
  });
  const cache = await kvGet<Record<string, Hit[]>>('searchCache', {});
  cache[s.id] = (first ? [] : fresh).concat(cache[s.id] || []).slice(0, 100);
  const { kvSet } = await import('../db');
  await kvSet('searchCache', cache, true);
  return { fresh: first ? [] : fresh, all: r.hits };
}

/** Aggiorna le ricerche salvate non eseguite nelle ultime `hours` ore. */
export async function refreshStale(hours = 20): Promise<number> {
  const list = await all('searches');
  let total = 0;
  for (const s of list) {
    if (s.lastRun && Date.now() - s.lastRun < hours * 3600e3) continue;
    try { total += (await runSaved(s)).fresh.length; } catch { /* rete assente */ }
  }
  return total;
}

export async function newHits(id: string): Promise<Hit[]> {
  const cache = await kvGet<Record<string, Hit[]>>('searchCache', {});
  return cache[id] || [];
}
