import { useEffect, useMemo, useState } from 'react';
import { keywords } from '../lib/analysis';
import { bibEntry, chicagoNote, plain } from '../lib/cite';
import { del, get, put } from '../lib/db';
import { pickFile } from '../lib/platform';
import { back, nav } from '../lib/router';
import { fromInput, readPdf, byDoi } from '../lib/search/importers';
import { hitKey } from '../lib/search/providers';
import { addSourceFromHit, updateSource, useNotes, useRequirements, useSources } from '../lib/store';
import type { Note, Source } from '../lib/types';
import { uid } from '../lib/util';
import { Icon } from '../ui/Icon';
import { AppBar, Field, Sheet, toast } from '../ui/kit';
import { LinksSheet, STATUS_LABEL } from './Sources';

const TYPES: [Source['type'], string][] = [['article', 'Articolo'], ['book', 'Libro'], ['chapter', 'Capitolo di libro'], ['thesis', 'Tesi'], ['report', 'Rapporto'], ['law', 'Norma / documento ufficiale'], ['web', 'Pagina web'], ['other', 'Altro']];

export function SourceDetail({ id }: { id: string }) {
  const [sources] = useSources();
  const [notes] = useNotes();
  const [req] = useRequirements();
  const s = sources.find((x) => x.id === id);
  const [links, setLinks] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ftLen, setFtLen] = useState<number | null>(null);
  const [tagInput, setTagInput] = useState('');
  useEffect(() => { get('fulltext', id).then((f) => setFtLen(f ? f.text.length : null)); }, [id, s?.hasFullText]);
  const related = useMemo(() => notes.filter((n) => n.sourceIds.includes(id)), [notes, id]);
  const suggested = useMemo(() => {
    if (!s) return [] as Note[];
    const text = (s.title + ' ' + (s.abstract || '') + ' ' + s.keywords.join(' ')).toLowerCase();
    return notes.filter((n) => !n.sourceIds.includes(id) && [n.title, ...n.aliases].some((t) => t.length > 2 && text.includes(t.toLowerCase())));
  }, [notes, s, id]);

  if (!s) return <div className="screen no-nav"><AppBar title="Fonte" onBack={() => back('sources')} /><p className="wrap muted">Fonte non trovata.</p></div>;
  const set = (patch: Partial<Source>) => void updateSource(s.id, patch);

  const attachPdf = async () => {
    const f = await pickFile('application/pdf,.pdf');
    if (!f) return;
    toast('Leggo il PDF…');
    try {
      const r = await readPdf(await f.arrayBuffer());
      await put('fulltext', { sourceId: s.id, text: r.text, pages: r.pages });
      const kw = keywords(r.text, 15);
      const patch: Partial<Source> = { hasFullText: true, keywords: [...new Set([...s.keywords, ...kw])].slice(0, 25) };
      if (!s.doi && r.doi) patch.doi = r.doi;
      set(patch);
      toast(`Testo estratto: ${r.pages} pagine, ${kw.length} parole chiave.`);
    } catch (e) { toast('PDF non leggibile: ' + (e as Error).message); }
  };
  const linkNote = async (n: Note) => put('notes', { ...n, sourceIds: [...new Set([...n.sourceIds, s.id])], updatedAt: Date.now() });
  const newConcept = async (title: string) => {
    const existing = notes.find((n) => n.title.toLowerCase() === title.toLowerCase());
    if (existing) { await linkNote(existing); toast('Collegata a "' + existing.title + '"'); return; }
    const n: Note = { id: uid(), title: title.charAt(0).toUpperCase() + title.slice(1), aliases: [], body: '', tags: [], sourceIds: [s.id], createdAt: Date.now(), updatedAt: Date.now() };
    await put('notes', n);
    toast('Concetto creato');
  };

  return (
    <div className="screen no-nav">
      <AppBar title="Fonte" onBack={() => back('sources')} actions={<>
        <button className="iconbtn" aria-label="Apri" onClick={() => setLinks(true)}><Icon name="external" /></button>
        <button className={'iconbtn' + (editing ? ' on' : '')} aria-label="Modifica dati" onClick={() => setEditing((v) => !v)}><Icon name="pen" /></button>
      </>} />
      <div className="wrap">
        {!editing ? (
          <>
            <h2 className="serif" style={{ fontSize: 23, lineHeight: 1.3, margin: '4px 0 6px' }}>{s.title}</h2>
            {s.titleAlt && <div className="serif muted">{s.titleAlt}</div>}
            <div className="muted">{s.authors.join(', ') || 'Autore sconosciuto'}</div>
            <div className="small muted">{[s.venue, s.volume && `vol. ${s.volume}`, s.issue && `n. ${s.issue}`, s.pages && `pp. ${s.pages}`, s.year].filter(Boolean).join(' · ')}</div>
          </>
        ) : (
          <SourceForm s={s} onChange={set} />
        )}

        <div className="section-title">Stato</div>
        <div className="chips">
          {(Object.keys(STATUS_LABEL) as Source['status'][]).map((k) => (
            <button key={k} className={'chip' + (s.status === k ? ' on' : '')} onClick={() => set({ status: k })}>{STATUS_LABEL[k]}</button>
          ))}
        </div>

        <div className="section-title">Note di lettura</div>
        <textarea className="textarea serif" rows={5} placeholder="Tesi dell'autore, passaggi utili con pagina, critiche…" defaultValue={s.notes} onBlur={(e) => e.target.value !== s.notes && set({ notes: e.target.value })} />

        <div className="section-title">Tag</div>
        <div className="chips">
          {s.tags.map((t) => <button key={t} className="chip on" onClick={() => set({ tags: s.tags.filter((x) => x !== t) })}>{t} <Icon name="x" size={14} /></button>)}
          <form onSubmit={(e) => { e.preventDefault(); const t = tagInput.trim(); if (t) { set({ tags: [...new Set([...s.tags, t])] }); setTagInput(''); } }}>
            <input className="chip" style={{ width: 140 }} placeholder="+ tag (es. cap. 2)" value={tagInput} onChange={(e) => setTagInput(e.target.value)} />
          </form>
        </div>

        <div className="section-title">Concetti</div>
        {related.length > 0 && <div className="chips" style={{ marginBottom: 8 }}>{related.map((n) => <button key={n.id} className="chip on" onClick={() => nav('map/note/' + n.id)}>{n.title}</button>)}</div>}
        {suggested.length > 0 && (
          <div className="small" style={{ marginBottom: 8 }}>
            <span className="muted">Probabilmente parla anche di: </span>
            <span className="chips" style={{ display: 'inline-flex', marginTop: 4 }}>{suggested.map((n) => <button key={n.id} className="chip" onClick={() => void linkNote(n)}>+ {n.title}</button>)}</span>
          </div>
        )}
        {s.keywords.length > 0 && (
          <>
            <div className="tiny muted" style={{ margin: '4px 0 6px' }}>Parole chiave: tocca per crearne un concetto e collegarlo</div>
            <div className="chips">{s.keywords.slice(0, 20).map((k) => <button key={k} className="chip" onClick={() => void newConcept(k)}>{k}</button>)}</div>
          </>
        )}

        {s.abstract && (<><div className="section-title">Abstract</div><p className="serif" style={{ lineHeight: 1.6, margin: 0 }}>{s.abstract}</p></>)}

        <div className="section-title">Testo completo</div>
        {ftLen ? <p className="small muted" style={{ margin: '0 0 8px' }}>PDF letto: {Math.round(ftLen / 1000)}k caratteri disponibili per la ricerca nei concetti.</p> : <p className="small muted" style={{ margin: '0 0 8px' }}>Scarica il PDF (anche con il tuo login) e allegalo: ne estraggo testo e parole chiave, senza AI.</p>}
        <div className="row">
          <button className="btn grow" onClick={attachPdf}><Icon name="upload" /> {ftLen ? 'Sostituisci PDF' : 'Allega PDF'}</button>
          {ftLen ? <button className="btn" onClick={async () => { await del('fulltext', s.id); set({ hasFullText: false }); }}>Rimuovi</button> : null}
        </div>

        <div className="section-title">Come verrà citata</div>
        <div className="card small serif">
          <div><span className="muted">Nota: </span>{plain(chicagoNote(s))}</div>
          <div style={{ marginTop: 8 }}><span className="muted">Bibliografia: </span>{plain(bibEntry(s, req.citationStyle))}</div>
        </div>

        <button className="btn danger block" style={{ marginTop: 24 }} onClick={async () => {
          await del('sources', s.id);
          back('sources');
          toast('Fonte eliminata', { label: 'Annulla', run: () => void put('sources', s) });
        }}><Icon name="trash" /> Elimina fonte</button>
      </div>
      {links && <LinksSheet hit={s} onClose={() => setLinks(false)} />}
    </div>
  );
}

function SourceForm({ s, onChange }: { s: Source; onChange: (p: Partial<Source>) => void }) {
  const txt = (k: keyof Source, label: string, hint?: string) => (
    <Field label={label} hint={hint}><input className="input" defaultValue={(s[k] as string) || ''} onBlur={(e) => onChange({ [k]: e.target.value || undefined } as Partial<Source>)} /></Field>
  );
  return (
    <div style={{ marginTop: 8 }}>
      <Field label="Tipo">
        <select className="select" value={s.type} onChange={(e) => onChange({ type: e.target.value as Source['type'] })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      {txt('title', 'Titolo')}
      {txt('titleAlt', 'Titolo originale / traduzione')}
      <Field label="Autori" hint="Uno per riga. Scrivi «Cognome, Nome» se il nome è ambiguo.">
        <textarea className="textarea" defaultValue={s.authors.join('\n')} onBlur={(e) => onChange({ authors: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />
      </Field>
      <div className="grid2">
        <Field label="Anno"><input className="input num" inputMode="numeric" defaultValue={s.year || ''} onBlur={(e) => onChange({ year: parseInt(e.target.value, 10) || undefined })} /></Field>
        {txt('pages', 'Pagine')}
      </div>
      {txt('venue', s.type === 'chapter' ? 'Titolo del volume' : 'Rivista')}
      <div className="grid2">{txt('volume', 'Volume')}{txt('issue', 'Numero')}</div>
      <div className="grid2">{txt('publisher', 'Editore')}{txt('place', 'Luogo')}</div>
      {txt('doi', 'DOI')}
      {txt('url', 'Link')}
    </div>
  );
}

/* --------------------------- aggiunta fonte --------------------------- */

export function AddSourceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sources] = useSources();
  const go = async () => {
    setBusy(true);
    const { kvGet } = await import('../lib/db');
    const st = await kvGet<{ mailto: string }>('settings', { mailto: '' });
    const r = await fromInput(input, st.mailto);
    setBusy(false);
    if (!r.hit) { toast(r.message || 'Non trovato'); return; }
    const s = await addSourceFromHit(r.hit);
    setInput('');
    onClose();
    nav('source/' + s.id);
  };
  const fromPdf = async () => {
    const f = await pickFile('application/pdf,.pdf');
    if (!f) return;
    setBusy(true);
    toast('Leggo il PDF…');
    try {
      const r = await readPdf(await f.arrayBuffer());
      let hit = r.doi ? await byDoi(r.doi) : null;
      if (!hit) {
        const title = r.title || f.name.replace(/\.pdf$/i, '');
        hit = { type: 'article', title, authors: [], keywords: [], provider: 'pdf', key: '', sources: ['pdf'] };
        hit.key = hitKey(hit);
      }
      const existing = sources.find((s) => hitKey(s) === hit!.key);
      const s = existing || (await addSourceFromHit(hit));
      await put('fulltext', { sourceId: s.id, text: r.text, pages: r.pages });
      await updateSource(s.id, { hasFullText: true, keywords: [...new Set([...s.keywords, ...keywords(r.text, 15)])].slice(0, 25) });
      onClose();
      nav('source/' + s.id);
      toast(r.doi ? 'Dati trovati tramite il DOI del PDF.' : 'Controlla titolo e autori: il PDF non aveva un DOI.');
    } catch (e) { toast('PDF non leggibile: ' + (e as Error).message); }
    setBusy(false);
  };
  const manual = async () => {
    const s: Source = { id: uid(), type: 'book', title: input.trim() || 'Nuova fonte', authors: [], keywords: [], provider: 'manual', status: 'toread', tags: [], notes: '', addedAt: Date.now(), updatedAt: Date.now() };
    await put('sources', s);
    onClose();
    nav('source/' + s.id);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Aggiungi una fonte">
      <Field label="Link o DOI" hint="Pagina di un articolo (J-STAGE, JSTOR, editori, riviste…) o DOI: leggo i metadati della pagina.">
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://… oppure 10.1234/…" autoFocus />
      </Field>
      <button className="btn primary block" disabled={busy || !input.trim()} onClick={go}>{busy ? 'Cerco…' : 'Recupera i dati'}</button>
      <hr className="sep" />
      <div className="list">
        <button className="item" disabled={busy} onClick={fromPdf}><Icon name="file" /><span className="grow"><span className="title">Da un PDF scaricato</span><br /><span className="meta">Estraggo testo, DOI e parole chiave</span></span></button>
        <button className="item" onClick={manual}><Icon name="pen" /><span className="grow"><span className="title">A mano</span><br /><span className="meta">Libri, fonti d'archivio, documenti ufficiali, leggi</span></span></button>
      </div>
    </Sheet>
  );
}
