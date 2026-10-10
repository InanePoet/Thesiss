import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { blocks, count, measured, pages, roleReport, styleCheck, suggestRole } from '../lib/analysis';
import { markDbSaved } from '../lib/backup';
import { chicagoNote, inlineCite, plain, shortAuthors } from '../lib/cite';
import { all, get, put } from '../lib/db';
import { KIND_LABEL } from '../lib/defaults';
import { makeCiteResolver, makeNoteResolver } from '../lib/resolve';
import { back, nav } from '../lib/router';
import { recordProgress, useNotes, useRequirements, useSettings, useSources } from '../lib/store';
import type { Chapter, RoleKey, Source } from '../lib/types';
import { debounce, n } from '../lib/util';
import { Icon } from '../ui/Icon';
import { AppBar, Field, NumInput, Sheet, toast } from '../ui/kit';
import { buildExtensions, conceptKey, setConceptTerms } from './extensions';
import { RoleBar, RoleLegend } from './RoleBar';

type Panel = null | 'stats' | 'role' | 'props' | 'notes' | 'menu' | { footnote: number } | { cite: true } | { concept: string };

export function EditorScreen({ id }: { id: string }) {
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    get('chapters', id).then((c) => (c ? setChapter(c) : setMissing(true)));
  }, [id]);
  if (missing) return <div className="empty"><h3>Capitolo non trovato</h3><button className="btn" onClick={() => nav('write', true)}>Torna ai capitoli</button></div>;
  if (!chapter) return null;
  return <EditorInner key={chapter.id} initial={chapter} />;
}

function EditorInner({ initial }: { initial: Chapter }) {
  const [settings] = useSettings();
  const [req] = useRequirements();
  const [sources] = useSources();
  const [notes] = useNotes();
  const [meta, setMeta] = useState<Chapter>(initial);
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const [panel, setPanel] = useState<Panel>(null);
  const [tick, setTick] = useState(0);
  const othersTotal = useRef(0);

  const smap = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);

  useEffect(() => {
    all('chapters').then((chs) => {
      othersTotal.current = chs.filter((c) => c.id !== initial.id).reduce((a, c) => a + count(blocks(c.content)).chars, 0);
    });
  }, [initial.id]);

  const save = useMemo(
    () =>
      debounce(async (ed: Editor) => {
        const content = ed.getJSON();
        const next = { ...metaRef.current, content, updatedAt: Date.now() };
        metaRef.current = next;
        await put('chapters', next);
        markDbSaved();
        void recordProgress(othersTotal.current + count(blocks(content)).chars);
      }, 700),
    []
  );

  const editor = useEditor({
    extensions: buildExtensions(initial.kind === 'abstract' ? 'Sintesi: domanda, metodo, risultati principali…' : 'Inizia a scrivere…'),
    content: initial.content,
    onUpdate: ({ editor }) => { save(editor); setTick((t) => t + 1); },
    editorProps: {
      attributes: { spellcheck: 'true', lang: 'it' },
      handleClickOn: (_view, _pos, node, nodePos) => {
        if (node.type.name === 'footnote') { setPanel({ footnote: nodePos }); return true; }
        return false;
      },
      handleClick: (_view, _pos, ev) => {
        const el = (ev.target as HTMLElement).closest?.('.concept-link') as HTMLElement | null;
        if (el?.dataset.concept) { setPanel({ concept: el.dataset.concept }); return false; }
        return false;
      },
    },
  });

  // salva subito uscendo
  useEffect(() => () => { if (editor && save.pending()) save.flush(editor); }, [editor, save]);

  // collegamenti automatici ai concetti
  useEffect(() => {
    setConceptTerms(notes.flatMap((nt) => [nt.title, ...nt.aliases].filter(Boolean).map((t) => ({ id: nt.id, term: t }))));
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(conceptKey, true));
  }, [notes, editor]);

  // tastiera: tiene la barra strumenti sopra la tastiera
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const h = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb-bottom', kb > 40 ? `${kb}px` : '');
    };
    vv.addEventListener('resize', h);
    vv.addEventListener('scroll', h);
    return () => { vv.removeEventListener('resize', h); vv.removeEventListener('scroll', h); document.documentElement.style.removeProperty('--kb-bottom'); };
  }, []);

  const doc = editor?.getJSON() || initial.content;
  const nr = useMemo(() => makeNoteResolver(smap, req), [smap, req, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const bs = useMemo(() => blocks(doc, makeNoteResolver(smap, req), makeCiteResolver(smap, req)), [tick, smap, req]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = useMemo(() => count(bs), [bs]);
  const m = measured(c, req);
  const pg = pages(c, req);

  const updateMeta = (patch: Partial<Chapter>) => {
    const next = { ...metaRef.current, ...patch, content: editor?.getJSON() || metaRef.current.content, updatedAt: Date.now() };
    setMeta(next);
    metaRef.current = next;
    void put('chapters', next).then(markDbSaved);
  };

  const suggest = () => {
    if (!editor) return;
    const { state } = editor;
    const tr = state.tr;
    const paras: { pos: number; text: string; notes: boolean }[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph') {
        let hasNote = false;
        node.descendants((x) => { if (x.type.name === 'footnote' || x.type.name === 'cite') hasNote = true; });
        if (!node.attrs.role || node.attrs.suggested) paras.push({ pos, text: node.textContent, notes: hasNote });
        return false;
      }
      return true;
    });
    let total = 0;
    state.doc.descendants((node) => { if (node.type.name === 'paragraph') { total++; return false; } return true; });
    let i = 0, changed = 0;
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'paragraph') return true;
      const p = paras.find((x) => x.pos === pos);
      if (p) {
        const r = suggestRole(p.text, i, total, p.notes);
        if (r) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, role: r, suggested: true }); changed++; }
      }
      i++;
      return false;
    });
    if (changed) { editor.view.dispatch(tr); toast(`Ruoli suggeriti per ${changed} paragrafi`); }
    else toast('Tutti i paragrafi hanno già un ruolo.');
  };

  const clearSuggestions = () => {
    if (!editor) return;
    const tr = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.attrs.suggested) tr.setNodeMarkup(pos, undefined, { ...node.attrs, role: null, suggested: false });
      return node.type.name !== 'paragraph';
    });
    editor.view.dispatch(tr);
  };

  const roleCss = settings.roles.map((r) => `.tiptap [data-role='${r.key}']{--role-c:${r.color}}`).join('');
  const [showRoles, setShowRoles] = useState(settings.showRoles);
  useEffect(() => setShowRoles(settings.showRoles), [settings.showRoles]);

  if (!editor) return null;
  const is = (name: string, attrs?: object) => editor.isActive(name, attrs);
  const fnPanel = panel && typeof panel === 'object' && 'footnote' in panel ? panel.footnote : null;
  const conceptPanel = panel && typeof panel === 'object' && 'concept' in panel ? panel.concept : null;
  const curRole = editor.state.selection.$from.parent.attrs.role as RoleKey | null;

  return (
    <div className={'editor-screen' + (showRoles ? ' show-roles' : '')}>
      <style>{roleCss}</style>
      <AppBar
        line
        onBack={() => { save.flush(editor); if (window.matchMedia('(min-width: 840px)').matches) nav('write'); else back('write'); }}
        title={meta.title}
        sub={<button onClick={() => setPanel('stats')} style={{ all: 'unset', cursor: 'pointer' }} className="num">{n(m)} battute · {pg.toFixed(1).replace('.', ',')} pagine{meta.targetChars ? ` · obiettivo ${Math.round((m / meta.targetChars) * 100)}%` : ''}</button>}
        actions={
          <>
            <button className={'iconbtn' + (showRoles ? ' on' : '')} aria-label="Vista struttura" onClick={() => setShowRoles((v) => !v)}><Icon name="layers" /></button>
            <button className="iconbtn" aria-label="Altro" onClick={() => setPanel('menu')}><Icon name="more" /></button>
          </>
        }
      />
      {showRoles && (
        <div className="wrap" style={{ paddingTop: 8 }}>
          <RoleBar report={roleReport(bs, settings.roles)} roles={settings.roles} />
        </div>
      )}
      <div className="editor-scroll">
        <div className="editor-wrap">
          <EditorContent editor={editor} />
        </div>
      </div>

      <div className="toolbar" role="toolbar" aria-label="Formattazione">
        <button className="iconbtn" aria-label="Annulla" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Icon name="undo" /></button>
        <button className="iconbtn" aria-label="Ripeti" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Icon name="redo" /></button>
        <span className="divider" />
        <button className={'iconbtn' + (curRole ? ' on' : '')} aria-label="Ruolo del paragrafo" onClick={() => setPanel('role')} style={curRole ? { color: settings.roles.find((r) => r.key === curRole)?.color } : undefined}><Icon name="layers" /></button>
        <button className="iconbtn" aria-label="Nota a piè di pagina" onClick={() => { editor.chain().insertFootnote({ text: '' }).run(); setPanel({ footnote: editor.state.selection.from - 1 }); }}><Icon name="note" /></button>
        <button className="iconbtn" aria-label="Cita una fonte" onClick={() => setPanel({ cite: true })}><Icon name="cite" /></button>
        <span className="divider" />
        <button className={'iconbtn' + (is('bold') ? ' on' : '')} aria-label="Grassetto" onClick={() => editor.chain().focus().toggleBold().run()}><Icon name="bold" /></button>
        <button className={'iconbtn' + (is('italic') ? ' on' : '')} aria-label="Corsivo" onClick={() => editor.chain().focus().toggleItalic().run()}><Icon name="italic" /></button>
        <button className={'iconbtn' + (is('heading', { level: 2 }) ? ' on' : '')} aria-label="Titolo di sezione" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><b style={{ fontSize: 15 }}>H2</b></button>
        <button className={'iconbtn' + (is('heading', { level: 3 }) ? ' on' : '')} aria-label="Sottosezione" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><b style={{ fontSize: 15 }}>H3</b></button>
        <button className={'iconbtn' + (is('bulletList') ? ' on' : '')} aria-label="Elenco" onClick={() => editor.chain().focus().toggleBulletList().run()}><Icon name="list" /></button>
        <button className={'iconbtn' + (is('blockquote') ? ' on' : '')} aria-label="Citazione lunga" onClick={() => editor.chain().focus().toggleBlockquote().run()}><Icon name="quote" /></button>
      </div>

      {/* ---- ruolo ---- */}
      <Sheet open={panel === 'role'} onClose={() => setPanel(null)} title="Ruolo del paragrafo">
        <p className="small muted" style={{ marginTop: -6 }}>Si applica ai paragrafi selezionati. Serve a vedere se il capitolo pone il problema, lo sviluppa e risponde.</p>
        <div className="list">
          {settings.roles.map((r) => (
            <button key={r.key} className="item" onClick={() => { editor.chain().focus().setRole(r.key).run(); setPanel(null); if (!showRoles) setShowRoles(true); }}>
              <b style={{ width: 14, height: 14, borderRadius: 4, background: r.color, display: 'inline-block', flex: 'none' }} />
              <span className="grow"><span className="title">{r.label}</span><br /><span className="meta">{r.hint}</span></span>
              {curRole === r.key && <Icon name="check" />}
            </button>
          ))}
          <button className="item" onClick={() => { editor.chain().focus().setRole(null).run(); setPanel(null); }}>
            <b style={{ width: 14, height: 14, borderRadius: 4, border: '1px dashed var(--faint)', display: 'inline-block', flex: 'none' }} />
            <span className="grow title">Nessun ruolo</span>
          </button>
        </div>
      </Sheet>

      {/* ---- statistiche ---- */}
      <Sheet open={panel === 'stats'} onClose={() => setPanel(null)} title="Statistiche del capitolo">
        <ChapterStats bs={bs} roles={settings.roles} req={req} target={meta.targetChars} />
      </Sheet>

      {/* ---- menu ---- */}
      <Sheet open={panel === 'menu'} onClose={() => setPanel(null)}>
        <div className="list">
          <button className="item" onClick={() => setPanel('stats')}><Icon name="chart" /><span className="grow title">Statistiche e struttura</span></button>
          <button className="item" onClick={() => { setPanel(null); suggest(); setShowRoles(true); }}><Icon name="sparkle" /><span className="grow"><span className="title">Suggerisci struttura</span><br /><span className="meta">Assegna i ruoli ai paragrafi senza ruolo, con regole sul testo</span></span></button>
          <button className="item" onClick={() => { setPanel(null); clearSuggestions(); }}><Icon name="x" /><span className="grow title">Togli i ruoli suggeriti</span></button>
          <button className="item" onClick={() => setPanel('notes')}><Icon name="note" /><span className="grow title">Note del capitolo</span></button>
          <button className="item" onClick={() => setPanel('props')}><Icon name="settings" /><span className="grow title">Titolo, tipo e obiettivo</span></button>
        </div>
      </Sheet>

      {/* ---- proprietà ---- */}
      <Sheet open={panel === 'props'} onClose={() => setPanel(null)} title="Capitolo">
        <Field label="Titolo"><input className="input" value={meta.title} onChange={(e) => updateMeta({ title: e.target.value })} /></Field>
        <Field label="Tipo">
          <select className="select" value={meta.kind} onChange={(e) => updateMeta({ kind: e.target.value as Chapter['kind'] })}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Cosa deve dimostrare" hint="Una frase che tieni sotto gli occhi mentre scrivi.">
          <textarea className="textarea" value={meta.purpose} onChange={(e) => updateMeta({ purpose: e.target.value })} />
        </Field>
        <Field label="Obiettivo di battute" hint="0 = nessun obiettivo"><NumInput value={meta.targetChars} step={1000} onChange={(v) => updateMeta({ targetChars: v })} /></Field>
      </Sheet>

      {/* ---- elenco note ---- */}
      <Sheet open={panel === 'notes'} onClose={() => setPanel(null)} title={`Note (${c.notes})`}>
        <FootnoteList editor={editor} resolve={nr} onOpen={(pos) => setPanel({ footnote: pos })} />
      </Sheet>

      {/* ---- modifica nota ---- */}
      {fnPanel !== null && (
        <FootnoteSheet editor={editor} pos={fnPanel} sources={sources} onClose={() => setPanel(null)} />
      )}

      {/* ---- citazione ---- */}
      {panel && typeof panel === 'object' && 'cite' in panel && (
        <CiteSheet
          sources={sources}
          style={req.citationStyle}
          onClose={() => setPanel(null)}
          onPick={(s, locator, mode) => {
            if (mode === 'note') editor.chain().insertFootnote({ sourceId: s.id, locator, text: '' }).run();
            else editor.chain().insertCite({ sourceId: s.id, locator, label: inlineCite(s, locator, req.citationStyle) }).run();
            if (s.status !== 'cited') void put('sources', { ...s, status: 'cited', updatedAt: Date.now() });
            setPanel(null);
          }}
        />
      )}

      {/* ---- concetto ---- */}
      {conceptPanel && (
        <Sheet open onClose={() => setPanel(null)} title={notes.find((x) => x.id === conceptPanel)?.title}>
          {(() => {
            const nt = notes.find((x) => x.id === conceptPanel);
            if (!nt) return null;
            const srcs = nt.sourceIds.map((sid) => smap.get(sid)).filter(Boolean) as Source[];
            return (
              <>
                <p className="serif" style={{ whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>{nt.body.slice(0, 600) || <span className="muted">Nota vuota.</span>}{nt.body.length > 600 ? '…' : ''}</p>
                {srcs.length > 0 && <div className="small muted" style={{ marginBottom: 12 }}>Fonti: {srcs.map((s) => `${shortAuthors(s)} ${s.year || ''}`).join('; ')}</div>}
                <div className="row">
                  <button className="btn primary grow" onClick={() => { save.flush(editor); nav('map/note/' + nt.id); }}>Apri il concetto</button>
                  {srcs[0] && <button className="btn" onClick={() => { editor.chain().focus().insertFootnote({ sourceId: srcs[0].id, text: '' }).run(); setPanel(null); }}>Cita {shortAuthors(srcs[0])}</button>}
                </div>
              </>
            );
          })()}
        </Sheet>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function ChapterStats({ bs, roles, req, target }: { bs: ReturnType<typeof blocks>; roles: import('../lib/types').RoleDef[]; req: import('../lib/types').Requirements; target?: number }) {
  const c = count(bs);
  const rr = roleReport(bs, roles);
  const st = styleCheck(bs, req);
  const m = measured(c, req);
  return (
    <>
      <div className="stat-grid">
        <div><div className="v">{n(c.chars)}</div><div className="k">battute con spazi</div></div>
        <div><div className="v">{n(c.charsNoSpaces)}</div><div className="k">battute senza spazi</div></div>
        <div><div className="v">{n(c.notesChars)}</div><div className="k">battute nelle note ({c.notes})</div></div>
        <div><div className="v">{n(c.chars + c.notesChars)}</div><div className="k">testo + note</div></div>
        <div><div className="v">{n(c.words)}</div><div className="k">parole</div></div>
        <div><div className="v">{pages(c, req).toFixed(1).replace('.', ',')}</div><div className="k">pagine ({n(req.charsPerPage)} battute)</div></div>
      </div>
      <p className="tiny muted" style={{ margin: '8px 2px 0' }}>
        Conteggio per i requisiti: {n(m)} battute ({req.countSpaces ? 'spazi inclusi' : 'spazi esclusi'}, {req.countFootnotes ? 'note incluse' : 'note escluse'}).
        {target ? ` Obiettivo: ${n(target)} (${Math.round((m / target) * 100)}%).` : ''}
      </p>
      <div className="section-title">Struttura argomentativa</div>
      <RoleBar report={rr} roles={roles} />
      <div style={{ marginTop: 8 }}><RoleLegend report={rr} roles={roles} /></div>
      <div className="stack" style={{ marginTop: 12 }}>
        {rr.issues.map((i, k) => <div key={k} className={'notice ' + (i.level === 'ok' ? 'ok' : i.level === 'warn' ? 'warn' : 'info')}>{i.text}</div>)}
      </div>
      <div className="section-title">Stile</div>
      {st.length === 0 ? <div className="notice ok">Nessun problema rilevato.</div> : (
        <div className="stack">
          {st.map((i, k) => <div key={k} className={'notice ' + (i.level === 'warn' ? 'warn' : 'info')}><span>{i.text}{i.sample && <><br /><span className="tiny muted serif">«{i.sample}»</span></>}</span></div>)}
        </div>
      )}
      <div className="row tiny muted" style={{ marginTop: 12 }}>{c.paragraphs} paragrafi · {c.sentences} frasi · {c.headings} titoli</div>
    </>
  );
}

function FootnoteList({ editor, resolve, onOpen }: { editor: Editor; resolve: (a: Record<string, any>) => string; onOpen: (pos: number) => void }) {
  const items: { pos: number; text: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'footnote') items.push({ pos, text: plain(resolve(node.attrs)) });
  });
  if (!items.length) return <p className="muted">Nessuna nota. Usa il pulsante nota nella barra in basso.</p>;
  return (
    <div className="list">
      {items.map((it, i) => (
        <button key={it.pos} className="item" onClick={() => onOpen(it.pos)}>
          <b className="num" style={{ color: 'var(--accent)', width: 24 }}>{i + 1}</b>
          <span className="grow small serif">{it.text || <span className="muted">(vuota)</span>}</span>
        </button>
      ))}
    </div>
  );
}

function FootnoteSheet({ editor, pos, sources, onClose }: { editor: Editor; pos: number; sources: Source[]; onClose: () => void }) {
  const node = editor.state.doc.nodeAt(pos);
  const [text, setText] = useState<string>(node?.attrs.text || '');
  const [sourceId, setSourceId] = useState<string | null>(node?.attrs.sourceId || null);
  const [locator, setLocator] = useState<string>(node?.attrs.locator || '');
  const [picking, setPicking] = useState(false);
  const [req] = useRequirements();
  const valid = node && node.type.name === 'footnote';
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (sourceId) return;
    // TipTap rimette il focus all'editor nel frame successivo: lo riprendiamo dopo
    const t = setTimeout(() => { (document.activeElement as HTMLElement | null)?.blur?.(); taRef.current?.focus(); }, 120);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = useCallback(() => {
    if (!valid) return;
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node!.attrs, text, sourceId, locator });
    editor.view.dispatch(tr);
  }, [editor, pos, text, sourceId, locator, valid, node]);
  const close = () => {
    if (valid && !text.trim() && !sourceId) editor.view.dispatch(editor.state.tr.delete(pos, pos + 1));
    else commit();
    onClose();
  };
  if (!valid) return null;
  const src = sourceId ? sources.find((s) => s.id === sourceId) : undefined;
  if (picking)
    return <CiteSheet sources={sources} style={req.citationStyle} onClose={() => setPicking(false)} forceNote onPick={(s, l) => { setSourceId(s.id); setLocator(l); setPicking(false); }} />;
  return (
    <Sheet open onClose={close} title="Nota a piè di pagina">
      {src ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="small serif">{plain(chicagoNote(src, locator))}</div>
          <div className="row" style={{ marginTop: 10 }}>
            <input className="input" placeholder="Pagine (es. 45 o 45-47)" value={locator} onChange={(e) => setLocator(e.target.value)} />
            <button className="btn small" onClick={() => setSourceId(null)}>Togli fonte</button>
          </div>
        </div>
      ) : (
        <button className="btn block" style={{ marginBottom: 12 }} onClick={() => setPicking(true)}><Icon name="cite" /> Collega una fonte</button>
      )}
      <Field label={src ? 'Commento (dopo la citazione)' : 'Testo della nota'}>
        <textarea ref={taRef} className="textarea serif" value={text} onChange={(e) => setText(e.target.value)} placeholder="Per un approfondimento si veda…" />
      </Field>
      <div className="row">
        <button className="btn danger" onClick={() => { editor.view.dispatch(editor.state.tr.delete(pos, pos + 1)); onClose(); }}><Icon name="trash" /> Elimina</button>
        <span className="grow" />
        <button className="btn primary" onClick={close}>Fatto</button>
      </div>
    </Sheet>
  );
}

export function CiteSheet({ sources, style, onClose, onPick, forceNote }: { sources: Source[]; style: string; onClose: () => void; onPick: (s: Source, locator: string, mode: 'note' | 'inline') => void; forceNote?: boolean }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Source | null>(null);
  const [loc, setLoc] = useState('');
  const [mode, setMode] = useState<'note' | 'inline'>(forceNote || style === 'chicago-note' ? 'note' : 'inline');
  const list = useMemo(() => {
    const t = q.toLowerCase().trim();
    return sources
      .filter((s) => s.status !== 'discarded')
      .filter((s) => !t || (s.title + ' ' + s.authors.join(' ') + ' ' + (s.year || '') + ' ' + (s.titleAlt || '')).toLowerCase().includes(t))
      .slice(0, 50);
  }, [q, sources]);
  return (
    <Sheet open onClose={onClose} title={sel ? 'Pagine citate' : 'Cita una fonte'}>
      {!sel ? (
        <>
          <div className="searchbar" style={{ marginBottom: 10 }}><Icon name="search" /><input autoFocus placeholder="Autore, titolo, anno" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {list.length === 0 ? <p className="muted">Nessuna fonte in biblioteca{q ? ' per questa ricerca' : ''}. Aggiungile dalla sezione Fonti.</p> : (
            <div className="list">
              {list.map((s) => (
                <button key={s.id} className="item" onClick={() => setSel(s)}>
                  <span className="grow"><span className="title serif">{s.title}</span><br /><span className="meta">{shortAuthors(s)} · {s.year || 's.d.'}</span></span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="serif small" style={{ marginTop: 0 }}>{plain(chicagoNote(sel, loc))}</p>
          <Field label="Pagine" hint="Facoltativo: 45, 45-47, cap. 2…"><input className="input" autoFocus value={loc} onChange={(e) => setLoc(e.target.value)} /></Field>
          {!forceNote && (
            <div className="seg" style={{ marginBottom: 14 }}>
              <button className={mode === 'note' ? 'on' : ''} onClick={() => setMode('note')}>In nota</button>
              <button className={mode === 'inline' ? 'on' : ''} onClick={() => setMode('inline')}>Nel testo (Autore anno)</button>
            </div>
          )}
          <div className="row"><button className="btn" onClick={() => setSel(null)}>Indietro</button><span className="grow" /><button className="btn primary" onClick={() => onPick(sel, loc, mode)}>Inserisci</button></div>
        </>
      )}
    </Sheet>
  );
}
