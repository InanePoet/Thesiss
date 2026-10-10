import { useEffect, useState } from 'react';
import { status } from '../lib/backup';
import { on } from '../lib/db';
import { ACCENTS, DEFAULT_ROLES } from '../lib/defaults';
import { back, nav } from '../lib/router';
import { useMeta, useSettings, type ThesisMeta } from '../lib/store';
import type { Settings } from '../lib/types';
import { timeAgo } from '../lib/util';
import { Icon } from '../ui/Icon';
import { AppBar, Field, NumInput, Seg, Switch } from '../ui/kit';

export function More() {
  const [, force] = useState(0);
  useEffect(() => on('save', () => force((x) => x + 1)), []);
  const items: [string, string, string, string][] = [
    ['question', 'Domanda di ricerca', 'Struttura, valutazione, scaletta, proposta', 'rq'],
    ['ruler', 'Requisiti dell’università', 'Pagine, battute, formato, stile', 'req'],
    ['book', 'Frontespizio', 'Titolo, relatore, ateneo', 'meta'],
    ['shield', 'Backup e versioni', status.fileError ? 'Attenzione: ' + status.fileError.slice(0, 60) : `Ultima copia su file ${timeAgo(status.lastFile)}`, 'backup'],
    ['settings', 'Impostazioni', 'Aspetto, ruoli, ricerca, proxy biblioteca', 'settings'],
  ];
  return (
    <div className="screen">
      <AppBar title="Altro" />
      <div className="wrap">
        <div className="list">
          {items.map(([icon, title, meta, to]) => (
            <button key={to} className="item" onClick={() => nav(to)}>
              <Icon name={icon} />
              <span className="grow"><span className="title">{title}</span><br /><span className="meta">{meta}</span></span>
              <Icon name="chevron" />
            </button>
          ))}
        </div>
        <p className="tiny faint" style={{ textAlign: 'center', marginTop: 24 }}>Thesiss {__APP_VERSION__} · i dati restano sul telefono</p>
      </div>
    </div>
  );
}

export function MetaView() {
  const [m, setM] = useMeta();
  const f = (k: keyof ThesisMeta, label: string, ph = '') => (
    <Field label={label}><input className="input" value={m[k]} placeholder={ph} onChange={(e) => setM((x) => ({ ...x, [k]: e.target.value }))} /></Field>
  );
  return (
    <div className="screen no-nav">
      <AppBar title="Frontespizio" onBack={() => back('more')} />
      <div className="wrap">
        <p className="small muted">Usati nell'esportazione DOCX per la pagina del titolo.</p>
        {f('title', 'Titolo della tesi')}
        {f('subtitle', 'Sottotitolo')}
        {f('author', 'Candidato/a')}
        {f('university', 'Università')}
        {f('department', 'Dipartimento')}
        {f('course', 'Corso di laurea magistrale')}
        {f('supervisor', 'Relatore/Relatrice', 'Prof. …')}
        {f('cosupervisor', 'Correlatore/Correlatrice')}
        {f('year', 'Anno accademico', '2026/2027')}
      </div>
    </div>
  );
}

export function SettingsView() {
  const [s, setS] = useSettings();
  const up = (p: Partial<Settings>) => setS((x) => ({ ...x, ...p }));
  return (
    <div className="screen no-nav">
      <AppBar title="Impostazioni" onBack={() => back('more')} />
      <div className="wrap">
        <div className="section-title">Aspetto</div>
        <Field label="Tema"><Seg value={s.theme} onChange={(v) => up({ theme: v })} options={[{ value: 'auto', label: 'Automatico' }, { value: 'light', label: 'Chiaro' }, { value: 'dark', label: 'Scuro' }]} /></Field>
        <Field label="Colore">
          <div className="row wrap-row">
            {ACCENTS.map((a) => <button key={a.value} className={'swatch' + (s.accent === a.value ? ' on' : '')} style={{ background: a.value }} aria-label={a.name} onClick={() => up({ accent: a.value })} />)}
            <input type="color" value={s.accent} onChange={(e) => up({ accent: e.target.value })} aria-label="Colore personalizzato" style={{ width: 40, height: 40, border: 0, background: 'none' }} />
          </div>
        </Field>
        <Field label="Densità"><Seg value={s.density} onChange={(v) => up({ density: v })} options={[{ value: 'comfortable', label: 'Ariosa' }, { value: 'compact', label: 'Compatta' }]} /></Field>

        <div className="section-title">Editor</div>
        <Field label="Carattere del testo"><Seg value={s.editorFont} onChange={(v) => up({ editorFont: v })} options={[{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }, { value: 'mono', label: 'Mono' }]} /></Field>
        <div className="grid2">
          <Field label="Dimensione (px)"><NumInput value={s.editorSize} onChange={(v) => up({ editorSize: Math.max(12, Math.min(28, v)) })} /></Field>
          <Field label="Interlinea"><NumInput value={s.editorLeading} step={0.1} onChange={(v) => up({ editorLeading: Math.max(1.2, Math.min(2.4, v)) })} /></Field>
        </div>
        <Field label="Obiettivo giornaliero (battute)"><NumInput value={s.dailyGoal} step={500} onChange={(v) => up({ dailyGoal: v })} /></Field>
        <Switch label="Mostra la struttura argomentativa" hint="Nastro colorato a sinistra dei paragrafi" checked={s.showRoles} onChange={(v) => up({ showRoles: v })} />

        <div className="section-title"><span className="grow">Ruoli argomentativi</span><button className="btn small" onClick={() => up({ roles: DEFAULT_ROLES })}>Ripristina</button></div>
        <p className="small muted" style={{ marginTop: -4 }}>Rinominali come preferisci. Le quote indicano lo spazio atteso nel capitolo.</p>
        {s.roles.map((r, i) => (
          <div key={r.key} className="card" style={{ marginBottom: 10, padding: 12 }}>
            <div className="row">
              <input type="color" value={r.color} onChange={(e) => up({ roles: s.roles.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} style={{ width: 36, height: 36, border: 0, background: 'none' }} aria-label="Colore" />
              <input className="input grow" value={r.label} onChange={(e) => up({ roles: s.roles.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
            </div>
            <div className="grid2" style={{ marginTop: 8 }}>
              <Field label="Quota min %"><NumInput value={Math.round(r.min * 100)} onChange={(v) => up({ roles: s.roles.map((x, j) => (j === i ? { ...x, min: v / 100 } : x)) })} /></Field>
              <Field label="Quota max %"><NumInput value={Math.round(r.max * 100)} onChange={(v) => up({ roles: s.roles.map((x, j) => (j === i ? { ...x, max: v / 100 } : x)) })} /></Field>
            </div>
          </div>
        ))}

        <div className="section-title">Ricerca fonti</div>
        <Field label="Proxy della biblioteca" hint="Prefisso EZproxy del tuo ateneo, es. https://ezproxy.tuaateneo.it/login?url= — apre gli articoli a pagamento con il tuo login.">
          <input className="input" value={s.libraryProxy} onChange={(e) => up({ libraryProxy: e.target.value.trim() })} placeholder="https://…/login?url=" />
        </Field>
        <Field label="Catalogo della biblioteca" hint="Link di ricerca con {q} al posto delle parole cercate.">
          <input className="input" value={s.catalogUrl} onChange={(e) => up({ catalogUrl: e.target.value.trim() })} placeholder="https://catalogo…/search?q={q}" />
        </Field>
        <Field label="Email per OpenAlex e Crossref" hint="Facoltativa: dà accesso a una corsia più veloce. Resta sul telefono.">
          <input className="input" type="email" value={s.mailto} onChange={(e) => up({ mailto: e.target.value.trim() })} />
        </Field>
        <Field label="Chiave Semantic Scholar" hint="Facoltativa e gratuita: senza chiave il servizio è spesso saturo.">
          <input className="input" value={s.s2Key} onChange={(e) => up({ s2Key: e.target.value.trim() })} />
        </Field>
      </div>
    </div>
  );
}
