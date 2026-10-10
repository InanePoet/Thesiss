import { useMemo, useState } from 'react';
import { wordCount } from '../lib/analysis';
import { putMany } from '../lib/db';
import { chapter } from '../lib/defaults';
import { saveExport } from '../lib/platform';
import { back, nav } from '../lib/router';
import { useChapters, useDesign, useMeta, useSources } from '../lib/store';
import type { ResearchDesign } from '../lib/types';
import { today } from '../lib/util';
import { Icon } from '../ui/Icon';
import { AppBar, Field, Sheet, toast } from '../ui/kit';
import { presetSearch } from './Sources';

const TYPES: { v: ResearchDesign['questionType']; l: string; ex: string }[] = [
  { v: 'explanatory', l: 'Esplicativa', ex: 'Perché / in che misura X ha determinato Y?' },
  { v: 'descriptive', l: 'Descrittiva', ex: 'Come si è evoluto X tra il … e il …?' },
  { v: 'comparative', l: 'Comparativa', ex: 'In che cosa differiscono X e Y rispetto a Z?' },
  { v: 'evaluative', l: 'Valutativa', ex: 'In che misura X ha raggiunto l’obiettivo Y?' },
  { v: 'exploratory', l: 'Esplorativa', ex: 'Quali fattori spiegano X nel contesto Y?' },
];

interface Q { ok: boolean | null; text: string }

function evaluate(d: ResearchDesign, libraryHits: number): Q[] {
  const q = d.mainQuestion.trim();
  const out: Q[] = [];
  if (!q) return [{ ok: null, text: 'Scrivi la domanda principale per vedere la valutazione.' }];
  out.push({ ok: q.endsWith('?'), text: q.endsWith('?') ? 'È formulata come domanda.' : 'Formulala come domanda, con il punto interrogativo.' });
  const open = /^(come|perch[eé]|in che (misura|modo)|fino a che punto|quali?|che (ruolo|cosa|tipo)|in quali|attraverso quali|per quali|a quali|secondo quali|cosa|how|why|to what extent|what)/i.test(q);
  const closed = /^(è|e'|esiste|ci sono|ha |hanno |può|possono|si può|is |are |does |do |can )/i.test(q);
  out.push({ ok: open && !closed, text: open && !closed ? 'È una domanda aperta (non si risponde con sì/no).' : closed ? 'Si può rispondere con sì/no: riformulala con «in che misura», «come», «perché».' : 'Prova ad aprire con «come», «perché», «in che misura»…' });
  const w = wordCount(q);
  out.push({ ok: w >= 8 && w <= 35, text: w < 8 ? `È molto breve (${w} parole): forse troppo generica.` : w > 35 ? `È lunga (${w} parole): forse contiene più domande.` : `Lunghezza adeguata (${w} parole).` });
  const multi = (q.match(/\?/g) || []).length > 1 || /\be (come|perch[eé]|quali)\b/i.test(q);
  if (multi) out.push({ ok: false, text: 'Sembra contenere più domande: sposta le altre tra le sotto-domande.' });
  const vague = q.match(/\b(aspetti|vari[eo]?|alcun[ie]|importanza|rapporto tra|tematiche|questioni|in generale)\b/i);
  if (vague) out.push({ ok: false, text: `Termine vago: «${vague[0]}». Specifica cosa intendi.` });
  const hasTime = !!d.scopeTime.trim() || /\b(1[89]|20)\d{2}\b|dopoguerra|guerra fredda|era|governo|amministrazione/i.test(q);
  out.push({ ok: hasTime, text: hasTime ? 'Il periodo è delimitato.' : 'Delimita il periodo (es. 2012-2020, governo Abe).' });
  const hasPlace = !!d.scopePlace.trim();
  out.push({ ok: hasPlace, text: hasPlace ? 'L’ambito/caso è delimitato.' : 'Indica il caso o l’ambito (paese, istituzione, attori).' });
  out.push({ ok: !!d.gap.trim(), text: d.gap.trim() ? 'Hai indicato la lacuna nella letteratura.' : 'Indica quale lacuna nella letteratura colma la tesi.' });
  const sq = d.subQuestions.filter((s) => s.trim()).length;
  out.push({ ok: sq >= 2 && sq <= 5, text: sq < 2 ? 'Aggiungi 2-4 sotto-domande: diventeranno i capitoli.' : sq > 5 ? 'Più di 5 sotto-domande: valuta di accorparle.' : `${sq} sotto-domande: bene per ${sq} capitoli di analisi.` });
  out.push({ ok: !!d.method.trim(), text: d.method.trim() ? 'Il metodo è indicato.' : 'Descrivi il metodo (analisi documentale, process tracing, comparazione, interviste…).' });
  out.push({ ok: libraryHits >= 5 ? true : libraryHits > 0 ? null : false, text: `Fonti in biblioteca pertinenti alle parole chiave: ${libraryHits}${libraryHits < 5 ? ' (fattibilità da verificare: cerca altre fonti)' : ''}.` });
  return out;
}

export function ResearchQuestion() {
  const [d, setD] = useDesign();
  const [chapters] = useChapters();
  const [sources] = useSources();
  const [meta] = useMeta();
  const [outline, setOutline] = useState(false);
  const up = (p: Partial<ResearchDesign>) => setD((x) => ({ ...x, ...p, updatedAt: Date.now() }));

  const kw = d.keywords;
  const libraryHits = useMemo(() => {
    if (!kw.length) return 0;
    const ks = kw.map((k) => k.toLowerCase());
    return sources.filter((s) => ks.some((k) => (s.title + ' ' + (s.titleAlt || '') + ' ' + (s.abstract || '') + ' ' + s.keywords.join(' ')).toLowerCase().includes(k))).length;
  }, [kw, sources]);
  const checks = evaluate(d, libraryHits);
  const score = checks.filter((c) => c.ok).length;

  const list = (key: 'subQuestions' | 'hypotheses', label: string, ph: string) => (
    <Field label={label}>
      <div className="stack">
        {d[key].map((v, i) => (
          <div key={i} className="row">
            <span className="num muted" style={{ width: 18 }}>{i + 1}.</span>
            <input className="input" value={v} placeholder={ph} onChange={(e) => up({ [key]: d[key].map((x, j) => (j === i ? e.target.value : x)) } as Partial<ResearchDesign>)} />
            <button className="iconbtn" aria-label="Rimuovi" onClick={() => up({ [key]: d[key].filter((_, j) => j !== i) } as Partial<ResearchDesign>)}><Icon name="x" size={18} /></button>
          </div>
        ))}
        <button className="btn small" onClick={() => up({ [key]: [...d[key], ''] } as Partial<ResearchDesign>)}><Icon name="plus" size={18} /> Aggiungi</button>
      </div>
    </Field>
  );

  const makeOutline = async (mode: 'append' | 'fill') => {
    const subs = d.subQuestions.filter((s) => s.trim());
    const plan = [
      { title: 'Introduzione', kind: 'intro' as const, purpose: `Contesto, domanda («${d.mainQuestion}»), metodo, struttura` },
      { title: 'Quadro teorico e stato dell’arte', kind: 'chapter' as const, purpose: d.gap ? `Mostrare la lacuna: ${d.gap}` : 'Letteratura e concetti chiave' },
      ...subs.map((s) => ({ title: s.replace(/\?$/, '').slice(0, 70), kind: 'chapter' as const, purpose: `Rispondere a: ${s}` })),
      { title: 'Conclusioni', kind: 'conclusion' as const, purpose: `Risposta alla domanda: ${d.mainQuestion}` },
    ];
    if (mode === 'fill') {
      // rinomina i capitoli vuoti esistenti, poi aggiunge quelli mancanti
      const empty = chapters.filter((c) => JSON.stringify(c.content).length < 80 && c.kind !== 'abstract');
      const used = new Set<string>();
      const updated = [] as typeof chapters;
      for (const p of plan) {
        const target = empty.find((c) => !used.has(c.id) && c.kind === p.kind);
        if (target) { used.add(target.id); updated.push({ ...target, title: p.title, purpose: p.purpose }); }
        else updated.push(chapter(p.title, p.kind, 0, p.purpose));
      }
      const others = chapters.filter((c) => !updated.some((u) => u.id === c.id));
      const abs = others.filter((c) => c.kind === 'abstract' || c.kind === 'front');
      const rest = others.filter((c) => !abs.includes(c) && !empty.includes(c));
      const final = [...abs, ...updated.filter((u) => u.kind === 'intro'), ...rest, ...updated.filter((u) => u.kind === 'chapter'), ...updated.filter((u) => u.kind === 'conclusion')];
      const leftovers = empty.filter((c) => !used.has(c.id));
      await putMany('chapters', [...final, ...leftovers].map((c, i) => ({ ...c, order: i })));
    } else {
      await putMany('chapters', plan.map((p, i) => chapter(p.title, p.kind, chapters.length + i, p.purpose)));
    }
    setOutline(false);
    toast('Scaletta creata.');
    nav('write');
  };

  const exportProposal = async () => {
    const md = [
      `# Proposta di ricerca${meta.title ? ': ' + meta.title : ''}`,
      meta.author ? `*${meta.author}*${meta.supervisor ? ` — relatore: ${meta.supervisor}` : ''}\n` : '',
      d.topic && `## Tema\n${d.topic}\n`,
      d.context && `## Contesto\n${d.context}\n`,
      d.problem && `## Problema\n${d.problem}\n`,
      d.gap && `## Lacuna nella letteratura\n${d.gap}\n`,
      `## Domanda di ricerca\n**${d.mainQuestion || '—'}**\n`,
      d.subQuestions.some((s) => s.trim()) && `### Sotto-domande\n${d.subQuestions.filter((s) => s.trim()).map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`,
      d.hypotheses.some((s) => s.trim()) && `## Ipotesi\n${d.hypotheses.filter((s) => s.trim()).map((s) => `- ${s}`).join('\n')}\n`,
      d.method && `## Metodo\n${d.method}\n`,
      d.sources && `## Fonti e dati\n${d.sources}\n`,
      (d.scopeTime || d.scopePlace) && `## Delimitazione\n${[d.scopeTime && 'Periodo: ' + d.scopeTime, d.scopePlace && 'Ambito: ' + d.scopePlace].filter(Boolean).join('  \n')}\n`,
      d.limits && `## Limiti\n${d.limits}\n`,
      d.relevance && `## Rilevanza\n${d.relevance}\n`,
      kw.length && `**Parole chiave:** ${kw.join(', ')}`,
    ].filter(Boolean).join('\n');
    const where = await saveExport(`proposta-di-ricerca-${today()}.md`, md, 'text/markdown');
    toast('Proposta salvata: ' + where);
  };

  return (
    <div className="screen no-nav">
      <AppBar title="Domanda di ricerca" sub={`${score} su ${checks.length} criteri soddisfatti`} onBack={() => back('home')} actions={<button className="iconbtn" aria-label="Esporta proposta" onClick={exportProposal}><Icon name="download" /></button>} />
      <div className="wrap">
        <div className="card" style={{ borderColor: 'var(--accent)', borderWidth: 1.5 }}>
          <Field label="Domanda principale">
            <textarea className="textarea serif" rows={3} value={d.mainQuestion} onChange={(e) => up({ mainQuestion: e.target.value })} placeholder={TYPES.find((t) => t.v === d.questionType)?.ex} style={{ fontSize: 19 }} />
          </Field>
          <div className="chips">
            {TYPES.map((t) => <button key={t.v} className={'chip' + (d.questionType === t.v ? ' on' : '')} onClick={() => up({ questionType: t.v })}>{t.l}</button>)}
          </div>
        </div>

        <div className="section-title">Valutazione</div>
        <div className="list">
          {checks.map((c, i) => (
            <div key={i} className="check">
              <span className={'mark ' + (c.ok === null ? 'na' : c.ok ? 'ok' : 'no')}><Icon name={c.ok ? 'check' : c.ok === null ? 'clock' : 'x'} size={16} /></span>
              <span className="small">{c.text}</span>
            </div>
          ))}
        </div>

        <div className="section-title">Dal tema al problema</div>
        <Field label="Tema" hint="L'argomento generale, in una riga."><input className="input" value={d.topic} onChange={(e) => up({ topic: e.target.value })} /></Field>
        <Field label="Contesto"><textarea className="textarea" value={d.context} onChange={(e) => up({ context: e.target.value })} placeholder="Cosa sta succedendo, perché ora" /></Field>
        <Field label="Problema" hint="La tensione o il fatto che non si spiega bene."><textarea className="textarea" value={d.problem} onChange={(e) => up({ problem: e.target.value })} /></Field>
        <Field label="Lacuna nella letteratura" hint="Cosa non hanno ancora fatto o spiegato gli studi esistenti."><textarea className="textarea" value={d.gap} onChange={(e) => up({ gap: e.target.value })} /></Field>

        <div className="section-title">Struttura della risposta</div>
        {list('subQuestions', 'Sotto-domande', 'Una per capitolo di analisi')}
        {list('hypotheses', 'Ipotesi o tesi da sostenere', 'Cosa ti aspetti di trovare')}

        <div className="section-title">Come rispondi</div>
        <Field label="Metodo"><textarea className="textarea" value={d.method} onChange={(e) => up({ method: e.target.value })} placeholder="Analisi documentale di fonti primarie (leggi, verbali della Dieta), process tracing, interviste…" /></Field>
        <Field label="Fonti e dati"><textarea className="textarea" value={d.sources} onChange={(e) => up({ sources: e.target.value })} placeholder="Archivi, documenti governativi, letteratura in giapponese e inglese…" /></Field>
        <div className="grid2">
          <Field label="Periodo"><input className="input" value={d.scopeTime} onChange={(e) => up({ scopeTime: e.target.value })} placeholder="2012–2024" /></Field>
          <Field label="Ambito / caso"><input className="input" value={d.scopePlace} onChange={(e) => up({ scopePlace: e.target.value })} placeholder="Giappone" /></Field>
        </div>
        <Field label="Limiti"><textarea className="textarea" value={d.limits} onChange={(e) => up({ limits: e.target.value })} /></Field>
        <Field label="Rilevanza" hint="Perché la risposta interessa a qualcuno (studiosi, policy)."><textarea className="textarea" value={d.relevance} onChange={(e) => up({ relevance: e.target.value })} /></Field>
        <Field label="Parole chiave" hint="Separate da virgola, anche in giapponese o inglese. Servono a cercare fonti e a valutare la fattibilità.">
          <input className="input" defaultValue={kw.join(', ')} onBlur={(e) => up({ keywords: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
        </Field>
        {kw.length > 0 && <div className="chips" style={{ marginBottom: 16 }}>{kw.map((k) => <button key={k} className="chip" onClick={() => { presetSearch(k); nav('sources/search'); }}><Icon name="search" size={15} /> {k}</button>)}</div>}

        <button className="btn primary block" onClick={() => setOutline(true)} disabled={!d.mainQuestion.trim()}><Icon name="list" /> Genera la scaletta dei capitoli</button>
        <button className="btn block" style={{ marginTop: 10 }} onClick={exportProposal}><Icon name="download" /> Esporta la proposta di ricerca</button>
      </div>
      <Sheet open={outline} onClose={() => setOutline(false)} title="Scaletta dalla domanda">
        <p className="small muted" style={{ marginTop: -6 }}>Introduzione, quadro teorico, un capitolo per sotto-domanda, conclusioni. Ogni capitolo riceve il suo obiettivo.</p>
        <div className="list">
          <button className="item" onClick={() => void makeOutline('fill')}><span className="grow"><span className="title">Usa i capitoli vuoti</span><br /><span className="meta">Rinomina quelli ancora vuoti, non tocca quelli già scritti</span></span></button>
          <button className="item" onClick={() => void makeOutline('append')}><span className="grow"><span className="title">Aggiungi in fondo</span><br /><span className="meta">Crea nuovi capitoli</span></span></button>
        </div>
      </Sheet>
    </div>
  );
}
