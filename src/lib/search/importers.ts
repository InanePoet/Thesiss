import type { Hit } from './providers';
import { hitKey } from './providers';
import { cleanDoi } from '../util';

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+[^\s"<>.,;)\]])/i;

function base(p: Partial<Hit> & { title: string; provider: string }): Hit {
  const h: Hit = { type: 'article', authors: [], keywords: [], sources: [p.provider], key: '', ...p, doi: cleanDoi(p.doi) };
  h.key = hitKey(h);
  return h;
}

export async function byDoi(doi: string, mailto = ''): Promise<Hit | null> {
  const d = cleanDoi(doi)!;
  try {
    const r = await fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(d)}${mailto ? '?mailto=' + encodeURIComponent(mailto) : ''}`);
    if (r.ok) {
      const w = await r.json();
      const idx = w.abstract_inverted_index as Record<string, number[]> | null;
      let abstract: string | undefined;
      if (idx) { const a: string[] = []; for (const [k, v] of Object.entries(idx)) for (const p of v) a[p] = k; abstract = a.join(' '); }
      return base({
        provider: 'openalex', providerId: w.id, title: w.title, year: w.publication_year, doi: d,
        authors: (w.authorships || []).map((a: any) => a.author?.display_name).filter(Boolean),
        venue: w.primary_location?.source?.display_name, url: w.primary_location?.landing_page_url || `https://doi.org/${d}`,
        oaUrl: w.best_oa_location?.pdf_url || w.open_access?.oa_url || undefined, abstract,
        keywords: (w.keywords || []).map((k: any) => k.display_name), volume: w.biblio?.volume, issue: w.biblio?.issue,
        pages: w.biblio?.first_page ? `${w.biblio.first_page}-${w.biblio.last_page || ''}` : undefined,
        type: w.type === 'book' ? 'book' : w.type === 'book-chapter' ? 'chapter' : 'article',
      });
    }
  } catch { /* prova Crossref */ }
  try {
    const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(d)}`);
    if (!r.ok) return null;
    const w = (await r.json()).message;
    return base({
      provider: 'crossref', providerId: d, doi: d, title: w.title?.[0] || d,
      authors: (w.author || []).map((a: any) => [a.given, a.family].filter(Boolean).join(' ')),
      year: w.issued?.['date-parts']?.[0]?.[0], venue: w['container-title']?.[0], publisher: w.publisher,
      volume: w.volume, issue: w.issue, pages: w.page, url: w.URL, abstract: w.abstract?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      type: (w.type || '').startsWith('book') ? (w.type === 'book-chapter' ? 'chapter' : 'book') : 'article',
    });
  } catch { return null; }
}

/** Legge una pagina web e usa i meta tag accademici (Highwire/Dublin Core/OpenGraph). */
export async function byUrl(url: string, mailto = ''): Promise<{ hit: Hit | null; message?: string }> {
  const doiInUrl = url.match(DOI_RE);
  if (doiInUrl && /doi\.org|\/doi\//i.test(url)) {
    const h = await byDoi(doiInUrl[1], mailto);
    if (h) return { hit: { ...h, url } };
  }
  let html = '';
  try {
    const r = await fetch(url, { headers: { Accept: 'text/html' } });
    html = await r.text();
  } catch (e) {
    return { hit: null, message: 'Non riesco ad aprire la pagina (nel browser i siti bloccano spesso l’accesso; nell’app Android funziona meglio).' };
  }
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const metas = (name: string) => Array.from(dom.querySelectorAll(`meta[name="${name}" i], meta[property="${name}" i]`)).map((m) => m.getAttribute('content') || '').filter(Boolean);
  const one = (...names: string[]) => names.map((n) => metas(n)[0]).find(Boolean);
  const doi = one('citation_doi', 'dc.identifier', 'DC.Identifier', 'prism.doi')?.match(DOI_RE)?.[1] || html.match(DOI_RE)?.[1];
  if (doi && !one('citation_title')) {
    const h = await byDoi(doi, mailto);
    if (h) return { hit: { ...h, url } };
  }
  const title = one('citation_title', 'dc.title', 'DC.title', 'og:title') || dom.title;
  if (!title) return { hit: null, message: 'La pagina non contiene metadati riconoscibili.' };
  const date = one('citation_publication_date', 'citation_date', 'dc.date', 'article:published_time', 'citation_online_date');
  const authors = metas('citation_author').length ? metas('citation_author') : metas('dc.creator').length ? metas('dc.creator') : metas('author');
  return {
    hit: base({
      provider: 'web', providerId: url, url, title: title.trim(), doi,
      authors: authors.map((a) => (a.includes(',') ? a.split(',').reverse().join(' ').trim() : a)),
      year: date ? parseInt(date.slice(0, 4), 10) || undefined : undefined,
      venue: one('citation_journal_title', 'citation_conference_title', 'citation_book_title', 'og:site_name'),
      publisher: one('citation_publisher', 'dc.publisher'), volume: one('citation_volume'), issue: one('citation_issue'),
      pages: [one('citation_firstpage'), one('citation_lastpage')].filter(Boolean).join('-') || undefined,
      oaUrl: one('citation_pdf_url'), abstract: one('citation_abstract', 'dc.description', 'description', 'og:description'),
      keywords: (one('citation_keywords', 'keywords') || '').split(/[;,]/).map((k) => k.trim()).filter(Boolean).slice(0, 10),
      type: one('citation_journal_title') ? 'article' : one('citation_book_title') ? 'chapter' : 'web',
      lang: one('citation_language', 'dc.language') || dom.documentElement.lang || undefined,
    }),
  };
}

export async function fromInput(input: string, mailto = ''): Promise<{ hit: Hit | null; message?: string }> {
  const t = input.trim();
  if (/^https?:\/\//i.test(t)) return byUrl(t, mailto);
  const m = t.match(DOI_RE);
  if (m) { const h = await byDoi(m[1], mailto); return h ? { hit: h } : { hit: null, message: 'DOI non trovato.' }; }
  return { hit: null, message: 'Incolla un link (https://…) o un DOI (10.xxxx/…).' };
}

/* ---------------- PDF ---------------- */

export async function readPdf(buf: ArrayBuffer): Promise<{ text: string; pages: number; title?: string; doi?: string }> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const parts: string[] = [];
  let title: string | undefined;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let line = '';
    let lastY: number | null = null;
    const items = tc.items as { str: string; transform: number[]; height: number; hasEOL?: boolean }[];
    if (i === 1) {
      // titolo: il testo più grande nella prima pagina
      const big = [...items].filter((x) => x.str.trim().length > 3).sort((a, b) => b.height - a.height);
      if (big.length) {
        const h = big[0].height;
        title = items.filter((x) => Math.abs(x.height - h) < 0.5).map((x) => x.str).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      }
    }
    for (const it of items) {
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) { parts.push(line); line = ''; }
      line += it.str;
      lastY = y;
    }
    parts.push(line, '\n');
  }
  const meta = await doc.getMetadata().catch(() => null);
  const metaTitle = (meta?.info as { Title?: string } | undefined)?.Title;
  // ricompone le parole spezzate a fine riga
  const text = parts.join('\n').replace(/(\p{L})-\n(\p{L})/gu, '$1$2').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  const doi = text.slice(0, 8000).match(DOI_RE)?.[1];
  return { text, pages: doc.numPages, title: metaTitle && metaTitle.length > 8 ? metaTitle : title, doi };
}
