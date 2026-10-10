import type { JSONContent } from '@tiptap/core';
import { generateJSON } from '@tiptap/core';
import {
  AlignmentType, Document, Footer, FootnoteReferenceRun, HeadingLevel, Packer, PageNumber, Paragraph, TableOfContents, TextRun,
} from 'docx';
import { bibEntry, plain, sortKey } from './cite';
import { citedSourceIds, makeCiteResolver, makeNoteResolver } from './resolve';
import type { Chapter, Requirements, Source } from './types';
import type { ThesisMeta } from './store';
import { buildExtensions } from '../editor/extensions';
import { uid } from './util';

/* ---------------- DOCX ---------------- */

function runsFromStarred(text: string, size?: number): TextRun[] {
  // *corsivo* prodotto dai formattatori delle citazioni
  return text.split(/(\*[^*]+\*)/).filter(Boolean).map((t) =>
    t.startsWith('*') && t.endsWith('*') ? new TextRun({ text: t.slice(1, -1), italics: true, size }) : new TextRun({ text: t, size })
  );
}

export async function exportDocx(chapters: Chapter[], sources: Source[], req: Requirements, meta: ThesisMeta): Promise<Blob> {
  const smap = new Map(sources.map((s) => [s.id, s]));
  const noteText = makeNoteResolver(smap, req);
  const citeText = makeCiteResolver(smap, req);
  const footnotes: Record<number, { children: Paragraph[] }> = {};
  let fnId = 0;
  const half = (pt: number) => Math.round(pt * 2);
  const noteSize = half(req.noteFontSize);

  const inlineRuns = (nodes: JSONContent[] | undefined): (TextRun | FootnoteReferenceRun)[] => {
    const out: (TextRun | FootnoteReferenceRun)[] = [];
    for (const n of nodes || []) {
      if (n.type === 'text') {
        const marks = new Set((n.marks || []).map((m) => m.type));
        out.push(new TextRun({ text: n.text || '', bold: marks.has('bold'), italics: marks.has('italic'), underline: marks.has('underline') ? {} : undefined, strike: marks.has('strike') }));
      } else if (n.type === 'hardBreak') out.push(new TextRun({ text: '', break: 1 }));
      else if (n.type === 'footnote') {
        fnId++;
        footnotes[fnId] = { children: [new Paragraph({ children: runsFromStarred(noteText(n.attrs || {}) || ' ', noteSize) })] };
        out.push(new FootnoteReferenceRun(fnId));
      } else if (n.type === 'cite') out.push(new TextRun({ text: citeText(n.attrs || {}) }));
    }
    return out;
  };

  const body: Paragraph[] = [];
  const blockToDocx = (n: JSONContent, ctx: { list?: 'bullet' | 'ordered'; level: number; quote?: boolean }) => {
    switch (n.type) {
      case 'paragraph':
        body.push(new Paragraph({
          children: inlineRuns(n.content),
          alignment: AlignmentType.JUSTIFIED,
          indent: ctx.quote ? { left: 720, right: 360 } : undefined,
          bullet: ctx.list === 'bullet' ? { level: ctx.level } : undefined,
          numbering: ctx.list === 'ordered' ? { reference: 'num', level: ctx.level } : undefined,
          ...(ctx.quote ? { run: { size: half(req.fontSize - 1) } } : {}),
        }));
        break;
      case 'heading': {
        const lv = n.attrs?.level as number;
        body.push(new Paragraph({ children: inlineRuns(n.content), heading: lv <= 2 ? HeadingLevel.HEADING_2 : lv === 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4 }));
        break;
      }
      case 'bulletList':
      case 'orderedList':
        n.content?.forEach((li) => li.content?.forEach((c) => blockToDocx(c, { ...ctx, list: n.type === 'bulletList' ? 'bullet' : 'ordered', level: Math.min(ctx.level + (ctx.list ? 1 : 0), 4) })));
        break;
      case 'blockquote':
        n.content?.forEach((c) => blockToDocx(c, { ...ctx, quote: true }));
        break;
      case 'horizontalRule':
        body.push(new Paragraph({ children: [new TextRun('* * *')], alignment: AlignmentType.CENTER }));
        break;
      default:
        n.content?.forEach((c) => blockToDocx(c, ctx));
    }
  };

  // frontespizio
  const front: Paragraph[] = [];
  if (meta.title || meta.university) {
    const c = (text: string, opts: Partial<{ size: number; bold: boolean; before: number; italics: boolean }> = {}) =>
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: opts.before || 0 }, children: [new TextRun({ text, size: opts.size ? half(opts.size) : undefined, bold: opts.bold, italics: opts.italics })] });
    if (meta.university) front.push(c(meta.university.toUpperCase(), { size: 16, bold: true }));
    if (meta.department) front.push(c(meta.department, { size: 13, before: 120 }));
    if (meta.course) front.push(c(meta.course, { size: 13, before: 120, italics: true }));
    front.push(c('Tesi di laurea magistrale', { size: 13, before: 1600 }));
    if (meta.title) front.push(c(meta.title, { size: 20, bold: true, before: 400 }));
    if (meta.subtitle) front.push(c(meta.subtitle, { size: 14, italics: true, before: 120 }));
    const two = (l: string, r: string) => new Paragraph({ spacing: { before: 1400 }, children: [new TextRun({ text: l }), new TextRun({ text: '\t' + r })], tabStops: [{ type: 'right' as never, position: 9000 }] });
    front.push(two(meta.supervisor ? `Relatore\n${meta.supervisor}` : '', meta.author ? `Candidato/a: ${meta.author}` : ''));
    if (meta.cosupervisor) front.push(new Paragraph({ children: [new TextRun(`Correlatore: ${meta.cosupervisor}`)] }));
    if (meta.year) front.push(c(`Anno accademico ${meta.year}`, { before: 1400 }));
  }

  const ordered = [...chapters].sort((a, b) => a.order - b.order).filter((c) => c.kind !== 'bibliography');
  let numbered = 0;
  for (const ch of ordered) {
    const title = ch.kind === 'chapter' && !/^cap/i.test(ch.title) ? `${++numbered}. ${ch.title}` : ch.title;
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun(title)] }));
    blockToDocx(ch.content, { level: 0 });
  }

  // bibliografia
  const cited = citedSourceIds(ordered);
  const bib = sources.filter((s) => cited.has(s.id)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  if (bib.length) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun('Bibliografia')] }));
    for (const s of bib) body.push(new Paragraph({ children: runsFromStarred(bibEntry(s, req.citationStyle)), indent: { left: 567, hanging: 567 }, spacing: { after: 120 } }));
  }

  const lineSpacing = Math.round(240 * req.lineSpacing);
  const margin = Math.round(567 * req.marginCm);
  const doc = new Document({
    creator: meta.author || 'Thesiss',
    title: meta.title || 'Tesi',
    features: { updateFields: true },
    styles: {
      default: {
        document: { run: { font: req.font, size: half(req.fontSize) }, paragraph: { spacing: { line: lineSpacing, after: 120 } } },
        heading1: { run: { font: req.font, size: half(req.fontSize + 4), bold: true }, paragraph: { spacing: { before: 240, after: 360 } } },
        heading2: { run: { font: req.font, size: half(req.fontSize + 2), bold: true }, paragraph: { spacing: { before: 360, after: 180 } } },
        heading3: { run: { font: req.font, size: half(req.fontSize), bold: true, italics: true }, paragraph: { spacing: { before: 240, after: 120 } } },
        footnoteText: { run: { font: req.font, size: noteSize }, paragraph: { spacing: { line: 240, after: 60 } } },
      },
    },
    numbering: {
      config: [{ reference: 'num', levels: [0, 1, 2, 3, 4].map((level) => ({ level, format: 'decimal' as never, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })) }],
    },
    footnotes,
    sections: [
      ...(front.length ? [{ properties: { page: { margin: { top: margin, bottom: margin, left: margin, right: margin } } }, children: front }] : []),
      {
        properties: { page: { margin: { top: margin, bottom: margin, left: margin, right: margin } } },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }) },
        children: [
          new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: 'Indice', bold: true, size: half(req.fontSize + 4) })] }),
          new TableOfContents('Indice', { hyperlink: true, headingStyleRange: '1-3' }) as unknown as Paragraph,
          ...body,
        ],
      },
    ],
  });
  return Packer.toBlob(doc);
}

/* ---------------- Markdown ---------------- */

export function exportMarkdown(chapters: Chapter[], sources: Source[], req: Requirements, meta: ThesisMeta): string {
  const smap = new Map(sources.map((s) => [s.id, s]));
  const noteText = makeNoteResolver(smap, req);
  const citeText = makeCiteResolver(smap, req);
  const notes: string[] = [];
  const inline = (nodes?: JSONContent[]): string =>
    (nodes || []).map((n) => {
      if (n.type === 'text') {
        let t = n.text || '';
        const m = new Set((n.marks || []).map((x) => x.type));
        if (m.has('italic')) t = `*${t}*`;
        if (m.has('bold')) t = `**${t}**`;
        return t;
      }
      if (n.type === 'hardBreak') return '  \n';
      if (n.type === 'footnote') { notes.push(noteText(n.attrs || {})); return `[^${notes.length}]`; }
      if (n.type === 'cite') return citeText(n.attrs || {});
      return '';
    }).join('');
  const out: string[] = [];
  if (meta.title) out.push(`% ${meta.title}\n% ${meta.author}\n`);
  const block = (n: JSONContent, prefix = ''): void => {
    if (n.type === 'paragraph') out.push(prefix + inline(n.content) + '\n');
    else if (n.type === 'heading') out.push('#'.repeat(n.attrs?.level || 2) + ' ' + inline(n.content) + '\n');
    else if (n.type === 'bulletList' || n.type === 'orderedList') n.content?.forEach((li, i) => li.content?.forEach((c) => block(c, n.type === 'bulletList' ? '- ' : `${i + 1}. `)));
    else if (n.type === 'blockquote') n.content?.forEach((c) => block(c, '> '));
    else n.content?.forEach((c) => block(c, prefix));
  };
  for (const ch of [...chapters].sort((a, b) => a.order - b.order)) {
    out.push(`# ${ch.title}\n`);
    block(ch.content);
  }
  const cited = citedSourceIds(chapters);
  const bib = sources.filter((s) => cited.has(s.id)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  if (bib.length) { out.push('# Bibliografia\n'); bib.forEach((s) => out.push(bibEntry(s, req.citationStyle) + '\n')); }
  if (notes.length) { out.push(''); notes.forEach((t, i) => out.push(`[^${i + 1}]: ${t}`)); }
  return out.join('\n');
}

/* ---------------- Import ---------------- */

const exts = buildExtensions();

function htmlToDoc(html: string): JSONContent {
  return generateJSON(html || '<p></p>', exts);
}

/** Converte HTML (da DOCX/Google Docs) in capitoli: ogni titolo di livello 1 apre un capitolo. */
export function htmlToChapters(html: string, startOrder = 0): Chapter[] {
  const dom = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  // note di mammoth: <sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup> + <ol><li id="footnote-1">…</li></ol>
  const notes = new Map<string, string>();
  dom.querySelectorAll('li[id^="footnote-"]').forEach((li) => {
    li.querySelectorAll('a[href^="#footnote-ref"]').forEach((a) => a.remove());
    notes.set(li.id, li.textContent!.replace(/\s*↑\s*$/, '').trim());
    const ol = li.parentElement;
    li.remove();
    if (ol && !ol.children.length) ol.remove();
  });
  dom.querySelectorAll('a[href^="#footnote-"]').forEach((a) => {
    const id = a.getAttribute('href')!.slice(1);
    const span = dom.createElement('span');
    span.setAttribute('data-footnote', '');
    span.setAttribute('data-text', notes.get(id) || '');
    const sup = a.closest('sup') || a;
    sup.replaceWith(span);
  });
  // h1 → capitoli; h2..h6 scalati di uno (h2 nell'editor = sezione)
  const chapters: Chapter[] = [];
  let cur: { title: string; html: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    if (/^(indice|sommario|table of contents|contents)$/i.test(cur.title.trim()) && cur.html.join('').replace(/<[^>]+>/g, '').trim().length < 2000) { cur = null; return; }
    const content = htmlToDoc(cur.html.join(''));
    const kind: Chapter['kind'] = /^introduzione|^introduction/i.test(cur.title) ? 'intro' : /^conclusion/i.test(cur.title) ? 'conclusion' : /^abstract|^sommario|^riassunto/i.test(cur.title) ? 'abstract' : /^bibliografia|^riferimenti|^references/i.test(cur.title) ? 'bibliography' : /^appendice/i.test(cur.title) ? 'appendix' : 'chapter';
    chapters.push({ id: uid(), title: cur.title || 'Senza titolo', kind, order: startOrder + chapters.length, content, targetChars: 0, purpose: '', updatedAt: Date.now() });
  };
  for (const el of Array.from(dom.body.children)) {
    if (el.tagName === 'H1') { flush(); cur = { title: el.textContent!.trim(), html: [] }; continue; }
    if (!cur) cur = { title: 'Testo importato', html: [] };
    if (/^H[2-6]$/.test(el.tagName)) {
      const lv = Math.min(4, Math.max(2, parseInt(el.tagName[1], 10)));
      cur.html.push(`<h${lv}>${el.innerHTML}</h${lv}>`);
    } else cur.html.push(el.outerHTML);
  }
  flush();
  return chapters;
}

export async function importDocx(buf: ArrayBuffer, startOrder = 0): Promise<{ chapters: Chapter[]; warnings: string[] }> {
  const mammoth = (await import('mammoth')).default;
  const r = await mammoth.convertToHtml({ arrayBuffer: buf }, {
    styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Titolo'] => h1:fresh", "p[style-name='Titolo 1'] => h1:fresh", "p[style-name='Titolo 2'] => h2:fresh", "p[style-name='Titolo 3'] => h3:fresh"],
  });
  return { chapters: htmlToChapters(r.value, startOrder), warnings: r.messages.filter((m: { type: string }) => m.type === 'warning').map((m: { message: string }) => m.message).slice(0, 5) };
}

export function importPlainText(text: string, startOrder = 0): Chapter[] {
  const html = text
    .split(/\n{2,}/)
    .map((p) => {
      const t = p.trim();
      const h = t.match(/^(#{1,4})\s+(.*)$/);
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      if (h) return `<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`;
      return `<p>${esc(t).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
  return htmlToChapters(html, startOrder);
}

export function docToPlain(doc: JSONContent): string {
  const out: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'paragraph' || n.type === 'heading') {
      const t: string[] = [];
      const inl = (x: JSONContent) => { if (x.type === 'text') t.push(x.text || ''); x.content?.forEach(inl); };
      n.content?.forEach(inl);
      out.push(t.join(''));
    } else n.content?.forEach(walk);
  };
  walk(doc);
  return out.join('\n\n');
}

export { plain };
