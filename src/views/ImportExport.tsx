import { useEffect, useState } from 'react';
import { buildBackup, flushMirror, restoreBackup, snapshot, status, validateBackup } from '../lib/backup';
import { all, del, getSnapshot, listSnapshots, on, putMany } from '../lib/db';
import { isNative, pickFile, saveExport } from '../lib/platform';
import { back } from '../lib/router';
import { useMeta, useRequirements } from '../lib/store';
import type { Chapter, Snapshot } from '../lib/types';
import { dateTime, n, timeAgo, today } from '../lib/util';
import { Icon } from '../ui/Icon';
import { AppBar, Sheet, toast } from '../ui/kit';

async function busy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  toast(label + '…');
  try { return await fn(); } catch (e) { toast('Errore: ' + (e as Error).message); return undefined; }
}

export async function exportAll(kind: 'docx' | 'md' | 'json') {
  const [chapters, sources] = await Promise.all([all('chapters'), all('sources')]);
  const { kvGet } = await import('../lib/db');
  const { DEFAULT_REQUIREMENTS } = await import('../lib/defaults');
  const { DEFAULT_META } = await import('../lib/store');
  const req = await kvGet('requirements', DEFAULT_REQUIREMENTS);
  const meta = await kvGet('meta', DEFAULT_META);
  const base = (meta.title || 'tesi').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40).toLowerCase();
  if (kind === 'json') {
    const b = await buildBackup(true);
    const where = await saveExport(`thesiss-backup-${today()}.json`, JSON.stringify(b), 'application/json');
    toast('Backup salvato: ' + where);
    return;
  }
  const io = await import('../lib/docxio');
  if (kind === 'docx') {
    const blob = await io.exportDocx(chapters, sources, req, meta);
    const where = await saveExport(`${base}-${today()}.docx`, blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    toast('DOCX salvato: ' + where);
  } else {
    const md = io.exportMarkdown(chapters, sources, req, meta);
    const where = await saveExport(`${base}-${today()}.md`, md, 'text/markdown');
    toast('Markdown salvato: ' + where);
  }
}

export function ImportSheet({ open, onClose, chapters }: { open: boolean; onClose: () => void; chapters: Chapter[] }) {
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const doImport = async () => {
    const f = await pickFile('.docx,.md,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown');
    if (!f) return;
    await busy('Importazione', async () => {
      const io = await import('../lib/docxio');
      const start = mode === 'append' ? chapters.length : 0;
      let list: Chapter[];
      let warnings: string[] = [];
      if (/\.docx$/i.test(f.name)) { const r = await io.importDocx(await f.arrayBuffer(), start); list = r.chapters; warnings = r.warnings; }
      else list = io.importPlainText(await f.text(), start);
      if (!list.length) throw new Error('il file non contiene testo');
      if (mode === 'replace') {
        await snapshot('prima dell’importazione', true);
        for (const c of chapters) await del('chapters', c.id);
      }
      await putMany('chapters', list);
      toast(`Importati ${list.length} capitoli${warnings.length ? ' (con qualche formattazione non riconosciuta)' : ''}.`);
      onClose();
    });
  };
  return (
    <Sheet open={open} onClose={onClose} title="Importa ed esporta">
      <div className="section-title" style={{ marginTop: 0 }}>Importa un documento</div>
      <p className="small muted" style={{ marginTop: -4 }}>DOCX (anche scaricato da Google Docs: File › Scarica › Microsoft Word), Markdown o testo. Ogni "Titolo 1" diventa un capitolo; le note a piè di pagina vengono conservate.</p>
      <div className="seg" style={{ marginBottom: 10 }}>
        <button className={mode === 'append' ? 'on' : ''} onClick={() => setMode('append')}>Aggiungi in fondo</button>
        <button className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')}>Sostituisci tutto</button>
      </div>
      <button className="btn block" onClick={doImport}><Icon name="upload" /> Scegli il file</button>
      <div className="section-title">Esporta la tesi</div>
      <div className="list">
        <button className="item" onClick={() => void busy('Creo il DOCX', () => exportAll('docx'))}><Icon name="file" /><span className="grow"><span className="title">Word (.docx)</span><br /><span className="meta">Con frontespizio, indice, note, bibliografia e formato dei requisiti. Si apre anche in Google Docs.</span></span></button>
        <button className="item" onClick={() => void busy('Creo il Markdown', () => exportAll('md'))}><Icon name="file" /><span className="grow"><span className="title">Markdown (.md)</span><br /><span className="meta">Testo semplice con note, utile per Obsidian o Pandoc</span></span></button>
        <button className="item" onClick={() => void busy('Creo il backup', () => exportAll('json'))}><Icon name="shield" /><span className="grow"><span className="title">Backup completo (.json)</span><br /><span className="meta">Tutto: testo, fonti, concetti, impostazioni</span></span></button>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */

export function BackupView() {
  const [, force] = useState(0);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [preview, setPreview] = useState<{ s: Snapshot; chapters: { title: string; chars: number }[] } | null>(null);
  useEffect(() => {
    const load = () => listSnapshots().then(setSnaps);
    load();
    const off1 = on('save', () => { force((x) => x + 1); load(); });
    const t = setInterval(() => force((x) => x + 1), 15000);
    return () => { off1(); clearInterval(t); };
  }, []);

  const restoreFile = async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!validateBackup(data)) { toast('Il file non è un backup di Thesiss.'); return; }
      if (!window.confirm(`Ripristinare il backup del ${dateTime(data.exportedAt)}? Lo stato attuale viene salvato prima in cronologia.`)) return;
      await restoreBackup(data);
      toast('Backup ripristinato.');
    } catch (e) { toast('File non leggibile: ' + (e as Error).message); }
  };
  const openSnap = async (s: Snapshot) => {
    const full = await getSnapshot(s.id);
    if (!full) return;
    const b = JSON.parse(full.data);
    const { blocks, count } = await import('../lib/analysis');
    setPreview({ s: full, chapters: b.data.chapters.sort((a: Chapter, c: Chapter) => a.order - c.order).map((c: Chapter) => ({ title: c.title, chars: count(blocks(c.content)).chars })) });
  };
  const restoreSnap = async (s: Snapshot) => {
    if (!window.confirm('Ripristinare questa versione? Lo stato attuale viene salvato prima in cronologia.')) return;
    await restoreBackup(JSON.parse(s.data));
    setPreview(null);
    toast('Versione ripristinata.');
  };
  const layers = [
    { ok: status.lastDb > 0 || true, title: 'Salvataggio automatico nell’app', detail: status.lastDb ? `ultimo: ${timeAgo(status.lastDb)}` : 'a ogni modifica, dopo meno di un secondo' },
    { ok: snaps.length > 0, title: 'Cronologia delle versioni', detail: `${snaps.length} versioni · una ogni 10 minuti di lavoro, poi una al giorno per 90 giorni` },
    {
      ok: isNative() ? !!status.lastFile && !status.fileError : false,
      title: 'Copia su file nel telefono',
      detail: isNative() ? (status.fileError || `${status.fileWhere || 'Documenti/Thesiss'} · ${timeAgo(status.lastFile)} · sopravvive alla disinstallazione`) : 'disponibile nell’app Android',
    },
    { ok: null as boolean | null, title: 'Google Drive', detail: 'in arrivo nella prossima versione' },
  ];
  return (
    <div className="screen no-nav">
      <AppBar title="Backup e versioni" onBack={() => back('more')} />
      <div className="wrap">
        <div className="list">
          {layers.map((l, i) => (
            <div key={i} className="check">
              <span className={'mark ' + (l.ok === null ? 'na' : l.ok ? 'ok' : 'no')}><Icon name={l.ok === null ? 'clock' : l.ok ? 'check' : 'x'} size={16} /></span>
              <div className="grow"><div style={{ fontWeight: 600 }}>{l.title}</div><div className="small muted">{l.detail}</div></div>
            </div>
          ))}
        </div>
        {status.persisted === false && <div className="notice warn" style={{ marginTop: 10 }}>Il sistema non garantisce la conservazione dei dati del browser: tieni attiva la copia su file o esporta spesso.</div>}
        <div className="row wrap-row" style={{ marginTop: 12 }}>
          <button className="btn primary grow" onClick={async () => { await snapshot('manuale', true); await flushMirror(); toast('Salvato ora.'); }}><Icon name="shield" /> Salva ora</button>
          <button className="btn grow" onClick={() => void exportAll('json')}><Icon name="download" /> Esporta backup</button>
        </div>
        <button className="btn block" style={{ marginTop: 10 }} onClick={restoreFile}><Icon name="upload" /> Ripristina da file</button>
        <p className="tiny muted">Dopo una reinstallazione, ripristina dal file più recente in Documenti/Thesiss (thesiss-backup-A o -B) o dalla cartella giornalieri.</p>

        <div className="section-title">Cronologia</div>
        {snaps.length === 0 ? <p className="muted small">Le versioni compaiono dopo i primi minuti di scrittura.</p> : (
          <div className="list">
            {snaps.slice(0, 80).map((s) => (
              <button key={s.id} className="item" onClick={() => void openSnap(s)}>
                <Icon name="clock" />
                <span className="grow"><span className="title">{dateTime(s.ts)}</span><br /><span className="meta">{s.reason} · {n(s.data.length / 1024)} KB</span></span>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
        )}
      </div>
      <Sheet open={!!preview} onClose={() => setPreview(null)} title={preview ? dateTime(preview.s.ts) : ''}>
        {preview && (
          <>
            <div className="list">
              {preview.chapters.map((c, i) => <div key={i} className="item"><span className="grow">{c.title}</span><span className="small muted num">{n(c.chars)}</span></div>)}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn danger" onClick={async () => { await (await import('../lib/db')).deleteSnapshot(preview.s.id); setPreview(null); setSnaps(await listSnapshots()); }}>Elimina</button>
              <span className="grow" />
              <button className="btn primary" onClick={() => void restoreSnap(preview.s)}>Ripristina questa versione</button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
