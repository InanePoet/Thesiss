import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Chapter, DayStat, FullText, Note, SavedSearch, Snapshot, Source } from './types';

interface ThesisDB extends DBSchema {
  chapters: { key: string; value: Chapter };
  sources: { key: string; value: Source; indexes: { doi: string } };
  notes: { key: string; value: Note };
  searches: { key: string; value: SavedSearch };
  snapshots: { key: string; value: Snapshot; indexes: { ts: number } };
  fulltext: { key: string; value: FullText };
  days: { key: string; value: DayStat };
  kv: { key: string; value: unknown };
}

export const SCHEMA = 1;
let dbp: Promise<IDBPDatabase<ThesisDB>> | null = null;

export function db() {
  if (!dbp) {
    dbp = openDB<ThesisDB>('thesiss', SCHEMA, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore('chapters', { keyPath: 'id' });
          const s = d.createObjectStore('sources', { keyPath: 'id' });
          s.createIndex('doi', 'doi');
          d.createObjectStore('notes', { keyPath: 'id' });
          d.createObjectStore('searches', { keyPath: 'id' });
          const sn = d.createObjectStore('snapshots', { keyPath: 'id' });
          sn.createIndex('ts', 'ts');
          d.createObjectStore('fulltext', { keyPath: 'sourceId' });
          d.createObjectStore('days', { keyPath: 'date' });
          d.createObjectStore('kv');
        }
        // migrazioni future: if (oldVersion < 2) { ... }
      },
      blocked() {},
      blocking() { dbp = null; },
    });
  }
  return dbp;
}

/* ---------- piccolo bus per notificare le viste ---------- */
type Topic = 'chapters' | 'sources' | 'notes' | 'searches' | 'kv' | 'days' | 'save' | 'fulltext';
const subs = new Map<Topic, Set<() => void>>();
export function on(topic: Topic, fn: () => void) {
  if (!subs.has(topic)) subs.set(topic, new Set());
  subs.get(topic)!.add(fn);
  return () => { subs.get(topic)!.delete(fn); };
}
export function emit(topic: Topic) {
  subs.get(topic)?.forEach((f) => f());
  if (topic !== 'save' && topic !== 'days') changeHook?.(topic);
}
let changeHook: ((t: Topic) => void) | null = null;
export function setChangeHook(fn: (t: Topic) => void) { changeHook = fn; }

/* ---------- accesso generico ---------- */
export async function all<S extends 'chapters' | 'sources' | 'notes' | 'searches' | 'days' | 'fulltext'>(store: S) {
  return (await db()).getAll(store) as Promise<ThesisDB[S]['value'][]>;
}
export async function get<S extends 'chapters' | 'sources' | 'notes' | 'searches' | 'fulltext'>(store: S, key: string) {
  return (await db()).get(store, key) as Promise<ThesisDB[S]['value'] | undefined>;
}
export async function put<S extends 'chapters' | 'sources' | 'notes' | 'searches' | 'days' | 'fulltext'>(store: S, value: ThesisDB[S]['value']) {
  await (await db()).put(store, value as never);
  emit(store);
}
export async function putMany<S extends 'chapters' | 'sources' | 'notes' | 'searches'>(store: S, values: ThesisDB[S]['value'][]) {
  const tx = (await db()).transaction(store, 'readwrite');
  for (const v of values) tx.store.put(v as never);
  await tx.done;
  emit(store);
}
export async function del(store: 'chapters' | 'sources' | 'notes' | 'searches' | 'fulltext', key: string) {
  await (await db()).delete(store, key);
  emit(store);
}

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const v = (await (await db()).get('kv', key)) as T | undefined;
  if (v === undefined) return fallback;
  if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) return { ...fallback, ...(v as object) } as T;
  return v;
}
export async function kvSet(key: string, value: unknown, silent = false) {
  await (await db()).put('kv', value, key);
  if (!silent) emit('kv');
}
export async function kvAll(): Promise<Record<string, unknown>> {
  const d = await db();
  const keys = await d.getAllKeys('kv');
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = await d.get('kv', k);
  return out;
}

/* ---------- snapshot ---------- */
export async function addSnapshot(s: Snapshot) {
  const d = await db();
  await d.put('snapshots', s);
}
export async function listSnapshots(): Promise<Snapshot[]> {
  const d = await db();
  const all = await d.getAllFromIndex('snapshots', 'ts');
  return all.reverse();
}
export async function deleteSnapshot(id: string) {
  await (await db()).delete('snapshots', id);
}
export async function getSnapshot(id: string) {
  return (await db()).get('snapshots', id);
}
