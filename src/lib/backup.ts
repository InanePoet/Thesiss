import { App } from '@capacitor/app';
import { addSnapshot, all, db, deleteSnapshot, emit, kvAll, kvGet, kvSet, listSnapshots, SCHEMA, setChangeHook } from './db';
import { BASE_DIR, Directory, Filesystem, isNative, writeText } from './platform';
import type { BackupFile, Chapter } from './types';
import { today, uid } from './util';

export interface SaveStatus {
  lastDb: number;
  lastFile: number;
  lastSnapshot: number;
  fileWhere: string;
  fileError: string;
  pending: boolean;
  persisted: boolean | null;
}

export const status: SaveStatus = { lastDb: 0, lastFile: 0, lastSnapshot: 0, fileWhere: '', fileError: '', pending: false, persisted: null };

export function markDbSaved() {
  status.lastDb = Date.now();
  emit('save');
}

export async function buildBackup(includeFulltext = true): Promise<BackupFile> {
  const [chapters, sources, notes, searches, days, kv] = await Promise.all([
    all('chapters'), all('sources'), all('notes'), all('searches'), all('days'), kvAll(),
  ]);
  const data: BackupFile['data'] = { chapters, sources, notes, searches, days, kv };
  if (includeFulltext) data.fulltext = await all('fulltext');
  return { app: 'thesiss', schema: SCHEMA, exportedAt: Date.now(), data };
}

export function validateBackup(x: unknown): x is BackupFile {
  const b = x as BackupFile;
  return !!b && b.app === 'thesiss' && typeof b.schema === 'number' && !!b.data && Array.isArray(b.data.chapters);
}

/** Ripristina un backup. Prima salva sempre uno snapshot dello stato attuale. */
export async function restoreBackup(b: BackupFile) {
  await snapshot('prima del ripristino', true);
  const d = await db();
  const tx = d.transaction(['chapters', 'sources', 'notes', 'searches', 'days', 'kv', 'fulltext'], 'readwrite');
  await Promise.all([
    tx.objectStore('chapters').clear(), tx.objectStore('sources').clear(), tx.objectStore('notes').clear(),
    tx.objectStore('searches').clear(), tx.objectStore('days').clear(), tx.objectStore('kv').clear(),
  ]);
  for (const c of b.data.chapters) tx.objectStore('chapters').put(c);
  for (const s of b.data.sources || []) tx.objectStore('sources').put(s);
  for (const n of b.data.notes || []) tx.objectStore('notes').put(n);
  for (const s of b.data.searches || []) tx.objectStore('searches').put(s);
  for (const s of b.data.days || []) tx.objectStore('days').put(s);
  for (const [k, v] of Object.entries(b.data.kv || {})) tx.objectStore('kv').put(v, k);
  if (b.data.fulltext) { await tx.objectStore('fulltext').clear(); for (const f of b.data.fulltext) tx.objectStore('fulltext').put(f); }
  await tx.done;
  (['chapters', 'sources', 'notes', 'searches', 'kv', 'days', 'fulltext'] as const).forEach(emit);
  scheduleMirror(true);
}

/* ---------- snapshot (cronologia versioni) ---------- */

const SNAP_EVERY = 10 * 60 * 1000;

function chars(chs: Chapter[]) {
  return chs.reduce((a, c) => a + JSON.stringify(c.content).length, 0);
}

export async function snapshot(reason: string, force = false) {
  if (!force && Date.now() - status.lastSnapshot < SNAP_EVERY) return;
  const b = await buildBackup(false);
  const json = JSON.stringify(b);
  await addSnapshot({ id: uid(), ts: Date.now(), reason, chars: chars(b.data.chapters), data: json });
  status.lastSnapshot = Date.now();
  await kvSet('lastSnapshot', status.lastSnapshot, true);
  await pruneSnapshots();
}

/** Tiene: tutte le ultime 48 ore (max 60), poi una al giorno per 90 giorni, quelle manuali per sempre. */
async function pruneSnapshots() {
  const list = await listSnapshots();
  const now = Date.now();
  const keepDays = new Set<string>();
  let recent = 0;
  for (const s of list) {
    if (s.reason.startsWith('manuale') || s.reason.startsWith('prima del')) continue;
    const age = now - s.ts;
    if (age < 48 * 3600e3 && recent < 60) { recent++; continue; }
    const d = today(new Date(s.ts));
    if (age < 90 * 86400e3 && !keepDays.has(d)) { keepDays.add(d); continue; }
    await deleteSnapshot(s.id);
  }
}

/* ---------- copia su file (sopravvive alla disinstallazione) ---------- */

let mirrorTimer: ReturnType<typeof setTimeout> | undefined;
let firstDirty = 0;
let writing = false;

export function scheduleMirror(urgent = false) {
  status.pending = true;
  emit('save');
  if (!firstDirty) firstDirty = Date.now();
  if (mirrorTimer) clearTimeout(mirrorTimer);
  const waited = Date.now() - firstDirty;
  const delay = urgent ? 50 : waited > 30000 ? 0 : 6000;
  mirrorTimer = setTimeout(() => void flushMirror(), delay);
}

export async function flushMirror() {
  if (mirrorTimer) { clearTimeout(mirrorTimer); mirrorTimer = undefined; }
  if (writing) { scheduleMirror(); return; }
  writing = true;
  firstDirty = 0;
  try {
    await snapshot('automatico');
    if (!isNative()) {
      status.fileWhere = '';
      status.fileError = 'Nel browser la copia su file non è disponibile: usa Esporta backup.';
      return;
    }
    const b = await buildBackup(true);
    const json = JSON.stringify(b);
    // due slot alternati: se una scrittura si interrompe, l'altro file resta integro
    const slot = ((await kvGet<number>('mirrorSlot', 0)) + 1) % 2;
    const name = `thesiss-backup-${slot ? 'B' : 'A'}.json`;
    const day = `${BASE_DIR}/giornalieri/thesiss-${today()}.json`;
    let where = 'Documenti';
    try {
      await writeText(`${BASE_DIR}/${name}`, json, Directory.Documents);
      await writeText(day, json, Directory.Documents);
    } catch (e) {
      // Android potrebbe negare la sovrascrittura dopo una reinstallazione: si usa un nome nuovo
      try {
        const alt = `${BASE_DIR}/thesiss-backup-${(await installId())}-${slot ? 'B' : 'A'}.json`;
        await writeText(alt, json, Directory.Documents);
        where = 'Documenti';
      } catch {
        await writeText(`${BASE_DIR}/${name}`, json, Directory.External);
        where = "memoria dell'app";
        status.fileError = 'Non riesco a scrivere in Documenti: la copia è nella memoria dell’app (si perde disinstallando). Esporta un backup.';
      }
    }
    await kvSet('mirrorSlot', slot, true);
    status.lastFile = Date.now();
    status.fileWhere = `${where}/${BASE_DIR}`;
    if (where === 'Documenti') status.fileError = '';
    await kvSet('lastFile', status.lastFile, true);
    await pruneDaily();
  } catch (e) {
    status.fileError = 'Errore nella copia su file: ' + (e as Error).message;
  } finally {
    writing = false;
    status.pending = false;
    emit('save');
  }
}

async function installId() {
  let id = await kvGet<string>('installId', '');
  if (!id) { id = uid().slice(0, 6); await kvSet('installId', id, true); }
  return id;
}

async function pruneDaily() {
  try {
    const r = await Filesystem.readdir({ path: `${BASE_DIR}/giornalieri`, directory: Directory.Documents });
    const files = r.files.map((f) => f.name).filter((n) => /^thesiss-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 30))) {
      await Filesystem.deleteFile({ path: `${BASE_DIR}/giornalieri/${f}`, directory: Directory.Documents });
    }
  } catch { /* cartella assente o non leggibile */ }
}

/* ---------- avvio ---------- */

export async function startBackup() {
  status.lastSnapshot = await kvGet<number>('lastSnapshot', 0);
  status.lastFile = await kvGet<number>('lastFile', 0);
  try {
    if (navigator.storage?.persist) status.persisted = await navigator.storage.persist();
  } catch { status.persisted = null; }
  if (isNative()) {
    try {
      const p = await Filesystem.checkPermissions();
      if (p.publicStorage !== 'granted') await Filesystem.requestPermissions();
    } catch { /* Android 11+: non serve */ }
    App.addListener('pause', () => { void flushMirror(); });
    App.addListener('appStateChange', (s) => { if (!s.isActive) void flushMirror(); });
  }
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushMirror(); });
  setChangeHook(() => scheduleMirror());
  emit('save');
}
