import type { JSONContent } from '@tiptap/core';
import type { Chapter, Requirements, RoleDef, RoleKey } from './types';

/** Testo di una nota/citazione già risolto (formattazione citazioni) */
export type NoteResolver = (attrs: Record<string, any>) => string;
export type CiteResolver = (attrs: Record<string, any>) => string;

export interface Block {
  kind: 'p' | 'h' | 'li' | 'quote';
  level?: number;
  role?: RoleKey | null;
  text: string;
  notes: string[];
}

const plainNote: NoteResolver = (a) => [a.citation, a.text].filter(Boolean).join(' ');
const plainCite: CiteResolver = (a) => a.label || '(cit.)';

function inlineText(n: JSONContent, notes: string[], nr: NoteResolver, cr: CiteResolver): string {
  if (n.type === 'text') return n.text || '';
  if (n.type === 'hardBreak') return '\n';
  if (n.type === 'footnote') { notes.push(nr(n.attrs || {})); return ''; }
  if (n.type === 'cite') return cr(n.attrs || {});
  return (n.content || []).map((c) => inlineText(c, notes, nr, cr)).join('');
}

export function blocks(doc: JSONContent, nr: NoteResolver = plainNote, cr: CiteResolver = plainCite): Block[] {
  const out: Block[] = [];
  const walk = (n: JSONContent, ctx: 'li' | 'quote' | null) => {
    if (n.type === 'paragraph' || n.type === 'heading') {
      const notes: string[] = [];
      const text = (n.content || []).map((c) => inlineText(c, notes, nr, cr)).join('');
      out.push({
        kind: n.type === 'heading' ? 'h' : ctx === 'li' ? 'li' : ctx === 'quote' ? 'quote' : 'p',
        level: n.attrs?.level,
        role: (n.attrs?.role as RoleKey) || null,
        text,
        notes,
      });
      return;
    }
    const next = n.type === 'listItem' ? 'li' : n.type === 'blockquote' ? 'quote' : ctx;
    (n.content || []).forEach((c) => walk(c, next));
  };
  walk(doc, null);
  return out;
}

export interface Counts {
  chars: number; // con spazi, solo testo
  charsNoSpaces: number;
  notesChars: number;
  notesNoSpaces: number;
  words: number;
  notes: number;
  paragraphs: number;
  sentences: number;
  headings: number;
}

const ws = /\s/g;
export function wordCount(t: string): number {
  // conta anche blocchi CJK come parole per carattere
  const cjk = (t.match(/[぀-ヿ㐀-鿿]/g) || []).length;
  const latin = (t.replace(/[぀-ヿ㐀-鿿]/g, ' ').match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) || []).length;
  return latin + cjk;
}
export function sentencesOf(t: string): string[] {
  return t
    .replace(/\b(pp?|cfr|ecc|vol|ed|n|art|cap|sez|fig|ivi|ibid|op|cit|es|ca|sec|vv|nn|S\.?p\.?A|U\.?S|U\.?K)\./gi, (m) => m.replace('.', '․'))
    .split(/(?<=[.!?…。？！])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

export function count(bs: Block[]): Counts {
  const c: Counts = { chars: 0, charsNoSpaces: 0, notesChars: 0, notesNoSpaces: 0, words: 0, notes: 0, paragraphs: 0, sentences: 0, headings: 0 };
  for (const b of bs) {
    c.chars += b.text.length;
    c.charsNoSpaces += b.text.replace(ws, '').length;
    c.words += wordCount(b.text);
    if (b.kind === 'h') c.headings++;
    else if (b.text.trim()) { c.paragraphs++; c.sentences += sentencesOf(b.text).length; }
    for (const nt of b.notes) {
      c.notes++;
      c.notesChars += nt.length;
      c.notesNoSpaces += nt.replace(ws, '').length;
    }
  }
  return c;
}

export function addCounts(a: Counts, b: Counts): Counts {
  const o = { ...a };
  (Object.keys(b) as (keyof Counts)[]).forEach((k) => (o[k] += b[k]));
  return o;
}
export const zeroCounts = (): Counts => count([]);

export function measured(c: Counts, r: Pick<Requirements, 'countSpaces' | 'countFootnotes'>): number {
  const body = r.countSpaces ? c.chars : c.charsNoSpaces;
  const notes = r.countSpaces ? c.notesChars : c.notesNoSpaces;
  return body + (r.countFootnotes ? notes : 0);
}
export function pages(c: Counts, r: Requirements): number {
  return measured(c, r) / Math.max(500, r.charsPerPage);
}

/* ---------- struttura argomentativa ---------- */

export interface RoleSegment { role: RoleKey | null; chars: number; index: number }
export interface RoleReport {
  total: number;
  byRole: Record<RoleKey | 'none', number>;
  segments: RoleSegment[];
  issues: { level: 'ok' | 'warn' | 'info'; text: string }[];
}

export function roleReport(bs: Block[], roles: RoleDef[], title = 'Il capitolo'): RoleReport {
  const byRole: Record<string, number> = { context: 0, problem: 0, argument: 0, conclusion: 0, none: 0 };
  const segments: RoleSegment[] = [];
  let total = 0;
  bs.forEach((b, i) => {
    if (b.kind === 'h') return;
    const len = b.text.length;
    if (!len) return;
    total += len;
    byRole[b.role || 'none'] += len;
    const last = segments[segments.length - 1];
    if (last && last.role === (b.role || null)) last.chars += len;
    else segments.push({ role: b.role || null, chars: len, index: i });
  });
  const issues: RoleReport['issues'] = [];
  const tagged = total - byRole.none;
  if (total < 400) return { total, byRole: byRole as RoleReport['byRole'], segments, issues };
  if (tagged / total < 0.5) {
    issues.push({ level: 'info', text: `Solo il ${Math.round((tagged / total) * 100)}% del testo ha un ruolo. Usa "Suggerisci struttura" o assegna i ruoli a mano.` });
  }
  const label = (k: RoleKey) => roles.find((r) => r.key === k)?.label || k;
  for (const r of roles) {
    if (!byRole[r.key]) {
      issues.push({ level: 'warn', text: `${title} non ha parti di tipo "${r.label}".` });
      continue;
    }
    if (tagged > 0) {
      const share = byRole[r.key] / tagged;
      if (share < r.min) issues.push({ level: 'info', text: `"${r.label}" occupa il ${Math.round(share * 100)}% (indicativo: almeno ${Math.round(r.min * 100)}%).` });
      if (share > r.max) issues.push({ level: 'warn', text: `"${r.label}" occupa il ${Math.round(share * 100)}% (indicativo: al massimo ${Math.round(r.max * 100)}%).` });
    }
  }
  // ordine: la prima conclusione non dovrebbe precedere il primo problema
  const first = (k: RoleKey) => segments.findIndex((s) => s.role === k);
  const fp = first('problem'), fc = first('conclusion'), fx = first('context'), fa = first('argument');
  if (fc >= 0 && fp >= 0 && fc < fp) issues.push({ level: 'warn', text: `Una "${label('conclusion')}" arriva prima del "${label('problem')}".` });
  if (fa >= 0 && fx >= 0 && fa < fx && fp >= 0 && fa < fp) issues.push({ level: 'info', text: `L'${label('argument').toLowerCase()} inizia prima di aver posto contesto e problema.` });
  const lastSeg = [...segments].reverse().find((s) => s.role);
  if (lastSeg && byRole.conclusion && lastSeg.role !== 'conclusion') issues.push({ level: 'info', text: `${title} non si chiude con una "${label('conclusion')}".` });
  if (!issues.some((i) => i.level === 'warn')) issues.unshift({ level: 'ok', text: 'Struttura equilibrata.' });
  return { total, byRole: byRole as RoleReport['byRole'], segments, issues };
}

/* Classificatore euristico (senza AI) per suggerire il ruolo di un paragrafo */
const CUES: Record<RoleKey, RegExp[]> = {
  context: [
    /\b(storicamente|nel corso del|a partire dal|negli anni|nel contesto|in questo quadro|il quadro|tradizionalmente|si definisce|per .{1,20} si intende|introdott[oa]|origin[ei]|nasce|nacque|dopoguerra|periodo|epoca|background|historically)\b/i,
    /\b(19|20)\d{2}\b/,
  ],
  problem: [
    /\?/,
    /\b(ci si chiede|la domanda|interrogativ|problema|problematic|questione|lacuna|non è chiaro|resta da|rimane aperto|tuttavia non|paradosso|tensione|in che misura|perché mai|il nodo|sfida)\w*/i,
  ],
  argument: [
    /\b(infatti|ad esempio|per esempio|secondo|come osserva|come sostiene|i dati|dimostra|evidenzia|mostra|analisi|confronto|al contrario|d'altra parte|inoltre|in primo luogo|in secondo luogo|si noti|cfr|ibid|op\. cit)\w*/i,
  ],
  conclusion: [
    /\b(in conclusione|concludendo|in sintesi|pertanto|dunque|ne consegue|ne deriva|si può affermare|possiamo concludere|in definitiva|alla luce di|riassumendo|in breve|emerge che|risulta che|in ultima analisi|to conclude|therefore)\b/i,
  ],
};

export function suggestRole(text: string, index: number, total: number, hasNotes: boolean): RoleKey | null {
  if (text.trim().length < 40) return null;
  const score: Record<RoleKey, number> = { context: 0, problem: 0, argument: 0, conclusion: 0 };
  (Object.keys(CUES) as RoleKey[]).forEach((k) => CUES[k].forEach((re) => { const m = text.match(new RegExp(re, re.flags.includes('g') ? re.flags : re.flags + 'g')); if (m) score[k] += Math.min(3, m.length); }));
  if (hasNotes) score.argument += 1;
  const pos = total > 1 ? index / (total - 1) : 0;
  if (pos < 0.2) score.context += 1;
  if (pos > 0.85) score.conclusion += 1.5;
  if (pos > 0.1 && pos < 0.85) score.argument += 0.75;
  const best = (Object.keys(score) as RoleKey[]).sort((a, b) => score[b] - score[a])[0];
  return score[best] >= 1.5 ? best : 'argument';
}

/* ---------- controlli di stile (algoritmici) ---------- */

export interface StyleIssue { level: 'warn' | 'info'; text: string; sample?: string }

export function styleCheck(bs: Block[], req: Requirements): StyleIssue[] {
  const out: StyleIssue[] = [];
  const body = bs.filter((b) => b.kind !== 'h').map((b) => b.text).join('\n');
  if (!body.trim()) return out;
  const sentences = sentencesOf(body);
  const long = sentences.filter((s) => wordCount(s) > req.maxSentenceWords);
  if (long.length) out.push({ level: 'warn', text: `${long.length} frasi superano ${req.maxSentenceWords} parole.`, sample: long[0].slice(0, 140) + '…' });
  const avg = sentences.reduce((a, s) => a + wordCount(s), 0) / Math.max(1, sentences.length);
  if (avg > 30) out.push({ level: 'info', text: `Lunghezza media delle frasi: ${avg.toFixed(0)} parole (consigliato sotto 30).` });
  const longP = bs.filter((b) => b.kind === 'p' && wordCount(b.text) > 250);
  if (longP.length) out.push({ level: 'info', text: `${longP.length} paragrafi superano 250 parole: valuta di dividerli.` });
  if (req.firstPerson === 'avoid') {
    const fp = body.match(/\b(io|mi sono|ho (deciso|scelto|voluto|cercato)|credo|penso|ritengo|a mio (avviso|parere))\b/gi);
    if (fp && fp.length) out.push({ level: 'info', text: `${fp.length} espressioni in prima persona singolare (es. "${fp[0]}").` });
  }
  const dbl = body.match(/ {2,}/g);
  if (dbl) out.push({ level: 'info', text: `${dbl.length} doppi spazi.` });
  const spacePunct = body.match(/\s[,.;:](?!\d)/g);
  if (spacePunct) out.push({ level: 'info', text: `${spacePunct.length} spazi prima della punteggiatura.` });
  const quotesMixed = /"/.test(body) && /[«“]/.test(body);
  if (quotesMixed) out.push({ level: 'info', text: 'Virgolette di tipo diverso (" e « » / “ ”): uniformale.' });
  const apos = /'/.test(body) && /’/.test(body);
  if (apos) out.push({ level: 'info', text: 'Apostrofi dritti e tipografici mescolati.' });
  const eAccent = body.match(/\bE'\s|\be'\s(?=[a-zà-ù])/g);
  if (eAccent) out.push({ level: 'warn', text: `${eAccent.length} "E'"/"e'" invece di "È"/"è".` });
  // ripetizioni ravvicinate
  const words = body.toLowerCase().match(/\p{L}{6,}/gu) || [];
  const reps = new Map<string, number>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (STOP.has(w)) continue;
    for (let j = i + 1; j < Math.min(words.length, i + 25); j++) if (words[j] === w) { reps.set(w, (reps.get(w) || 0) + 1); break; }
  }
  const top = [...reps.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length) out.push({ level: 'info', text: `Ripetizioni ravvicinate: ${top.map(([w, c]) => `${w} (${c})`).join(', ')}.` });
  // stile citazioni
  const inlineCites = body.match(/\([A-ZÀ-Ý][\p{L}'’-]+(?: et al\.)?,? (19|20)\d{2}[a-z]?(?:, p+\. ?\d+)?\)/gu) || [];
  const noteCount = bs.reduce((a, b) => a + b.notes.length, 0);
  if (req.citationStyle === 'chicago-note' && inlineCites.length > 3) out.push({ level: 'warn', text: `Stile note richiesto ma trovo ${inlineCites.length} citazioni (Autore, anno) nel testo.` });
  if (req.citationStyle !== 'chicago-note' && noteCount > 0 && inlineCites.length === 0 && noteCount > 10) out.push({ level: 'info', text: 'Stile autore-data richiesto ma le citazioni sembrano tutte in nota.' });
  return out;
}

/* ---------- parole chiave (RAKE semplificato) ---------- */

export const STOP = new Set(
  (
    'a ad al allo ai agli all agl alla alle con col coi da dal dallo dai dagli dall dagl dalla dalle di del dello dei degli dell degl della delle in nel nello nei negli nell negl nella nelle su sul sullo sui sugli sull sugl sulla sulle per tra fra il lo la i gli le un uno una e ed o od ma se che chi cui non più meno come anche quando dove mentre perché poiché però quindi dunque cioè ossia ovvero oppure sia questo questa questi queste quello quella quelli quelle ciò essere è sono era erano stato stata stati state sarà essere avere ha hanno aveva avevano avere fa fare può possono deve devono molto molti molte poco tutti tutte tutto ogni altro altri altra altre stesso stessa loro suo sua suoi sue nostro nostra proprio propria tale tali qui così già ancora sempre solo soltanto tra cui inoltre infatti tuttavia secondo verso circa senza sotto sopra dopo prima durante attraverso nonché' +
    ' the of and to in a is that for on with as by at from this be are was were it an or which have has had not but its their they these those such between into within also can more than other been being may would could should will about over after under there here our we his her he she them its upon both each new use using used based study paper article research analysis results case role through toward towards among however how what why when where while'
  ).split(/\s+/)
);

export function keywords(text: string, max = 12): string[] {
  const clean = text.replace(/\s+/g, ' ');
  const phrases: string[][] = [];
  let cur: string[] = [];
  for (const tok of clean.split(/([\s,.;:!?()"«»“”\[\]{}\/]|—|–)/)) {
    const t = tok.trim().toLowerCase();
    if (!t) continue;
    if (/^[,.;:!?()"«»“”\[\]{}\/—–]$/.test(t) || STOP.has(t) || /^\d+$/.test(t) || t.length < 3) {
      if (cur.length) phrases.push(cur);
      cur = [];
    } else cur.push(t.replace(/^['’]+|['’]+$/g, ''));
  }
  if (cur.length) phrases.push(cur);
  const freq = new Map<string, number>(), deg = new Map<string, number>();
  for (const p of phrases) for (const w of p) { freq.set(w, (freq.get(w) || 0) + 1); deg.set(w, (deg.get(w) || 0) + p.length); }
  const scores = new Map<string, number>();
  for (const p of phrases) {
    if (p.length > 4) continue;
    const k = p.join(' ');
    const s = p.reduce((a, w) => a + (deg.get(w)! / freq.get(w)!), 0) * Math.log(1 + p.reduce((a, w) => a + freq.get(w)!, 0));
    scores.set(k, Math.max(scores.get(k) || 0, s));
  }
  const counts = new Map<string, number>();
  for (const p of phrases) { const k = p.join(' '); counts.set(k, (counts.get(k) || 0) + 1); }
  return [...scores.entries()]
    .filter(([k]) => (counts.get(k) || 0) >= (text.length > 3000 ? 2 : 1))
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .filter((k, i, arr) => arr.findIndex((o) => o.includes(k) || k.includes(o)) === i)
    .slice(0, max);
}

/* ---------- requisiti ---------- */

export interface Check { label: string; ok: boolean | null; detail: string }

export function requirementChecks(
  chapters: Chapter[],
  totals: Counts,
  perChapter: Map<string, Counts>,
  req: Requirements,
  sourcesCited: number,
  sourcesTotal: number,
): Check[] {
  const out: Check[] = [];
  const pg = pages(totals, req);
  const m = measured(totals, req);
  if (req.minPages || req.maxPages) {
    const ok = (!req.minPages || pg >= req.minPages) && (!req.maxPages || pg <= req.maxPages);
    out.push({ label: 'Pagine', ok, detail: `${pg.toFixed(1)} su ${req.minPages || '–'}${req.maxPages ? '–' + req.maxPages : '+'} (${req.charsPerPage} battute a pagina)` });
  }
  if (req.minChars || req.maxChars) {
    const ok = (!req.minChars || m >= req.minChars) && (!req.maxChars || m <= req.maxChars);
    out.push({ label: 'Battute', ok, detail: `${m.toLocaleString('it-IT')} su ${req.minChars ? req.minChars.toLocaleString('it-IT') : '–'}${req.maxChars ? '–' + req.maxChars.toLocaleString('it-IT') : '+'}` });
  }
  const has = (k: Chapter['kind']) => chapters.some((c) => c.kind === k && (perChapter.get(c.id)?.chars || 0) > 200);
  if (req.requireAbstract) {
    const abs = chapters.find((c) => c.kind === 'abstract');
    const ac = abs ? perChapter.get(abs.id)?.chars || 0 : 0;
    out.push({ label: 'Abstract', ok: ac > 200 && (!req.abstractMaxChars || ac <= req.abstractMaxChars), detail: ac ? `${ac.toLocaleString('it-IT')} battute${req.abstractMaxChars ? ' (max ' + req.abstractMaxChars.toLocaleString('it-IT') + ')' : ''}` : 'da scrivere' });
  }
  if (req.requireIntro) out.push({ label: 'Introduzione', ok: has('intro'), detail: has('intro') ? 'presente' : 'da scrivere' });
  if (req.requireConclusion) out.push({ label: 'Conclusioni', ok: has('conclusion'), detail: has('conclusion') ? 'presenti' : 'da scrivere' });
  const nCh = chapters.filter((c) => c.kind === 'chapter' && (perChapter.get(c.id)?.chars || 0) > 1000).length;
  if (req.minChapters) out.push({ label: 'Capitoli sviluppati', ok: nCh >= req.minChapters, detail: `${nCh} su ${req.minChapters}` });
  if (req.minSources) out.push({ label: 'Fonti citate', ok: sourcesCited >= req.minSources, detail: `${sourcesCited} citate su ${req.minSources} richieste · ${sourcesTotal} in biblioteca` });
  if (req.requireBibliography) out.push({ label: 'Bibliografia', ok: sourcesCited > 0, detail: sourcesCited > 0 ? 'generata in esportazione dalle fonti citate' : 'nessuna fonte citata' });
  out.push({ label: 'Formato pagina', ok: true, detail: `${req.font} ${req.fontSize} pt, note ${req.noteFontSize} pt, interlinea ${req.lineSpacing}, margini ${req.marginCm} cm: applicati in esportazione DOCX` });
  if (req.deadline) {
    const days = Math.ceil((new Date(req.deadline).getTime() - Date.now()) / 86400000);
    out.push({ label: 'Scadenza', ok: days >= 0 ? null : false, detail: days >= 0 ? `${days} giorni (${new Date(req.deadline).toLocaleDateString('it-IT')})` : 'superata' });
  }
  return out;
}

/** Estrae requisiti da un testo di regolamento (algoritmo a regole, senza AI). */
export function parseRequirements(text: string): Partial<Requirements> & { found: string[] } {
  const t = text.replace(/\s+/g, ' ');
  const r: Partial<Requirements> & { found: string[] } = { found: [] };
  const num = (s: string) => parseInt(s.replace(/[.\s]/g, ''), 10);
  const range = t.match(/(?:tra|da|fra)\s+(\d{2,3})\s+(?:e|a)\s+(\d{2,3})\s+(pagine|cartelle)/i);
  if (range) { r.minPages = +range[1]; r.maxPages = +range[2]; r.found.push(range[0]); }
  else {
    const minP = t.match(/(?:almeno|minimo(?: di)?|non inferiore a|non meno di)\s+(\d{2,3})\s+(pagine|cartelle)/i);
    if (minP) { r.minPages = +minP[1]; r.found.push(minP[0]); }
    const maxP = t.match(/(?:massimo(?: di)?|non superiore a|non oltre|fino a)\s+(\d{2,3})\s+(pagine|cartelle)/i);
    if (maxP) { r.maxPages = +maxP[1]; r.found.push(maxP[0]); }
  }
  const cpp = t.match(/(\d[\d.]{2,5})\s+(?:battute|caratteri)[^.]{0,30}(?:per|a|ogni)\s+(?:pagina|cartella)/i) || t.match(/(?:pagina|cartella)[^.]{0,25}?(\d[\d.]{2,5})\s+(?:battute|caratteri)/i);
  if (cpp) { r.charsPerPage = num(cpp[1]); r.found.push(cpp[0]); }
  const chars = t.match(/(?:almeno|minimo(?: di)?|non inferiore a)\s+(\d[\d.]{4,8})\s+(?:battute|caratteri)/i);
  if (chars) { r.minChars = num(chars[1]); r.found.push(chars[0]); }
  const charsMax = t.match(/(?:massimo(?: di)?|non superiore a|non oltre)\s+(\d[\d.]{4,8})\s+(?:battute|caratteri)/i);
  if (charsMax) { r.maxChars = num(charsMax[1]); r.found.push(charsMax[0]); }
  if (/spazi\s+(?:esclusi|non inclusi)|senza\s+spazi/i.test(t)) { r.countSpaces = false; r.found.push('spazi esclusi'); }
  else if (/spazi\s+(?:inclusi|compresi)/i.test(t)) { r.countSpaces = true; r.found.push('spazi inclusi'); }
  if (/note\s+(?:escluse|non incluse)/i.test(t)) { r.countFootnotes = false; r.found.push('note escluse'); }
  else if (/note\s+(?:incluse|comprese)/i.test(t)) { r.countFootnotes = true; r.found.push('note incluse'); }
  const ls = t.match(/interlinea\s*(?:di\s*)?(\d(?:[.,]\d)?)/i);
  if (ls) { r.lineSpacing = parseFloat(ls[1].replace(',', '.')); r.found.push(ls[0]); }
  const fs = t.match(/(?:corpo|dimensione(?: del carattere)?|carattere)\s*(?:di\s*)?(\d{2})(?:\s*pt| punti)?/i) || t.match(/(\d{2})\s*(?:pt|punti)\b/i);
  if (fs) { r.fontSize = +fs[1]; r.found.push(fs[0]); }
  const font = t.match(/\b(Times New Roman|Garamond|Arial|Calibri|Palatino|Book Antiqua|Cambria|Georgia|Helvetica)\b/i);
  if (font) { r.font = font[1]; r.found.push(font[0]); }
  const mg = t.match(/margin[ei][^.]{0,40}?(\d(?:[.,]\d)?)\s*cm/i);
  if (mg) { r.marginCm = parseFloat(mg[1].replace(',', '.')); r.found.push(mg[0]); }
  const abs = t.match(/abstract[^.]{0,60}?(\d[\d.]{2,5})\s*(battute|caratteri|parole)/i);
  if (abs) { r.abstractMaxChars = abs[2].toLowerCase() === 'parole' ? num(abs[1]) * 6 : num(abs[1]); r.requireAbstract = true; r.found.push(abs[0]); }
  if (/\bAPA\b/.test(t)) { r.citationStyle = 'apa'; r.found.push('APA'); }
  else if (/chicago|note a pi[eè] di pagina/i.test(t)) { r.citationStyle = 'chicago-note'; r.found.push('note a piè di pagina'); }
  else if (/autore[- ]data|harvard/i.test(t)) { r.citationStyle = 'author-date-it'; r.found.push('autore-data'); }
  return r;
}
