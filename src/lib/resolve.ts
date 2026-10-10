import type { JSONContent } from '@tiptap/core';
import { chicagoNote, inlineCite } from './cite';
import type { Chapter, Requirements, Source } from './types';

/* ---------------- risoluzione note e citazioni ---------------- */

export function makeNoteResolver(sources: Map<string, Source>, req: Requirements) {
  const seen = new Set<string>();
  let prev: { id: string; loc: string } | null = null;
  return (a: Record<string, any>): string => {
    const s = a.sourceId ? sources.get(a.sourceId) : undefined;
    let cit = '';
    if (s) {
      const loc = a.locator || '';
      if (req.citationStyle === 'chicago-note') {
        if (prev && prev.id === s.id) cit = loc && loc !== prev.loc ? `Ivi, ${/^\d/.test(loc) ? 'p. ' + loc : loc}.` : 'Ibidem.';
        else cit = chicagoNote(s, loc, seen.has(s.id));
      } else cit = `Cfr. ${inlineCite(s, loc, req.citationStyle).replace(/^\(|\)$/g, '')}.`;
      seen.add(s.id);
      prev = { id: s.id, loc };
    } else prev = null;
    return [cit, a.text].filter(Boolean).join(' ');
  };
}

export function makeCiteResolver(sources: Map<string, Source>, req: Requirements) {
  return (a: Record<string, any>) => inlineCite(sources.get(a.sourceId), a.locator, req.citationStyle);
}

export function citedSourceIds(chapters: Chapter[]): Set<string> {
  const ids = new Set<string>();
  const walk = (n: JSONContent) => {
    if ((n.type === 'footnote' || n.type === 'cite') && n.attrs?.sourceId) ids.add(n.attrs.sourceId);
    n.content?.forEach(walk);
  };
  chapters.forEach((c) => walk(c.content));
  return ids;
}

