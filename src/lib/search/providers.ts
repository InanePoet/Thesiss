import type { Settings, Source } from '../types';
import { cleanDoi, normTitle } from '../util';

export type Hit = Omit<Source, 'id' | 'status' | 'tags' | 'notes' | 'addedAt' | 'updatedAt'> & { key: string; sources: string[] };

export interface SearchOpts { query: string; yearFrom?: number; limit?: number; settings: Settings }

const timeout = (ms: number) => {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
};

async function getJson(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: timeout(20000) });
  if (r.status === 429) throw new Error('troppe richieste, riprova tra un minuto');
  if (!r.ok) throw new Error(`errore ${r.status}`);
  return r.json();
}
async function getText(url: string) {
  const r = await fetch(url, { signal: timeout(20000) });
  if (!r.ok) throw new Error(`errore ${r.status}`);
  return r.text();
}

export function hitKey(h: { doi?: string; title: string; year?: number }) {
  return h.doi ? 'doi:' + h.doi.toLowerCase() : 't:' + normTitle(h.title).slice(0, 80) + ':' + (h.year || '');
}

function mk(p: Partial<Hit> & { title: string; provider: string }): Hit {
  const doi = cleanDoi(p.doi);
  const h: Hit = {
    type: p.type || 'article', title: p.title.trim(), titleAlt: p.titleAlt, authors: p.authors || [], year: p.year,
    venue: p.venue, volume: p.volume, issue: p.issue, pages: p.pages, publisher: p.publisher, doi, url: p.url,
    oaUrl: p.oaUrl, abstract: p.abstract, keywords: p.keywords || [], lang: p.lang, provider: p.provider,
    providerId: p.providerId, citedBy: p.citedBy, key: '', sources: [p.provider],
  };
  h.key = hitKey(h);
  return h;
}

const stripTags = (s?: string) => s?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function invertedAbstract(idx?: Record<string, number[]> | null): string | undefined {
  if (!idx) return undefined;
  const words: string[] = [];
  for (const [w, pos] of Object.entries(idx)) for (const p of pos) words[p] = w;
  return words.join(' ');
}

const oaType = (t?: string): Hit['type'] =>
  t === 'book' ? 'book' : t === 'book-chapter' ? 'chapter' : t === 'dissertation' ? 'thesis' : t === 'report' ? 'report' : 'article';

/* ---------------- OpenAlex ---------------- */
async function openalex(o: SearchOpts): Promise<Hit[]> {
  const u = new URL('https://api.openalex.org/works');
  u.searchParams.set('search', o.query);
  u.searchParams.set('per-page', String(o.limit || 25));
  if (o.yearFrom) u.searchParams.set('filter', `from_publication_date:${o.yearFrom}-01-01`);
  if (o.settings.mailto) u.searchParams.set('mailto', o.settings.mailto);
  const d = await getJson(u.toString());
  return (d.results || []).filter((w: any) => w.title).map((w: any) =>
    mk({
      provider: 'openalex', providerId: w.id, title: w.title, year: w.publication_year,
      authors: (w.authorships || []).map((a: any) => a.author?.display_name || a.raw_author_name).filter(Boolean),
      venue: w.primary_location?.source?.display_name, doi: w.doi, type: oaType(w.type),
      url: w.primary_location?.landing_page_url || w.doi || w.id,
      oaUrl: w.best_oa_location?.pdf_url || w.open_access?.oa_url || undefined,
      volume: w.biblio?.volume, issue: w.biblio?.issue,
      pages: w.biblio?.first_page ? `${w.biblio.first_page}${w.biblio.last_page ? '-' + w.biblio.last_page : ''}` : undefined,
      abstract: invertedAbstract(w.abstract_inverted_index), lang: w.language,
      keywords: [...(w.keywords || []).map((k: any) => k.display_name), ...(w.topics || []).slice(0, 2).map((t: any) => t.display_name)],
      citedBy: w.cited_by_count,
    })
  );
}

/* ---------------- Crossref ---------------- */
async function crossref(o: SearchOpts): Promise<Hit[]> {
  const u = new URL('https://api.crossref.org/works');
  u.searchParams.set('query.bibliographic', o.query);
  u.searchParams.set('rows', String(o.limit || 25));
  u.searchParams.set('select', 'DOI,title,subtitle,author,editor,issued,container-title,type,volume,issue,page,publisher,publisher-location,abstract,URL,subject,is-referenced-by-count,language');
  if (o.yearFrom) u.searchParams.set('filter', `from-pub-date:${o.yearFrom}`);
  if (o.settings.mailto) u.searchParams.set('mailto', o.settings.mailto);
  const d = await getJson(u.toString());
  const ty = (t: string): Hit['type'] => (t.startsWith('book-chapter') || t === 'book-section' ? 'chapter' : t.startsWith('book') || t === 'monograph' || t === 'edited-book' ? 'book' : t === 'dissertation' ? 'thesis' : t === 'report' ? 'report' : 'article');
  return (d.message?.items || []).filter((w: any) => w.title?.[0]).map((w: any) =>
    mk({
      provider: 'crossref', providerId: w.DOI, doi: w.DOI,
      title: w.title[0] + (w.subtitle?.[0] ? ': ' + w.subtitle[0] : ''),
      authors: (w.author || []).map((a: any) => [a.given, a.family].filter(Boolean).join(' ') || a.name).filter(Boolean),
      year: w.issued?.['date-parts']?.[0]?.[0] || undefined, venue: w['container-title']?.[0], type: ty(w.type || ''),
      volume: w.volume, issue: w.issue, pages: w.page, publisher: w.publisher, url: w.URL,
      abstract: stripTags(w.abstract), keywords: w.subject || [], citedBy: w['is-referenced-by-count'], lang: w.language,
    })
  );
}

/* ---------------- Semantic Scholar ---------------- */
async function s2(o: SearchOpts): Promise<Hit[]> {
  const u = new URL('https://api.semanticscholar.org/graph/v1/paper/search');
  u.searchParams.set('query', o.query);
  u.searchParams.set('limit', String(Math.min(o.limit || 20, 50)));
  u.searchParams.set('fields', 'title,authors,year,venue,abstract,externalIds,url,openAccessPdf,citationCount,publicationTypes');
  if (o.yearFrom) u.searchParams.set('year', `${o.yearFrom}-`);
  const d = await getJson(u.toString(), o.settings.s2Key ? { 'x-api-key': o.settings.s2Key } : {});
  return (d.data || []).filter((w: any) => w.title).map((w: any) =>
    mk({
      provider: 's2', providerId: w.paperId, title: w.title, year: w.year || undefined,
      authors: (w.authors || []).map((a: any) => a.name), venue: w.venue || undefined, doi: w.externalIds?.DOI,
      url: w.url, oaUrl: w.openAccessPdf?.url || undefined, abstract: w.abstract || undefined, citedBy: w.citationCount,
      type: (w.publicationTypes || []).includes('Book') ? 'book' : 'article',
    })
  );
}

/* ---------------- J-STAGE ---------------- */
async function jstage(o: SearchOpts): Promise<Hit[]> {
  const u = new URL('https://api.jstage.jst.go.jp/searchapi/do');
  u.searchParams.set('service', '3');
  u.searchParams.set('keyword', o.query);
  u.searchParams.set('count', String(o.limit || 25));
  if (o.yearFrom) u.searchParams.set('pubyearfrom', String(o.yearFrom));
  const xml = new DOMParser().parseFromString(await getText(u.toString()), 'application/xml');
  const txt = (el: Element | null | undefined, sel: string) => el?.querySelector(sel)?.textContent?.trim() || undefined;
  const byTag = (el: Element, tag: string) => el.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined;
  return Array.from(xml.getElementsByTagName('entry')).map((e) => {
    const ja = txt(e, 'article_title > ja');
    const en = txt(e, 'article_title > en');
    const authJa = Array.from(e.querySelectorAll('author > ja > name')).map((n) => n.textContent!.trim());
    const authEn = Array.from(e.querySelectorAll('author > en > name')).map((n) => n.textContent!.trim().replace(/\s+/g, ' '));
    const sp = byTag(e, 'prism:startingPage'), ep = byTag(e, 'prism:endingPage');
    return mk({
      provider: 'jstage', providerId: byTag(e, 'id'), title: ja || en || '(senza titolo)', titleAlt: ja && en ? en : undefined,
      authors: authJa.length ? authJa : authEn, year: Number(byTag(e, 'pubyear')) || undefined,
      venue: txt(e, 'material_title > ja') || txt(e, 'material_title > en'),
      volume: byTag(e, 'prism:volume'), issue: byTag(e, 'prism:number'), pages: sp ? `${sp}${ep ? '-' + ep : ''}` : undefined,
      doi: byTag(e, 'prism:doi'), url: txt(e, 'article_link > ja') || txt(e, 'article_link > en'), lang: ja ? 'ja' : 'en',
    });
  });
}

/* ---------------- CiNii Research ---------------- */
async function cinii(o: SearchOpts): Promise<Hit[]> {
  const u = new URL('https://cir.nii.ac.jp/opensearch/all');
  u.searchParams.set('q', o.query);
  u.searchParams.set('count', String(o.limit || 25));
  u.searchParams.set('format', 'json');
  if (o.yearFrom) u.searchParams.set('from', String(o.yearFrom));
  const d = await getJson(u.toString());
  const ty = (t?: string): Hit['type'] => (t === 'Book' ? 'book' : t === 'Dissertation' ? 'thesis' : t === 'Article' ? 'article' : t === 'Report' || t === 'Research Report' ? 'report' : 'other');
  return (d.items || []).filter((w: any) => w.title).map((w: any) => {
    const ids: any[] = Array.isArray(w['dc:identifier']) ? w['dc:identifier'] : w['dc:identifier'] ? [w['dc:identifier']] : [];
    const doi = ids.find((i) => /DOI/i.test(i['@type'] || ''))?.['@value'];
    const sp = w['prism:startingPage'], ep = w['prism:endingPage'];
    const creators = Array.isArray(w['dc:creator']) ? w['dc:creator'] : w['dc:creator'] ? [w['dc:creator']] : [];
    return mk({
      provider: 'cinii', providerId: w['@id'], title: w.title, authors: creators.map((c: any) => (typeof c === 'string' ? c : c['@value'] || '')).filter(Boolean),
      year: parseInt(String(w['prism:publicationDate'] || ''), 10) || undefined, venue: w['prism:publicationName'],
      publisher: typeof w['dc:publisher'] === 'string' ? w['dc:publisher'] : undefined, volume: w['prism:volume'], issue: w['prism:number'],
      pages: sp ? `${sp}${ep ? '-' + ep : ''}` : undefined, doi, url: w.link?.['@id'] || w['@id'], type: ty(w['dc:type']),
      abstract: typeof w.description === 'string' ? w.description : undefined, lang: 'ja',
    });
  });
}

export const PROVIDER_FN: Record<string, (o: SearchOpts) => Promise<Hit[]>> = { openalex, crossref, s2, jstage, cinii };

export interface SearchResult { hits: Hit[]; errors: Record<string, string>; perProvider: Record<string, number> }

/** Interroga i servizi in parallelo, unisce i doppioni (DOI o titolo+anno) e ordina per pertinenza semplice. */
export async function searchAll(o: SearchOpts, providers: string[]): Promise<SearchResult> {
  const errors: Record<string, string> = {};
  const perProvider: Record<string, number> = {};
  const lists = await Promise.all(
    providers.map(async (p) => {
      try {
        const r = await PROVIDER_FN[p](o);
        perProvider[p] = r.length;
        return r;
      } catch (e) {
        errors[p] = (e as Error).name === 'AbortError' ? 'tempo scaduto' : (e as Error).message || 'errore di rete';
        perProvider[p] = 0;
        return [];
      }
    })
  );
  const merged = new Map<string, Hit>();
  const rank = new Map<string, number>();
  lists.forEach((list) =>
    list.forEach((h, i) => {
      const prev = merged.get(h.key);
      rank.set(h.key, (rank.get(h.key) || 0) + 1 / (i + 3));
      if (!prev) { merged.set(h.key, h); return; }
      for (const k of Object.keys(h) as (keyof Hit)[]) {
        if ((prev[k] === undefined || prev[k] === '' || (Array.isArray(prev[k]) && !(prev[k] as unknown[]).length)) && h[k] !== undefined) (prev as any)[k] = h[k];
      }
      prev.sources = [...new Set([...prev.sources, ...h.sources])];
      if (!prev.abstract || (h.abstract && h.abstract.length > prev.abstract.length)) prev.abstract = h.abstract || prev.abstract;
      prev.keywords = [...new Set([...prev.keywords, ...h.keywords])].slice(0, 15);
    })
  );
  const qTerms = normTitle(o.query).split(' ').filter((t) => t.length > 2);
  const score = (h: Hit) => {
    const t = normTitle(h.title + ' ' + (h.titleAlt || ''));
    const textHits = qTerms.filter((q) => t.includes(q)).length / Math.max(1, qTerms.length);
    const cjkHit = /[぀-鿿]/.test(o.query) && h.title.includes(o.query) ? 1 : 0;
    return (rank.get(h.key) || 0) * 2 + textHits + cjkHit + Math.log10(1 + (h.citedBy || 0)) * 0.15;
  };
  const hits = [...merged.values()].sort((a, b) => score(b) - score(a));
  return { hits, errors, perProvider };
}

/* ---------------- collegamenti esterni (anche con login) ---------------- */

export function externalLinks(q: string, s: Settings, src?: Partial<Source>) {
  const e = encodeURIComponent;
  const title = src?.title || q;
  const proxied = (url: string) => (s.libraryProxy ? s.libraryProxy + e(url) : '');
  const links: { label: string; url: string; note?: string }[] = [];
  if (src?.doi) {
    links.push({ label: 'Pagina dell’editore (DOI)', url: `https://doi.org/${src.doi}` });
    if (s.libraryProxy) links.push({ label: 'Tramite la biblioteca', url: proxied(`https://doi.org/${src.doi}`), note: 'accesso con le tue credenziali' });
  } else if (src?.url) {
    links.push({ label: 'Pagina della fonte', url: src.url });
    if (s.libraryProxy) links.push({ label: 'Tramite la biblioteca', url: proxied(src.url) });
  }
  if (src?.oaUrl) links.push({ label: 'PDF ad accesso aperto', url: src.oaUrl });
  links.push({ label: 'Google Scholar', url: `https://scholar.google.com/scholar?q=${e(title)}` });
  links.push({ label: 'JSTOR', url: `https://www.jstor.org/action/doBasicSearch?Query=${e(title)}` });
  links.push({ label: 'NDL Search', url: `https://ndlsearch.ndl.go.jp/search?cs=bib&keyword=${e(title)}` });
  links.push({ label: 'Google Books', url: `https://www.google.com/search?tbm=bks&q=${e(title)}` });
  if (s.catalogUrl) links.push({ label: 'Catalogo della biblioteca', url: s.catalogUrl.replace('{q}', e(title)) });
  return links.filter((l) => l.url);
}
