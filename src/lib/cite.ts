import type { Requirements, Source } from './types';

const CJK = /[぀-ヿ㐀-鿿가-힯]/;

export function splitName(a: string): { last: string; first: string } {
  const s = a.trim();
  if (s.includes(',')) { const [l, f] = s.split(',', 2); return { last: l.trim(), first: (f || '').trim() }; }
  if (CJK.test(s)) { const p = s.split(/\s+/); return { last: p[0], first: p.slice(1).join('') }; }
  const p = s.split(/\s+/);
  if (p.length === 1) return { last: s, first: '' };
  // particelle (de, van, von, di, da, la)
  let i = p.length - 1;
  while (i > 1 && /^(de|di|da|del|della|van|von|der|la|le|du)$/i.test(p[i - 1])) i--;
  return { last: p.slice(i).join(' '), first: p.slice(0, i).join(' ') };
}

const initials = (f: string) => f.split(/[\s-]+/).filter(Boolean).map((x) => x[0].toUpperCase() + '.').join(' ');

function fullName(a: string) {
  const { last, first } = splitName(a);
  if (CJK.test(a)) return a.replace(/\s+/g, ' ');
  return first ? `${first} ${last}` : last;
}
function invName(a: string) {
  const { last, first } = splitName(a);
  if (CJK.test(a)) return a.replace(/\s+/g, ' ');
  return first ? `${last}, ${first}` : last;
}

function authorsNote(s: Source): string {
  const a = s.authors;
  if (!a.length) return '';
  if (a.length === 1) return fullName(a[0]);
  if (a.length === 2) return `${fullName(a[0])} e ${fullName(a[1])}`;
  if (a.length === 3) return `${fullName(a[0])}, ${fullName(a[1])} e ${fullName(a[2])}`;
  return `${fullName(a[0])} et al.`;
}
function authorsBib(s: Source): string {
  const a = s.authors;
  if (!a.length) return '';
  if (a.length === 1) return invName(a[0]);
  const rest = a.slice(1, 6).map(fullName);
  return `${invName(a[0])}, ${rest.slice(0, -1).join(', ')}${rest.length > 1 ? ',' : ''} e ${rest[rest.length - 1]}${a.length > 6 ? ' et al.' : ''}`.replace(', ,', ',');
}
export function shortAuthors(s: Source): string {
  const a = s.authors;
  if (!a.length) return s.title.split(/[:.]/)[0];
  const l = (x: string) => splitName(x).last;
  if (a.length === 1) return l(a[0]);
  if (a.length === 2) return `${l(a[0])} e ${l(a[1])}`;
  return `${l(a[0])} et al.`;
}
const shortTitle = (t: string) => {
  const main = t.split(/[:.?]/)[0].trim();
  const w = main.split(/\s+/);
  return w.length > 5 ? w.slice(0, 4).join(' ') : main;
};
const isBookish = (s: Source) => s.type === 'book' || s.type === 'thesis' || s.type === 'report';
const ital = (t: string) => `*${t}*`;
const loc = (l?: string) => (l ? (/^\d/.test(l) ? (/[-–,]/.test(l) ? `pp. ${l}` : `p. ${l}`) : l) : '');

/** Nota a piè di pagina stile Chicago (italiano). Testo con *corsivo* marcato da asterischi. */
export function chicagoNote(s: Source, locator?: string, short = false): string {
  const L = loc(locator);
  if (short) return [`${shortAuthors(s)}, ${isBookish(s) ? ital(shortTitle(s.title)) : `“${shortTitle(s.title)}”`}`, L].filter(Boolean).join(', ') + '.';
  const au = authorsNote(s);
  let core: string;
  if (isBookish(s)) {
    const pub = [s.place, s.publisher].filter(Boolean).join(', ');
    core = `${ital(s.title)} (${[pub, s.year].filter(Boolean).join(', ') || 's.d.'})`;
  } else if (s.type === 'chapter') {
    core = `“${s.title}”, in ${ital(s.venue || '')}${s.publisher ? ` (${s.publisher}, ${s.year || 's.d.'})` : s.year ? ` (${s.year})` : ''}`;
  } else if (s.type === 'web') {
    core = `“${s.title}”${s.venue ? ', ' + s.venue : ''}${s.year ? ', ' + s.year : ''}`;
  } else {
    core = `“${s.title}”, ${ital(s.venue || 's.n.')}${s.volume ? ' ' + s.volume : ''}${s.issue ? ', n. ' + s.issue : ''}${s.year ? ` (${s.year})` : ''}`;
  }
  const tail = [L, s.doi ? `https://doi.org/${s.doi}` : s.type === 'web' && s.url ? s.url : ''].filter(Boolean).join(', ');
  return `${au ? au + ', ' : ''}${core}${tail ? ', ' + tail : ''}.`;
}

export function bibEntry(s: Source, style: Requirements['citationStyle']): string {
  return bibEntryRaw(s, style).replace(/\.\.(?=\s|$)/g, '.').replace(/\s+\./g, '.');
}
function bibEntryRaw(s: Source, style: Requirements['citationStyle']): string {
  const au = authorsBib(s) || 'Anonimo';
  const y = s.year ? String(s.year) : 's.d.';
  const doi = s.doi ? ` https://doi.org/${s.doi}` : s.type === 'web' && s.url ? ` ${s.url}` : '';
  if (style === 'apa') {
    const auA = s.authors.length ? s.authors.slice(0, 20).map((a) => { const { last, first } = splitName(a); return CJK.test(a) ? a : `${last}, ${initials(first)}`.replace(/, $/, ''); }).join(', ').replace(/, ([^,]+)$/, ', & $1') : 'Anonimo';
    if (isBookish(s)) return `${auA} (${y}). ${ital(s.title)}. ${s.publisher || ''}.${doi}`.replace(/ \./g, '.');
    return `${auA} (${y}). ${s.title}. ${ital(s.venue || '')}${s.volume ? ', ' + ital(s.volume) : ''}${s.issue ? `(${s.issue})` : ''}${s.pages ? ', ' + s.pages : ''}.${doi}`;
  }
  if (style === 'author-date-it') {
    if (isBookish(s)) return `${au} (${y}), ${ital(s.title)}, ${[s.publisher, s.place].filter(Boolean).join(', ')}.${doi}`;
    return `${au} (${y}), “${s.title}”, ${ital(s.venue || '')}${s.volume ? ', ' + s.volume : ''}${s.issue ? ', n. ' + s.issue : ''}${s.pages ? ', pp. ' + s.pages : ''}.${doi}`;
  }
  // chicago bibliografia
  if (isBookish(s)) return `${au}. ${ital(s.title)}. ${[s.place, s.publisher].filter(Boolean).join(': ')}${s.place || s.publisher ? ', ' : ''}${y}.${doi}`;
  return `${au}. “${s.title}”. ${ital(s.venue || '')}${s.volume ? ' ' + s.volume : ''}${s.issue ? ', n. ' + s.issue : ''} (${y})${s.pages ? ': ' + s.pages : ''}.${doi}`;
}

export function inlineCite(s: Source | undefined, locator: string | undefined, style: Requirements['citationStyle']): string {
  if (!s) return '(fonte mancante)';
  const y = s.year || 's.d.';
  const l = locator ? (style === 'apa' ? `, ${loc(locator)}` : `: ${locator}`) : '';
  if (style === 'apa') return `(${shortAuthors(s).replace(' e ', ' & ')}, ${y}${l})`;
  return `(${shortAuthors(s)} ${y}${l})`;
}

export const plain = (s: string) => s.replace(/\*/g, '');

export function sortKey(s: Source) {
  return (splitName(s.authors[0] || s.title).last + ' ' + (s.year || '')).toLowerCase();
}
