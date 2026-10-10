import { useEffect, useState } from 'react';
import { requirementChecks } from '../lib/analysis';
import { status } from '../lib/backup';
import { all, on } from '../lib/db';
import { nav } from '../lib/router';
import { useChapters, useDesign, useLive, useMeta, useRequirements, useSearches, useSettings, useSources } from '../lib/store';
import { useThesisStats } from '../lib/stats';
import type { DayStat } from '../lib/types';
import { n, timeAgo, today } from '../lib/util';
import { Icon } from '../ui/Icon';

const STAGES = ['Idea', 'Domanda', 'Fonti', 'Proposta', 'Stesura', 'Revisione', 'Consegna'];

export function Home() {
  const [chapters] = useChapters();
  const [sources] = useSources();
  const [req] = useRequirements();
  const [settings] = useSettings();
  const [design] = useDesign();
  const [meta] = useMeta();
  const [searches] = useSearches();
  const [days] = useLive<DayStat[]>(['days'], () => all('days'), []);
  const [, force] = useState(0);
  useEffect(() => on('save', () => force((x) => x + 1)), []);
  const st = useThesisStats(chapters, sources, req, settings.roles);
  const checks = requirementChecks(chapters, st.body, st.per, req, st.cited.size, sources.length);

  const done = [
    !!design.topic.trim(),
    !!design.mainQuestion.trim() && design.subQuestions.filter((s) => s.trim()).length >= 2,
    sources.filter((s) => s.status !== 'discarded').length >= Math.max(10, Math.round(req.minSources / 2)),
    !!design.method.trim() && !!design.gap.trim(),
    req.minPages ? st.pages >= req.minPages * 0.5 : st.pages > 30,
    req.minPages ? st.pages >= req.minPages : st.pages > 60,
    checks.every((c) => c.ok !== false),
  ];
  const stage = done.findIndex((d) => !d);
  const cur = stage === -1 ? STAGES.length - 1 : stage;
  const nextList: { text: string; action: string; to: string }[] = [
    { text: 'Scrivi in una riga il tema della tesi.', action: 'Apri domanda di ricerca', to: 'rq' },
    { text: 'Formula la domanda principale e almeno due sotto-domande.', action: 'Apri domanda di ricerca', to: 'rq' },
    { text: `Raccogli fonti: ne hai ${sources.length}, punta ad almeno ${Math.max(10, Math.round(req.minSources / 2))}.`, action: 'Cerca fonti', to: 'sources/search' },
    { text: 'Indica lacuna e metodo, poi esporta la proposta per il relatore.', action: 'Completa la proposta', to: 'rq' },
    { text: 'Scrivi: ogni capitolo ha il suo obiettivo e la sua struttura.', action: 'Vai ai capitoli', to: 'write' },
    { text: 'Raggiungi la lunghezza richiesta e bilancia la struttura dei capitoli.', action: 'Vai ai capitoli', to: 'write' },
    { text: 'Controlla requisiti e stile, poi esporta il DOCX.', action: 'Controlla i requisiti', to: 'req' },
  ];
  const next = nextList[cur];

  const t = today();
  const todayChars = days.find((d) => d.date === t)?.chars || 0;
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    const k = today(d);
    return days.find((x) => x.date === k)?.chars || 0;
  });
  const max14 = Math.max(settings.dailyGoal, ...last14, 1);
  const lastEdited = [...chapters].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const newResults = searches.reduce((a, s) => a + s.newCount, 0);
  const deadlineDays = req.deadline ? Math.ceil((new Date(req.deadline).getTime() - Date.now()) / 86400000) : null;
  const pagesLeft = req.minPages ? Math.max(0, req.minPages - st.pages) : 0;
  const saveBad = !!status.fileError;

  return (
    <div className="screen">
      <header className="appbar">
        <h1 className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{meta.title || 'Thesiss'}</h1>
        <button className="status" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => nav('backup')} aria-label="Stato del salvataggio">
          <span className={'dot' + (status.pending ? ' pending' : saveBad ? ' bad' : '')} />
          {status.pending ? 'Salvo…' : saveBad ? 'Controlla backup' : status.lastFile ? `Copia ${timeAgo(status.lastFile)}` : 'Salvato'}
        </button>
      </header>
      <div className="wrap">
        <section className="hero">
          <div className="label">{req.minPages ? `Pagine scritte su ${req.minPages}` : 'Pagine scritte'}</div>
          <div className="big num">{st.pages.toFixed(1).replace('.', ',')}<small>{pagesLeft ? `ne mancano ${pagesLeft.toFixed(0)}` : req.minPages ? 'obiettivo raggiunto' : ''}</small></div>
          {deadlineDays !== null && <div className="small muted" style={{ marginTop: 4 }}>{deadlineDays >= 0 ? `${deadlineDays} giorni alla consegna${pagesLeft && deadlineDays > 0 ? ` · ${(pagesLeft / deadlineDays).toFixed(1).replace('.', ',')} pagine al giorno` : ''}` : 'Scadenza superata'}</div>}
        </section>

        <div className="stages" aria-label={`Fase: ${STAGES[cur]}`}>
          {STAGES.map((s, i) => <i key={s} className={done[i] ? 'done' : i === cur ? 'now' : ''} title={s} />)}
        </div>
        <div className="row small" style={{ justifyContent: 'space-between' }}><span className="muted">Fase</span><b>{STAGES[cur]}</b></div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="small muted">Prossimo passo</div>
          <div style={{ fontWeight: 600, margin: '4px 0 12px' }}>{next.text}</div>
          <button className="btn primary small" onClick={() => nav(next.to)}>{next.action}</button>
        </div>

        {lastEdited && (
          <button className="card row" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', marginTop: 12 }} onClick={() => nav('write/' + lastEdited.id)}>
            <Icon name="pen" />
            <span className="grow"><span className="small muted">Riprendi a scrivere</span><br /><b>{lastEdited.title}</b></span>
            <Icon name="chevron" />
          </button>
        )}

        <div className="section-title"><span className="grow">Oggi</span><span className="small muted num">{n(todayChars)} / {n(settings.dailyGoal)} battute</span></div>
        <div className="card">
          <div className="meter"><i style={{ width: `${Math.min(100, (todayChars / Math.max(1, settings.dailyGoal)) * 100)}%` }} /></div>
          <div className="week" style={{ marginTop: 14 }} aria-label="Ultimi 14 giorni">
            {last14.map((v, i) => <i key={i} className={v ? '' : 'zero'} style={{ height: `${Math.max(4, (v / max14) * 100)}%` }} title={`${n(v)} battute`} />)}
          </div>
          <div className="row tiny muted" style={{ justifyContent: 'space-between', marginTop: 6 }}><span>14 giorni fa</span><span>oggi</span></div>
        </div>

        {design.mainQuestion && (
          <>
            <div className="section-title">La tua domanda</div>
            <button className="card serif" style={{ width: '100%', textAlign: 'left', fontSize: 18, lineHeight: 1.45, cursor: 'pointer' }} onClick={() => nav('rq')}>{design.mainQuestion}</button>
          </>
        )}

        <div className="section-title">Panoramica</div>
        <div className="stat-grid">
          <button className="stat-cell" onClick={() => nav('sources')} style={cell}><div className="v">{sources.length}</div><div className="k">fonti · {st.cited.size} citate</div></button>
          <button className="stat-cell" onClick={() => nav('sources/saved')} style={cell}><div className="v">{newResults}</div><div className="k">risultati nuovi monitorati</div></button>
          <button className="stat-cell" onClick={() => nav('req')} style={cell}><div className="v">{checks.filter((c) => c.ok).length}/{checks.length}</div><div className="k">requisiti rispettati</div></button>
          <button className="stat-cell" onClick={() => nav('write')} style={cell}><div className="v">{n(st.total.words)}</div><div className="k">parole · {st.total.notes} note</div></button>
        </div>
      </div>
    </div>
  );
}

const cell: React.CSSProperties = { border: 0, textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', background: 'var(--surface)', padding: '12px 14px' };
