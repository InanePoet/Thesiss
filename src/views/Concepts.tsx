import { useEffect, useMemo, useRef, useState } from 'react';
import { blocks } from '../lib/analysis';
import { shortAuthors } from '../lib/cite';
import { all, del, put } from '../lib/db';
import { back, nav } from '../lib/router';
import { useChapters, useNotes, useSources } from '../lib/store';
import type { Note, Source } from '../lib/types';
import { normTitle, uid } from '../lib/util';
import { Icon } from '../ui/Icon';
import { AppBar, Empty, Field, Seg, Sheet, Switch, toast } from '../ui/kit';
import { GraphCanvas, type GLink, type GNode } from './Graph';

const WL = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function findNote(notes: Note[], name: string): Note | undefined {
  const k = name.trim().toLowerCase();
  return notes.find((n) => n.title.toLowerCase() === k || n.aliases.some((a) => a.toLowerCase() === k));
}

export function wikiTargets(body: string): string[] {
  return [...body.matchAll(WL)].map((m) => m[1].trim());
}

async function createNote(title: string, extra: Partial<Note> = {}): Promise<Note> {
  const n: Note = { id: uid(), title: title.trim(), aliases: [], body: '', tags: [], sourceIds: [], createdAt: Date.now(), updatedAt: Date.now(), ...extra };
  await put('notes', n);
  return n;
}

/* ============================ Mappa ============================ */

export function Concepts({ tab: tabProp }: { tab?: string }) {
  const tab = tabProp === 'list' ? 'list' : 'graph';
  const [notes, ready] = useNotes();
  const [sources] = useSources();
  const [selected, setSelected] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(true);
  const [showSimilar, setShowSimilar] = useState(false);
  const [opts, setOpts] = useState(false);
  const [creating, setCreating] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const { nodes, links } = useMemo(() => {
    const nodes: GNode[] = [];
    const links: GLink[] = [];
    const deg = new Map<string, number>();
    const inc = (id: string) => deg.set(id, (deg.get(id) || 0) + 1);
    const linkedSources = new Set<string>();
    for (const n of notes) {
      for (const t of wikiTargets(n.body)) {
        const target = findNote(notes, t);
        if (target && target.id !== n.id) { links.push({ source: n.id, target: target.id, kind: 'link' }); inc(n.id); inc(target.id); }
      }
      if (showSources) for (const s of n.sourceIds) { links.push({ source: n.id, target: 's:' + s, kind: 'source' }); linkedSources.add(s); inc(n.id); inc('s:' + s); }
    }
    for (const n of notes) nodes.push({ id: n.id, label: n.title, kind: 'note', weight: deg.get(n.id) || 0 });
    const smap = new Map(sources.map((s) => [s.id, s]));
    if (showSources) for (const id of linkedSources) { const s = smap.get(id); if (s) nodes.push({ id: 's:' + id, label: `${shortAuthors(s)} ${s.year || ''}`, kind: 'source', weight: deg.get('s:' + id) || 0 }); }
    if (showSimilar && showSources) {
      const arr = [...linkedSources].map((id) => smap.get(id)).filter(Boolean) as Source[];
      const kw = arr.map((s) => new Set(s.keywords.map((k) => k.toLowerCase())));
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        const inter = [...kw[i]].filter((k) => kw[j].has(k)).length;
        const uni = kw[i].size + kw[j].size - inter;
        if (uni && inter / uni >= 0.18) links.push({ source: 's:' + arr[i].id, target: 's:' + arr[j].id, kind: 'similar' });
      }
    }
    // rimuove link verso nodi mancanti
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, links: links.filter((l) => ids.has(l.source as string) && ids.has(l.target as string)) };
  }, [notes, sources, showSources, showSimilar]);

  const sel = selected ? (selected.startsWith('s:') ? { source: sources.find((s) => 's:' + s.id === selected) } : { note: notes.find((n) => n.id === selected) }) : null;

  return (
    <div className="screen">
      <AppBar title="Concetti" actions={<>
        <button className="iconbtn" aria-label="Suggerisci concetti" onClick={() => setSuggestOpen(true)}><Icon name="sparkle" /></button>
        <button className="iconbtn" aria-label="Opzioni mappa" onClick={() => setOpts(true)}><Icon name="filter" /></button>
        <button className="iconbtn" aria-label="Nuovo concetto" onClick={() => setCreating(true)}><Icon name="plus" /></button>
      </>} />
      <div className="wrap">
        <Seg value={tab} onChange={(v) => nav(v === 'list' ? 'map/list' : 'map', true)} options={[{ value: 'graph', label: 'Mappa' }, { value: 'list', label: 'Elenco' }]} />
        <div style={{ height: 12 }} />
        {ready && notes.length === 0 ? (
          <Empty title="Nessun concetto ancora" action={<div className="row" style={{ justifyContent: 'center' }}><button className="btn primary" onClick={() => setCreating(true)}>Crea un concetto</button><button className="btn" onClick={() => setSuggestOpen(true)}>Suggeriscimeli</button></div>}>
            Un concetto è una nota breve (es. «sicurezza nazionale», «Consiglio di sicurezza nazionale»). Collegalo ad altri con [[doppie parentesi]] e alle fonti: la mappa mostra come si intrecciano. Nel testo della tesi i concetti vengono sottolineati in automatico.
          </Empty>
        ) : tab === 'graph' ? (
          <div className="graph">
            <GraphCanvas nodes={nodes} links={links} selected={selected} onSelect={setSelected} />
            {sel && (
              <div className="overlay">
                <div className="card row" style={{ width: '100%', padding: 10, boxShadow: 'var(--shadow)' }}>
                  <span className="grow ellipsis" style={{ fontWeight: 600 }}>{sel.note?.title || sel.source?.title}</span>
                  <button className="btn small primary" onClick={() => nav(sel.note ? 'map/note/' + sel.note.id : 'source/' + sel.source!.id)}>Apri</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <NoteList notes={notes} />
        )}
      </div>
      <Sheet open={opts} onClose={() => setOpts(false)} title="Mappa">
        <Switch label="Mostra le fonti" checked={showSources} onChange={setShowSources} />
        <Switch label="Collega fonti simili" hint="Linee tratteggiate tra fonti con parole chiave in comune" checked={showSimilar} onChange={setShowSimilar} />
        <p className="tiny muted">Trascina per spostarti, pizzica per lo zoom, tocca un nodo per evidenziarne i collegamenti.</p>
      </Sheet>
      <NewNoteSheet open={creating} onClose={() => setCreating(false)} notes={notes} />
      <SuggestSheet open={suggestOpen} onClose={() => setSuggestOpen(false)} notes={notes} sources={sources} />
    </div>
  );
}

function NoteList({ notes }: { notes: Note[] }) {
  const [q, setQ] = useState('');
  const backlinks = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) for (const t of wikiTargets(n.body)) { const x = findNote(notes, t); if (x) m.set(x.id, (m.get(x.id) || 0) + 1); }
    return m;
  }, [notes]);
  const list = notes.filter((n) => !q || (n.title + ' ' + n.aliases.join(' ') + ' ' + n.tags.join(' ') + ' ' + n.body).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="searchbar" style={{ marginBottom: 10 }}><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca nei concetti" /></div>
      <div className="list">
        {list.map((n) => (
          <button key={n.id} className="item" onClick={() => nav('map/note/' + n.id)}>
            <span className="grow">
              <span className="title">{n.title}</span>
              <br /><span className="meta">{n.sourceIds.length} fonti · {backlinks.get(n.id) || 0} rimandi{n.tags.length ? ' · ' + n.tags.map((t) => '#' + t).join(' ') : ''}</span>
            </span>
            <Icon name="chevron" />
          </button>
        ))}
      </div>
    </>
  );
}

function NewNoteSheet({ open, onClose, notes, initial = '' }: { open: boolean; onClose: () => void; notes: Note[]; initial?: string }) {
  const [t, setT] = useState(initial);
  useEffect(() => setT(initial), [initial, open]);
  const go = async () => {
    const ex = findNote(notes, t);
    if (ex) { onClose(); nav('map/note/' + ex.id); return; }
    const n = await createNote(t);
    onClose();
    nav('map/note/' + n.id);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Nuovo concetto">
      <Field label="Nome"><input className="input" autoFocus value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && t.trim() && void go()} placeholder="es. Intelligence collection" /></Field>
      <button className="btn primary block" disabled={!t.trim()} onClick={go}>Crea</button>
    </Sheet>
  );
}

/** Propone concetti dalle parole chiave ricorrenti in più fonti (nessuna AI). */
function SuggestSheet({ open, onClose, notes, sources }: { open: boolean; onClose: () => void; notes: Note[]; sources: Source[] }) {
  const items = useMemo(() => {
    if (!open) return [];
    const m = new Map<string, { label: string; ids: Set<string> }>();
    for (const s of sources) for (const k of s.keywords) {
      const key = normTitle(k);
      if (key.length < 3) continue;
      if (!m.has(key)) m.set(key, { label: k, ids: new Set() });
      m.get(key)!.ids.add(s.id);
    }
    return [...m.values()].filter((x) => x.ids.size >= 2 && !findNote(notes, x.label)).sort((a, b) => b.ids.size - a.ids.size).slice(0, 30);
  }, [open, sources, notes]);
  return (
    <Sheet open={open} onClose={onClose} title="Concetti ricorrenti nelle fonti">
      {items.length === 0 ? <p className="muted">Servono almeno due fonti con parole chiave in comune. Aggiungi fonti dalle banche dati o allega PDF.</p> : (
        <>
          <p className="small muted" style={{ marginTop: -6 }}>Parole chiave presenti in più fonti. Tocca per creare il concetto già collegato a quelle fonti.</p>
          <div className="list">
            {items.map((x) => (
              <button key={x.label} className="item" onClick={async () => { await createNote(x.label.charAt(0).toUpperCase() + x.label.slice(1), { sourceIds: [...x.ids] }); toast(`"${x.label}" creato con ${x.ids.size} fonti`); }}>
                <span className="grow title">{x.label}</span><span className="chip static">{x.ids.size} fonti</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ============================ Nota ============================ */

export function NoteView({ id }: { id: string }) {
  const [notes] = useNotes();
  const [sources] = useSources();
  const [chapters] = useChapters();
  const note = notes.find((n) => n.id === id);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  const [suggest, setSuggest] = useState<{ q: string; at: number } | null>(null);
  const [pickSource, setPickSource] = useState(false);
  const [mentionsFT, setMentionsFT] = useState<{ s: Source; snippet: string }[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (note && !editing) setBody(note.body); }, [note, editing]);
  const terms = useMemo(() => (note ? [note.title, ...note.aliases].filter((t) => t.length > 2) : []), [note]);

  // fonti che parlano del concetto (abstract + testo completo)
  useEffect(() => {
    if (!terms.length) return;
    let alive = true;
    (async () => {
      const ft = await all('fulltext');
      const smap = new Map(sources.map((s) => [s.id, s]));
      const out: { s: Source; snippet: string }[] = [];
      const re = new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
      for (const s of sources) {
        if (note?.sourceIds.includes(s.id)) continue;
        const f = ft.find((x) => x.sourceId === s.id);
        const text = (s.abstract || '') + '\n' + (f?.text || '');
        const m = text.match(re);
        if (m && m.index !== undefined) out.push({ s, snippet: '…' + text.slice(Math.max(0, m.index - 80), m.index + 120).replace(/\s+/g, ' ') + '…' });
      }
      if (alive) setMentionsFT(out.slice(0, 20));
      void smap;
    })();
    return () => { alive = false; };
  }, [terms, sources, note?.sourceIds]);

  // menzioni nella tesi
  const mentions = useMemo(() => {
    if (!terms.length) return [];
    const re = new RegExp(`(?<![\\p{L}])(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}])`, 'iu');
    const out: { chapterId: string; title: string; snippet: string }[] = [];
    for (const c of chapters) for (const b of blocks(c.content)) {
      const m = b.text.match(re);
      if (m && m.index !== undefined) out.push({ chapterId: c.id, title: c.title, snippet: '…' + b.text.slice(Math.max(0, m.index - 70), m.index + 110) + '…' });
    }
    return out.slice(0, 30);
  }, [terms, chapters]);

  if (!note) return <div className="screen no-nav"><AppBar title="Concetto" onBack={() => back('map')} /><p className="wrap muted">Concetto non trovato.</p></div>;

  const save = (patch: Partial<Note>) => put('notes', { ...note, ...patch, updatedAt: Date.now() });
  const backlinks = notes.filter((n) => n.id !== note.id && wikiTargets(n.body).some((t) => findNote([note], t)));
  const linked = note.sourceIds.map((sid) => sources.find((s) => s.id === sid)).filter(Boolean) as Source[];

  const onBodyChange = (v: string) => {
    setBody(v);
    const pos = taRef.current?.selectionStart ?? v.length;
    const before = v.slice(0, pos);
    const m = before.match(/\[\[([^\]\n]*)$/);
    setSuggest(m ? { q: m[1], at: pos - m[1].length } : null);
  };
  const completeLink = (title: string) => {
    if (!suggest) return;
    const pos = taRef.current?.selectionStart ?? body.length;
    const next = body.slice(0, suggest.at) + title + ']]' + body.slice(pos);
    setBody(next);
    setSuggest(null);
    setTimeout(() => { const p = suggest.at + title.length + 2; taRef.current?.setSelectionRange(p, p); taRef.current?.focus(); }, 0);
  };
  const suggestions = suggest ? notes.filter((n) => n.id !== note.id && n.title.toLowerCase().includes(suggest.q.toLowerCase())).slice(0, 6) : [];

  const renderBody = () => {
    const parts: (string | React.JSX.Element)[] = [];
    let last = 0;
    for (const m of note.body.matchAll(WL)) {
      parts.push(note.body.slice(last, m.index));
      const t = findNote(notes, m[1]);
      parts.push(
        <span key={m.index} className={'wl' + (t ? '' : ' missing')} onClick={async () => { if (t) nav('map/note/' + t.id); else { const n = await createNote(m[1]); nav('map/note/' + n.id); } }}>
          {m[2] || m[1]}
        </span>
      );
      last = (m.index || 0) + m[0].length;
    }
    parts.push(note.body.slice(last));
    return parts;
  };

  return (
    <div className="screen no-nav">
      <AppBar title={note.title} onBack={() => back('map')} actions={
        <button className={'iconbtn' + (editing ? ' on' : '')} aria-label={editing ? 'Fine modifica' : 'Modifica'} onClick={() => { if (editing) void save({ body }); setEditing((v) => !v); }}><Icon name={editing ? 'check' : 'pen'} /></button>
      } />
      <div className="wrap">
        {editing ? (
          <>
            <Field label="Nome"><input className="input" defaultValue={note.title} onBlur={(e) => e.target.value.trim() && void save({ title: e.target.value.trim() })} /></Field>
            <Field label="Altri nomi" hint="Separati da virgola: sinonimi, sigle, traduzioni (es. NSC, 国家安全保障会議). Vengono riconosciuti anche nel testo della tesi.">
              <input className="input" defaultValue={note.aliases.join(', ')} onBlur={(e) => void save({ aliases: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
            </Field>
            <Field label="Tag" hint="Separati da virgola"><input className="input" defaultValue={note.tags.join(', ')} onBlur={(e) => void save({ tags: e.target.value.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean) })} /></Field>
            <Field label="Nota" hint="Scrivi [[ per collegare un altro concetto.">
              <textarea ref={taRef} className="textarea serif" rows={10} value={body} onChange={(e) => onBodyChange(e.target.value)} onBlur={() => setTimeout(() => void save({ body: taRef.current?.value ?? body }), 150)} />
            </Field>
            {suggest && (
              <div className="suggest">
                {suggestions.map((n) => <button key={n.id} className="item" onMouseDown={(e) => e.preventDefault()} onClick={() => completeLink(n.title)}>{n.title}</button>)}
                {suggest.q.trim() && !findNote(notes, suggest.q) && <button className="item" onMouseDown={(e) => e.preventDefault()} onClick={() => completeLink(suggest.q.trim())}>Nuovo: «{suggest.q.trim()}»</button>}
              </div>
            )}
          </>
        ) : (
          <>
            {note.aliases.length > 0 && <div className="small muted" style={{ marginBottom: 8 }}>Anche: {note.aliases.join(', ')}</div>}
            {note.tags.length > 0 && <div className="chips" style={{ marginBottom: 10 }}>{note.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</div>}
            <div className="note-body" onClick={() => !note.body && setEditing(true)}>{note.body ? renderBody() : <span className="muted">Tocca per scrivere la definizione, i dibattiti, gli autori chiave… Usa [[ ]] per collegare altri concetti.</span>}</div>
          </>
        )}

        <div className="section-title"><span className="grow">Fonti collegate ({linked.length})</span><button className="btn small" onClick={() => setPickSource(true)}><Icon name="plus" size={18} /> Collega</button></div>
        {linked.length > 0 && (
          <div className="list">
            {linked.map((s) => (
              <div key={s.id} className="item" role="button" tabIndex={0} onClick={() => nav('source/' + s.id)}>
                <span className="grow"><span className="title serif">{s.title}</span><br /><span className="meta">{shortAuthors(s)} · {s.year || 's.d.'}</span></span>
                <button className="iconbtn" aria-label="Scollega" onClick={(e) => { e.stopPropagation(); void save({ sourceIds: note.sourceIds.filter((x) => x !== s.id) }); }}><Icon name="x" size={18} /></button>
              </div>
            ))}
          </div>
        )}

        {mentionsFT.length > 0 && (
          <>
            <div className="section-title">Ne parlano anche</div>
            <div className="list">
              {mentionsFT.map(({ s, snippet }) => (
                <div key={s.id} className="item">
                  <span className="grow" onClick={() => nav('source/' + s.id)}><span className="title serif">{shortAuthors(s)} {s.year || ''}</span><br /><span className="meta">{snippet}</span></span>
                  <button className="btn small" onClick={() => void save({ sourceIds: [...note.sourceIds, s.id] })}>Collega</button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="section-title">Rimandi da altri concetti ({backlinks.length})</div>
        {backlinks.length ? <div className="chips">{backlinks.map((n) => <button key={n.id} className="chip" onClick={() => nav('map/note/' + n.id)}>{n.title}</button>)}</div> : <p className="small muted" style={{ margin: 0 }}>Nessun altro concetto rimanda qui.</p>}

        <div className="section-title">Nella tesi ({mentions.length})</div>
        {mentions.length ? (
          <div className="list">
            {mentions.map((m, i) => <button key={i} className="item" onClick={() => nav('write/' + m.chapterId)}><span className="grow"><span className="title">{m.title}</span><br /><span className="meta serif">{m.snippet}</span></span></button>)}
          </div>
        ) : <p className="small muted" style={{ margin: 0 }}>Il concetto non compare ancora nel testo.</p>}

        <button className="btn danger block" style={{ marginTop: 24 }} onClick={async () => { await del('notes', note.id); back('map'); toast('Concetto eliminato', { label: 'Annulla', run: () => void put('notes', note) }); }}><Icon name="trash" /> Elimina concetto</button>
      </div>
      <SourcePicker open={pickSource} onClose={() => setPickSource(false)} sources={sources.filter((s) => !note.sourceIds.includes(s.id))} onPick={(s) => { void save({ sourceIds: [...note.sourceIds, s.id] }); setPickSource(false); }} />
    </div>
  );
}

function SourcePicker({ open, onClose, sources, onPick }: { open: boolean; onClose: () => void; sources: Source[]; onPick: (s: Source) => void }) {
  const [q, setQ] = useState('');
  const list = sources.filter((s) => !q || (s.title + s.authors.join(' ')).toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  return (
    <Sheet open={open} onClose={onClose} title="Collega una fonte">
      <div className="searchbar" style={{ marginBottom: 10 }}><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca in biblioteca" /></div>
      <div className="list">{list.map((s) => <button key={s.id} className="item" onClick={() => onPick(s)}><span className="grow"><span className="title serif">{s.title}</span><br /><span className="meta">{shortAuthors(s)} · {s.year || 's.d.'}</span></span></button>)}</div>
    </Sheet>
  );
}
