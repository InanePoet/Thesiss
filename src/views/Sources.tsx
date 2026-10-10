import { useEffect, useMemo, useState } from 'react';
import { del, put } from '../lib/db';
import { PROVIDERS } from '../lib/defaults';
import { openUrl } from '../lib/platform';
import { nav } from '../lib/router';
import { externalLinks, searchAll, type Hit, type SearchResult } from '../lib/search/providers';
import { newHits, runSaved } from '../lib/search/saved';
import { addSourceFromHit, useSearches, useSettings, useSources } from '../lib/store';
import type { SavedSearch, Source } from '../lib/types';
import { shortAuthors } from '../lib/cite';
import { timeAgo, uid } from '../lib/util';
import { Icon } from '../ui/Icon';
import { AppBar, Empty, Seg, Sheet, toast } from '../ui/kit';
import { AddSourceSheet } from './SourceDetail';

const STATUS_LABEL: Record<Source['status'], string> = { toread: 'Da leggere', reading: 'In lettura', read: 'Letta', cited: 'Citata', discarded: 'Scartata' };
export { STATUS_LABEL };

type Tab = 'search' | 'library' | 'saved';

export function Sources({ tab: tabProp }: { tab?: string }) {
  const tab = (['search', 'library', 'saved'].includes(tabProp || '') ? tabProp : 'library') as Tab;
  const [adding, setAdding] = useState(false);
  return (
    <div className="screen">
      <AppBar title="Fonti" actions={<button className="iconbtn" aria-label="Aggiungi fonte" onClick={() => setAdding(true)}><Icon name="plus" /></button>} />
      <div className="wrap">
        <Seg value={tab} onChange={(v) => nav('sources/' + v, true)} options={[{ value: 'library', label: 'Biblioteca' }, { value: 'search', label: 'Cerca' }, { value: 'saved', label: 'Monitorate' }]} />
        <div style={{ height: 12 }} />
        {tab === 'search' && <SearchTab />}
        {tab === 'library' && <LibraryTab onAdd={() => setAdding(true)} />}
        {tab === 'saved' && <SavedTab />}
      </div>
      <AddSourceSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

/* ------------------------------ ricerca ------------------------------ */

let lastSearch: { q: string; yearFrom: string; res: SearchResult | null; auto?: boolean } = { q: '', yearFrom: '', res: null };
export function presetSearch(q: string) { lastSearch = { q, yearFrom: '', res: null, auto: true }; }

function SearchTab() {
  const [settings, setSettings] = useSettings();
  const [sources] = useSources();
  const [q, setQ] = useState(lastSearch.q);
  const [yearFrom, setYearFrom] = useState(lastSearch.yearFrom);
  const [res, setRes] = useState<SearchResult | null>(lastSearch.res);
  const [loading, setLoading] = useState(false);
  const [links, setLinks] = useState<Hit | null>(null);
  const inLib = useMemo(() => new Set(sources.map((s) => (s.doi ? 'doi:' + s.doi.toLowerCase() : ''))), [sources]);
  useEffect(() => { if (lastSearch.auto) { lastSearch.auto = false; void run(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const titles = useMemo(() => new Set(sources.map((s) => s.title.toLowerCase())), [sources]);

  const run = async () => {
    if (!q.trim()) return;
    setLoading(true);
    const r = await searchAll({ query: q.trim(), yearFrom: parseInt(yearFrom, 10) || undefined, settings }, settings.providers);
    setRes(r);
    lastSearch = { q, yearFrom, res: r };
    setLoading(false);
  };
  const save = async () => {
    const s: SavedSearch = { id: uid(), query: q.trim(), providers: settings.providers, yearFrom: parseInt(yearFrom, 10) || undefined, seen: (res?.hits || []).map((h) => h.key), newCount: 0, lastRun: Date.now(), createdAt: Date.now() };
    await put('searches', s);
    toast('Ricerca monitorata: ti segnalo i risultati nuovi ogni giorno.');
  };
  const toggleProvider = (k: string) => setSettings((s) => ({ ...s, providers: s.providers.includes(k) ? s.providers.filter((x) => x !== k) : [...s.providers, k] }));

  return (
    <>
      <form className="searchbar" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <Icon name="search" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Argomento, autore, 情報機関…" enterKeyHint="search" />
        <button className="btn primary small" disabled={loading || !q.trim()}>{loading ? '…' : 'Cerca'}</button>
      </form>
      <div className="chips" style={{ margin: '10px 0' }}>
        {PROVIDERS.map((p) => (
          <button key={p.key} className={'chip' + (settings.providers.includes(p.key) ? ' on' : '')} onClick={() => toggleProvider(p.key)}>{p.label}</button>
        ))}
        <input className="chip" style={{ width: 110 }} inputMode="numeric" placeholder="Dal (anno)" value={yearFrom} onChange={(e) => setYearFrom(e.target.value.replace(/\D/g, '').slice(0, 4))} />
      </div>
      {!res && !loading && (
        <div className="card small muted">
          Cerco in parallelo nelle banche dati scelte e unisco i doppioni. Per ogni risultato trovi il link all'editore e, se l'hai impostato, il passaggio tramite il proxy della tua biblioteca: il PDF lo scarichi tu con le tue credenziali.
          Per i testi giapponesi J-STAGE e CiNii funzionano meglio con parole chiave in giapponese.
        </div>
      )}
      {res && (
        <>
          <div className="row small muted" style={{ margin: '6px 2px 8px' }}>
            <span className="grow">{res.hits.length} risultati · {Object.entries(res.perProvider).map(([k, v]) => `${PROVIDERS.find((p) => p.key === k)?.label} ${v}`).join(', ')}</span>
            <button className="btn small" onClick={save}><Icon name="bookmark" size={18} /> Monitora</button>
          </div>
          {Object.entries(res.errors).map(([k, v]) => <div key={k} className="notice warn small" style={{ marginBottom: 6 }}>{PROVIDERS.find((p) => p.key === k)?.label}: {v}</div>)}
          <div className="list">
            {res.hits.map((h) => (
              <HitCard key={h.key} h={h} saved={(h.doi && inLib.has('doi:' + h.doi.toLowerCase())) || titles.has(h.title.toLowerCase())} onLinks={() => setLinks(h)} />
            ))}
          </div>
        </>
      )}
      <LinksSheet hit={links} onClose={() => setLinks(null)} />
    </>
  );
}

export function HitCard({ h, saved, onLinks }: { h: Hit; saved: boolean; onLinks: () => void }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(saved);
  useEffect(() => setDone(saved), [saved]);
  return (
    <div className="hit">
      <div className="t">{h.title}</div>
      {h.titleAlt && <div className="small muted serif">{h.titleAlt}</div>}
      <div className="a">{h.authors.slice(0, 4).join(', ')}{h.authors.length > 4 ? ' et al.' : ''}{h.year ? ` · ${h.year}` : ''}{h.venue ? ` · ${h.venue}` : ''}</div>
      {h.abstract && <div className={'abs' + (open ? ' open' : '')} onClick={() => setOpen((v) => !v)}>{h.abstract}</div>}
      <div className="row wrap-row" style={{ marginTop: 10, gap: 6 }}>
        {h.sources.map((s) => <span key={s} className="tag">{PROVIDERS.find((p) => p.key === s)?.label || s}</span>)}
        {h.oaUrl && <span className="tag" style={{ color: 'var(--ok)' }}>accesso aperto</span>}
        {h.citedBy ? <span className="tag">{h.citedBy} citazioni</span> : null}
        <span className="grow" />
        <button className="btn small ghost" onClick={onLinks}><Icon name="external" size={18} /> Apri</button>
        <button className={'btn small' + (done ? '' : ' primary')} disabled={done} onClick={async () => { await addSourceFromHit(h); setDone(true); toast('Aggiunta alla biblioteca'); }}>
          {done ? <><Icon name="check" size={18} /> In biblioteca</> : <><Icon name="plus" size={18} /> Aggiungi</>}
        </button>
      </div>
    </div>
  );
}

export function LinksSheet({ hit, onClose }: { hit: Partial<Source> | null; onClose: () => void }) {
  const [settings] = useSettings();
  if (!hit) return null;
  const links = externalLinks(hit.title || '', settings, hit);
  return (
    <Sheet open onClose={onClose} title="Apri la fonte">
      <div className="list">
        {links.map((l) => (
          <button key={l.label} className="item" onClick={() => openUrl(l.url)}>
            <Icon name="external" />
            <span className="grow"><span className="title">{l.label}</span>{l.note && <><br /><span className="meta">{l.note}</span></>}</span>
          </button>
        ))}
      </div>
      {!settings.libraryProxy && <p className="tiny muted">Imposta il proxy della tua biblioteca in Altro › Impostazioni per aprire gli articoli a pagamento con il tuo login universitario.</p>}
    </Sheet>
  );
}

/* ------------------------------ biblioteca ------------------------------ */

function LibraryTab({ onAdd }: { onAdd: () => void }) {
  const [sources, ready] = useSources();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Source['status'] | 'all'>('all');
  const [sort, setSort] = useState<'added' | 'year' | 'author'>('added');
  const list = useMemo(() => {
    const t = q.toLowerCase().trim();
    let l = sources.filter((s) => (status === 'all' ? s.status !== 'discarded' : s.status === status));
    if (t) l = l.filter((s) => (s.title + ' ' + (s.titleAlt || '') + ' ' + s.authors.join(' ') + ' ' + s.tags.join(' ') + ' ' + s.keywords.join(' ') + ' ' + (s.year || '')).toLowerCase().includes(t));
    if (sort === 'year') l = [...l].sort((a, b) => (b.year || 0) - (a.year || 0));
    if (sort === 'author') l = [...l].sort((a, b) => shortAuthors(a).localeCompare(shortAuthors(b), 'it'));
    return l;
  }, [sources, q, status, sort]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    sources.forEach((s) => (c[s.status] = (c[s.status] || 0) + 1));
    return c;
  }, [sources]);

  if (ready && sources.length === 0)
    return (
      <Empty title="La biblioteca è vuota" action={<div className="row" style={{ justifyContent: 'center' }}><button className="btn primary" onClick={() => nav('sources/search', true)}>Cerca fonti</button><button className="btn" onClick={onAdd}>Aggiungi da link o PDF</button></div>}>
        Cerca articoli nelle banche dati o aggiungi un link, un DOI o un PDF che hai già.
      </Empty>
    );
  return (
    <>
      <div className="searchbar"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtra per titolo, autore, tag" /></div>
      <div className="chips" style={{ margin: '10px 0' }}>
        <button className={'chip' + (status === 'all' ? ' on' : '')} onClick={() => setStatus('all')}>Tutte {sources.length - (counts.discarded || 0)}</button>
        {(Object.keys(STATUS_LABEL) as Source['status'][]).map((k) => counts[k] ? <button key={k} className={'chip' + (status === k ? ' on' : '')} onClick={() => setStatus(k)}>{STATUS_LABEL[k]} {counts[k]}</button> : null)}
        <select className="chip" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordina">
          <option value="added">Recenti</option><option value="year">Anno</option><option value="author">Autore</option>
        </select>
      </div>
      <div className="list">
        {list.map((s) => (
          <button key={s.id} className="item" onClick={() => nav('source/' + s.id)}>
            <span className="grow">
              <span className="title serif" style={{ display: 'block', lineHeight: 1.35 }}>{s.title}</span>
              <span className="meta">{shortAuthors(s)} · {s.year || 's.d.'} · {STATUS_LABEL[s.status]}{s.hasFullText ? ' · PDF' : ''}{s.tags.length ? ' · ' + s.tags.join(', ') : ''}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

/* ------------------------------ monitorate ------------------------------ */

function SavedTab() {
  const [searches, ready] = useSearches();
  const [settings] = useSettings();
  const [sources] = useSources();
  const [openId, setOpenId] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<Hit | null>(null);
  const [newQ, setNewQ] = useState('');
  const inLib = useMemo(() => new Set(sources.map((s) => s.title.toLowerCase())), [sources]);

  useEffect(() => { if (openId) newHits(openId).then(setHits); }, [openId, searches]);
  const refresh = async (s: SavedSearch) => {
    setBusy(s.id);
    try { const r = await runSaved(s, settings); toast(r.fresh.length ? `${r.fresh.length} risultati nuovi` : 'Nessun risultato nuovo'); }
    catch { toast('Rete non disponibile'); }
    setBusy(null);
  };
  const add = async () => {
    if (!newQ.trim()) return;
    const s: SavedSearch = { id: uid(), query: newQ.trim(), providers: settings.providers, seen: [], newCount: 0, createdAt: Date.now() };
    await put('searches', s);
    setNewQ('');
    await refresh(s);
  };
  const open = searches.find((s) => s.id === openId);
  return (
    <>
      <p className="small muted" style={{ marginTop: 0 }}>Le ricerche monitorate si aggiornano da sole una volta al giorno quando apri l'app, e ti mostrano solo i risultati nuovi.</p>
      <form className="searchbar" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <Icon name="bookmark" />
        <input value={newQ} onChange={(e) => setNewQ(e.target.value)} placeholder="Nuova ricerca da monitorare" />
        <button className="btn small primary" disabled={!newQ.trim()}>Aggiungi</button>
      </form>
      <div style={{ height: 12 }} />
      {ready && searches.length === 0 ? <p className="muted">Nessuna ricerca monitorata.</p> : (
        <div className="list">
          {searches.map((s) => (
            <div key={s.id} className="item" role="button" tabIndex={0} onClick={() => setOpenId(s.id)}>
              <span className="grow"><span className="title">{s.query}</span><br /><span className="meta">aggiornata {timeAgo(s.lastRun)}{s.newCount ? ` · ${s.newCount} nuovi` : ''}</span></span>
              {s.newCount > 0 && <span className="chip static on">{s.newCount}</span>}
              <button className="iconbtn" aria-label="Aggiorna" disabled={busy === s.id} onClick={(e) => { e.stopPropagation(); void refresh(s); }}><Icon name="refresh" /></button>
            </div>
          ))}
        </div>
      )}
      <Sheet open={!!open} onClose={() => { if (open && open.newCount) void put('searches', { ...open, newCount: 0 }); setOpenId(null); }} title={open?.query}>
        {open && (
          <>
            {hits.length === 0 ? <p className="muted">Nessun risultato nuovo da mostrare. Aggiorna per controllare.</p> : (
              <div className="list">{hits.map((h) => <HitCard key={h.key} h={h} saved={inLib.has(h.title.toLowerCase())} onLinks={() => setLinks(h)} />)}</div>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn danger" onClick={async () => { await del('searches', open.id); setOpenId(null); }}>Smetti di monitorare</button>
              <span className="grow" />
              <button className="btn" onClick={() => { presetSearch(open.query); setOpenId(null); nav('sources/search', true); }}>Cerca di nuovo</button>
            </div>
          </>
        )}
      </Sheet>
      <LinksSheet hit={links} onClose={() => setLinks(null)} />
    </>
  );
}

