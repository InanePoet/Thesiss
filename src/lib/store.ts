import { useCallback, useEffect, useRef, useState } from 'react';
import { all, emit, get, kvGet, kvSet, on, put } from './db';
import { DEFAULT_DESIGN, DEFAULT_REQUIREMENTS, DEFAULT_SETTINGS, starterChapters } from './defaults';
import type { Chapter, Requirements, ResearchDesign, Settings, Source } from './types';
import { today, uid } from './util';
import type { Hit } from './search/providers';
import { hitKey } from './search/providers';

type Topic = Parameters<typeof on>[0];

export function useLive<T>(topics: Topic[], load: () => Promise<T>, init: T, deps: unknown[] = []): [T, boolean] {
  const [v, setV] = useState<T>(init);
  const [ready, setReady] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let alive = true;
    const run = () => loadRef.current().then((x) => { if (alive) { setV(x); setReady(true); } });
    run();
    const offs = topics.map((t) => on(t, run));
    return () => { alive = false; offs.forEach((o) => o()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [v, ready];
}

export function useKV<T>(key: string, def: T): [T, (v: T | ((p: T) => T)) => void, boolean] {
  const [v, ready] = useLive<T>(['kv'], () => kvGet<T>(key, def), def, [key]);
  const ref = useRef(v);
  ref.current = v;
  const set = useCallback((nv: T | ((p: T) => T)) => {
    const val = typeof nv === 'function' ? (nv as (p: T) => T)(ref.current) : nv;
    ref.current = val;
    void kvSet(key, val);
  }, [key]);
  return [v, set, ready];
}

export const useSettings = () => useKV<Settings>('settings', DEFAULT_SETTINGS);
export const useRequirements = () => useKV<Requirements>('requirements', DEFAULT_REQUIREMENTS);
export const useDesign = () => useKV<ResearchDesign>('design', DEFAULT_DESIGN);

export interface ThesisMeta { title: string; subtitle: string; author: string; university: string; department: string; course: string; supervisor: string; cosupervisor: string; year: string }
export const DEFAULT_META: ThesisMeta = { title: '', subtitle: '', author: '', university: '', department: '', course: '', supervisor: '', cosupervisor: '', year: '' };
export const useMeta = () => useKV<ThesisMeta>('meta', DEFAULT_META);

export function useChapters() {
  return useLive<Chapter[]>(['chapters'], async () => (await all('chapters')).sort((a, b) => a.order - b.order), []);
}
export function useSources() {
  return useLive<Source[]>(['sources'], async () => (await all('sources')).sort((a, b) => b.addedAt - a.addedAt), []);
}
export function useNotes() {
  return useLive(['notes'], async () => (await all('notes')).sort((a, b) => a.title.localeCompare(b.title, 'it')), []);
}
export function useSearches() {
  return useLive(['searches'], async () => (await all('searches')).sort((a, b) => b.createdAt - a.createdAt), []);
}

export async function ensureInit() {
  const chs = await all('chapters');
  if (!chs.length && !(await kvGet<boolean>('initialized', false))) {
    for (const c of starterChapters()) await put('chapters', c);
    await kvSet('initialized', true, true);
  }
}

export async function addSourceFromHit(h: Hit, status: Source['status'] = 'toread'): Promise<Source> {
  const existing = (await all('sources')).find((s) => hitKey(s) === h.key);
  if (existing) return existing;
  const { key: _k, sources: _s, ...rest } = h;
  const s: Source = { ...rest, id: uid(), status, tags: [], notes: '', addedAt: Date.now(), updatedAt: Date.now() };
  await put('sources', s);
  return s;
}

export async function updateSource(id: string, patch: Partial<Source>) {
  const s = await get('sources', id);
  if (!s) return;
  await put('sources', { ...s, ...patch, updatedAt: Date.now() });
}

/** Registra le battute scritte oggi (differenza rispetto al totale di inizio giornata). */
export async function recordProgress(total: number) {
  const d = today();
  const days = await all('days');
  const cur = days.find((x) => x.date === d);
  if (cur) {
    const base = cur.total - cur.chars;
    await put('days', { date: d, total, chars: Math.max(0, total - base) });
  } else {
    const prev = days.filter((x) => x.date < d).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const base = prev ? prev.total : total;
    await put('days', { date: d, total, chars: Math.max(0, total - base) });
  }
  emit('days');
}
