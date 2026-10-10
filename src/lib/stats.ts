import { useMemo } from 'react';
import { addCounts, blocks, count, measured, pages, roleReport, zeroCounts, type Counts, type RoleReport } from './analysis';
import { citedSourceIds, makeCiteResolver, makeNoteResolver } from './resolve';
import type { Chapter, Requirements, RoleDef, Source } from './types';

export interface ThesisStats {
  per: Map<string, Counts>;
  roles: Map<string, RoleReport>;
  total: Counts;
  body: Counts; // senza abstract/frontespizio se countFront = false
  measured: number;
  pages: number;
  cited: Set<string>;
}

export function computeStats(chapters: Chapter[], sources: Source[], req: Requirements, roles: RoleDef[]): ThesisStats {
  const smap = new Map(sources.map((s) => [s.id, s]));
  const nr = makeNoteResolver(smap, req);
  const cr = makeCiteResolver(smap, req);
  const per = new Map<string, Counts>();
  const rr = new Map<string, RoleReport>();
  let total = zeroCounts();
  let body = zeroCounts();
  for (const c of [...chapters].sort((a, b) => a.order - b.order)) {
    const bs = blocks(c.content, nr, cr);
    const k = count(bs);
    per.set(c.id, k);
    rr.set(c.id, roleReport(bs, roles, c.kind === 'chapter' ? 'Il capitolo' : c.title));
    total = addCounts(total, k);
    if (req.countFront || (c.kind !== 'front' && c.kind !== 'abstract')) body = addCounts(body, k);
  }
  return { per, roles: rr, total, body, measured: measured(body, req), pages: pages(body, req), cited: citedSourceIds(chapters) };
}

export function useThesisStats(chapters: Chapter[], sources: Source[], req: Requirements, roles: RoleDef[]) {
  return useMemo(() => computeStats(chapters, sources, req, roles), [chapters, sources, req, roles]);
}
