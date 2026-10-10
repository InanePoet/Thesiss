import { useMemo, useState } from 'react';
import { blocks, parseRequirements, requirementChecks, styleCheck } from '../lib/analysis';
import { pickFile } from '../lib/platform';
import { makeCiteResolver, makeNoteResolver } from '../lib/resolve';
import { back } from '../lib/router';
import { readPdf } from '../lib/search/importers';
import { useChapters, useRequirements, useSettings, useSources } from '../lib/store';
import { useThesisStats } from '../lib/stats';
import type { Requirements as Req } from '../lib/types';
import { n } from '../lib/util';
import { Icon } from '../ui/Icon';
import { AppBar, Field, NumInput, Seg, Sheet, Switch, toast } from '../ui/kit';

export function RequirementsView() {
  const [req, setReq] = useRequirements();
  const [chapters] = useChapters();
  const [sources] = useSources();
  const [settings] = useSettings();
  const st = useThesisStats(chapters, sources, req, settings.roles);
  const [parseOpen, setParseOpen] = useState(false);
  const [rawText, setRawText] = useState('');
  const [found, setFound] = useState<ReturnType<typeof parseRequirements> | null>(null);
  const up = (p: Partial<Req>) => setReq((r) => ({ ...r, ...p }));

  const checks = requirementChecks(chapters, st.body, st.per, req, st.cited.size, sources.length);
  const style = useMemo(() => {
    const smap = new Map(sources.map((s) => [s.id, s]));
    const all = chapters.flatMap((c) => blocks(c.content, makeNoteResolver(smap, req), makeCiteResolver(smap, req)));
    return styleCheck(all, req);
  }, [chapters, sources, req]);

  const loadFile = async () => {
    const f = await pickFile('.pdf,.txt,.docx,application/pdf,text/plain');
    if (!f) return;
    try {
      let text = '';
      if (/\.pdf$/i.test(f.name)) text = (await readPdf(await f.arrayBuffer())).text;
      else if (/\.docx$/i.test(f.name)) {
        const mammoth = (await import('mammoth')).default;
        text = (await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })).value;
      } else text = await f.text();
      setRawText(text.slice(0, 60000));
      setFound(parseRequirements(text));
    } catch (e) { toast('File non leggibile: ' + (e as Error).message); }
  };

  const ok = checks.filter((c) => c.ok === true).length;
  return (
    <div className="screen no-nav">
      <AppBar title="Requisiti" sub={`${ok} su ${checks.length} rispettati`} onBack={() => back('write')} />
      <div className="wrap">
        <div className="list">
          {checks.map((c) => (
            <div key={c.label} className="check">
              <span className={'mark ' + (c.ok === null ? 'na' : c.ok ? 'ok' : 'no')}><Icon name={c.ok ? 'check' : c.ok === null ? 'clock' : 'x'} size={16} /></span>
              <div className="grow"><div style={{ fontWeight: 600 }}>{c.label}</div><div className="small muted">{c.detail}</div></div>
            </div>
          ))}
        </div>

        <div className="section-title">Stile su tutta la tesi</div>
        {style.length === 0 ? <div className="notice ok">Nessun problema rilevato.</div> : <div className="stack">{style.map((s, i) => <div key={i} className={'notice ' + (s.level === 'warn' ? 'warn' : 'info')}>{s.text}</div>)}</div>}

        <div className="section-title"><span className="grow">Regole dell'università</span><button className="btn small" onClick={() => setParseOpen(true)}><Icon name="sparkle" size={18} /> Leggi dal regolamento</button></div>
        <Field label="Nome del regolamento"><input className="input" value={req.name} onChange={(e) => up({ name: e.target.value })} /></Field>
        <div className="grid2">
          <Field label="Pagine minime"><NumInput value={req.minPages} onChange={(v) => up({ minPages: v })} /></Field>
          <Field label="Pagine massime" hint="0 = nessun limite"><NumInput value={req.maxPages} onChange={(v) => up({ maxPages: v })} /></Field>
          <Field label="Battute minime" hint="0 = usa le pagine"><NumInput value={req.minChars} step={1000} onChange={(v) => up({ minChars: v })} /></Field>
          <Field label="Battute massime"><NumInput value={req.maxChars} step={1000} onChange={(v) => up({ maxChars: v })} /></Field>
        </div>
        <Field label="Battute per pagina" hint="Cartella editoriale = 1.800. Molti atenei usano 2.000 o 2.500.">
          <div className="chips" style={{ marginBottom: 8 }}>{[1800, 2000, 2500, 3000].map((v) => <button key={v} className={'chip' + (req.charsPerPage === v ? ' on' : '')} onClick={() => up({ charsPerPage: v })}>{n(v)}</button>)}</div>
          <NumInput value={req.charsPerPage} step={100} onChange={(v) => up({ charsPerPage: v })} />
        </Field>
        <Switch label="Conta gli spazi" checked={req.countSpaces} onChange={(v) => up({ countSpaces: v })} />
        <Switch label="Conta le note a piè di pagina" checked={req.countFootnotes} onChange={(v) => up({ countFootnotes: v })} />
        <Switch label="Conta abstract e frontespizio" checked={req.countFront} onChange={(v) => up({ countFront: v })} />
        <div className="card small muted num" style={{ margin: '8px 0 16px' }}>
          Ora: {n(st.body.chars)} con spazi · {n(st.body.charsNoSpaces)} senza spazi · note {n(st.body.notesChars)} → conteggio valido {n(st.measured)} battute = {st.pages.toFixed(1).replace('.', ',')} pagine
        </div>

        <div className="section-title">Formato (applicato nell'esportazione DOCX)</div>
        <div className="grid2">
          <Field label="Carattere"><select className="select" value={req.font} onChange={(e) => up({ font: e.target.value })}>{['Times New Roman', 'Garamond', 'Book Antiqua', 'Palatino Linotype', 'Georgia', 'Cambria', 'Arial', 'Calibri'].map((f) => <option key={f}>{f}</option>)}</select></Field>
          <Field label="Corpo (pt)"><NumInput value={req.fontSize} onChange={(v) => up({ fontSize: v })} /></Field>
          <Field label="Corpo note (pt)"><NumInput value={req.noteFontSize} onChange={(v) => up({ noteFontSize: v })} /></Field>
          <Field label="Interlinea"><NumInput value={req.lineSpacing} step={0.5} onChange={(v) => up({ lineSpacing: v })} /></Field>
          <Field label="Margini (cm)"><NumInput value={req.marginCm} step={0.5} onChange={(v) => up({ marginCm: v })} /></Field>
          <Field label="Max parole per frase"><NumInput value={req.maxSentenceWords} onChange={(v) => up({ maxSentenceWords: v })} /></Field>
        </div>
        <Field label="Stile delle citazioni">
          <Seg value={req.citationStyle} onChange={(v) => up({ citationStyle: v })} options={[{ value: 'chicago-note', label: 'Note' }, { value: 'author-date-it', label: 'Autore-data' }, { value: 'apa', label: 'APA' }]} />
        </Field>
        <div className="section-title">Contenuti</div>
        <div className="grid2">
          <Field label="Capitoli minimi"><NumInput value={req.minChapters} onChange={(v) => up({ minChapters: v })} /></Field>
          <Field label="Fonti citate minime"><NumInput value={req.minSources} onChange={(v) => up({ minSources: v })} /></Field>
          <Field label="Abstract max battute"><NumInput value={req.abstractMaxChars} step={100} onChange={(v) => up({ abstractMaxChars: v })} /></Field>
          <Field label="Scadenza"><input className="input" type="date" value={req.deadline || ''} onChange={(e) => up({ deadline: e.target.value })} /></Field>
        </div>
        <Switch label="Abstract obbligatorio" checked={req.requireAbstract} onChange={(v) => up({ requireAbstract: v })} />
        <Switch label="Introduzione" checked={req.requireIntro} onChange={(v) => up({ requireIntro: v })} />
        <Switch label="Conclusioni" checked={req.requireConclusion} onChange={(v) => up({ requireConclusion: v })} />
        <Switch label="Bibliografia" checked={req.requireBibliography} onChange={(v) => up({ requireBibliography: v })} />
        <Switch label="Evita la prima persona singolare" checked={req.firstPerson === 'avoid'} onChange={(v) => up({ firstPerson: v ? 'avoid' : 'allowed' })} />
        <Field label="Altre indicazioni del relatore"><textarea className="textarea" value={req.notes} onChange={(e) => up({ notes: e.target.value })} /></Field>
      </div>

      <Sheet open={parseOpen} onClose={() => setParseOpen(false)} title="Leggi dal regolamento">
        <p className="small muted" style={{ marginTop: -6 }}>Incolla il testo delle linee guida o carica il PDF/DOCX: cerco pagine, battute, carattere, interlinea, margini e stile citazioni con regole fisse, senza AI.</p>
        <button className="btn block" onClick={loadFile}><Icon name="upload" /> Carica file</button>
        <Field label="Oppure incolla il testo"><textarea className="textarea" rows={6} value={rawText} onChange={(e) => { setRawText(e.target.value); setFound(parseRequirements(e.target.value)); }} /></Field>
        {found && (found.found.length ? (
          <>
            <div className="small" style={{ marginBottom: 8 }}>Trovato:</div>
            <div className="chips" style={{ marginBottom: 12 }}>{found.found.map((f, i) => <span key={i} className="chip static">{f}</span>)}</div>
            <button className="btn primary block" onClick={() => { const { found: _f, ...rest } = found; up(rest); setParseOpen(false); toast('Requisiti aggiornati: controllali.'); }}>Applica</button>
          </>
        ) : <div className="notice info">Non ho riconosciuto requisiti nel testo. Inseriscili a mano.</div>)}
      </Sheet>
    </div>
  );
}
