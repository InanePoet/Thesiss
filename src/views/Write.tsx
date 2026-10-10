import { useState } from 'react';
import { del, put, putMany } from '../lib/db';
import { chapter, KIND_LABEL } from '../lib/defaults';
import { nav } from '../lib/router';
import { useChapters, useRequirements, useSettings, useSources } from '../lib/store';
import { useThesisStats } from '../lib/stats';
import type { Chapter } from '../lib/types';
import { n } from '../lib/util';
import { RoleBar } from '../editor/RoleBar';
import { Icon } from '../ui/Icon';
import { AppBar, Sheet, toast } from '../ui/kit';
import { ImportSheet } from './ImportExport';

export function Write({ currentId }: { currentId?: string } = {}) {
  const [chapters, ready] = useChapters();
  const [sources] = useSources();
  const [req] = useRequirements();
  const [settings] = useSettings();
  const st = useThesisStats(chapters, sources, req, settings.roles);
  const [edit, setEdit] = useState(false);
  const [menu, setMenu] = useState<Chapter | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const target = req.minPages || 0;

  const move = async (c: Chapter, dir: -1 | 1) => {
    const list = [...chapters];
    const i = list.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await putMany('chapters', list.map((x, k) => ({ ...x, order: k })));
  };
  const add = async () => {
    const nCh = chapters.filter((c) => c.kind === 'chapter').length + 1;
    const concl = chapters.find((c) => c.kind === 'conclusion');
    const order = concl ? concl.order : chapters.length;
    const shifted = chapters.filter((c) => c.order >= order).map((c) => ({ ...c, order: c.order + 1 }));
    const c = chapter(`Capitolo ${nCh}`, 'chapter', order);
    await putMany('chapters', [...shifted, c]);
    nav('write/' + c.id);
  };
  const remove = async (c: Chapter) => {
    setMenu(null);
    await del('chapters', c.id);
    toast(`"${c.title}" eliminato`, { label: 'Annulla', run: () => void put('chapters', c) });
  };
  const duplicate = async (c: Chapter) => {
    setMenu(null);
    const copy = { ...chapter(c.title + ' (copia)', c.kind, c.order + 0.5), content: c.content, purpose: c.purpose };
    const list = [...chapters, copy].sort((a, b) => a.order - b.order).map((x, k) => ({ ...x, order: k }));
    await putMany('chapters', list);
  };

  return (
    <div className="screen">
      <AppBar
        title="Scrittura"
        actions={
          <>
            <button className={'iconbtn' + (edit ? ' on' : '')} onClick={() => setEdit((v) => !v)} aria-label="Riordina"><Icon name="reorder" /></button>
            <button className="iconbtn" onClick={() => setImportOpen(true)} aria-label="Importa ed esporta"><Icon name="file" /></button>
          </>
        }
      />
      <div className="wrap">
        <div className="card">
          <div className="row" style={{ alignItems: 'baseline' }}>
            <div className="grow">
              <div style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.02em' }} className="num serif">{st.pages.toFixed(1).replace('.', ',')}<span className="muted" style={{ fontSize: 16, fontWeight: 450 }}> {target ? `di ${target} pagine` : 'pagine'}</span></div>
              <div className="small muted num">{n(st.measured)} battute conteggiate · {n(st.total.words)} parole · {st.total.notes} note</div>
            </div>
            <button className="btn small" onClick={() => nav('req')}>Requisiti</button>
          </div>
          {target > 0 && <div className="meter" style={{ marginTop: 12 }}><i style={{ width: `${Math.min(100, (st.pages / target) * 100)}%` }} /></div>}
        </div>

        <div className="section-title">Capitoli</div>
        {ready && chapters.length === 0 ? (
          <div className="card"><p style={{ marginTop: 0 }}>Nessun capitolo. Creane uno o importa un documento.</p><div className="row"><button className="btn primary" onClick={add}>Nuovo capitolo</button><button className="btn" onClick={() => setImportOpen(true)}>Importa</button></div></div>
        ) : (
          <div className="list">
            {chapters.map((c, i) => {
              const k = st.per.get(c.id);
              const chars = k ? k.chars + (req.countFootnotes ? k.notesChars : 0) : 0;
              return (
                <div key={c.id} className={'item' + (c.id === currentId ? ' current' : '')} role="button" tabIndex={0} onClick={() => !edit && nav('write/' + c.id)} onKeyDown={(e) => e.key === 'Enter' && nav('write/' + c.id)}>
                  <div className="grow chapter-row">
                    <div style={{ minWidth: 0 }}>
                      <div className="title ellipsis">{c.title}</div>
                      <div className="meta ellipsis">{c.kind !== 'chapter' ? KIND_LABEL[c.kind] + ' · ' : ''}{chars ? `${n(chars)} battute` : 'vuoto'}{c.targetChars ? ` · ${Math.round((chars / c.targetChars) * 100)}% dell'obiettivo` : ''}{c.purpose ? ` · ${c.purpose}` : ''}</div>
                    </div>
                    {edit ? (
                      <div className="row" style={{ gap: 0 }}>
                        <button className="iconbtn" disabled={i === 0} onClick={(e) => { e.stopPropagation(); void move(c, -1); }} aria-label="Su"><Icon name="up" /></button>
                        <button className="iconbtn" disabled={i === chapters.length - 1} onClick={(e) => { e.stopPropagation(); void move(c, 1); }} aria-label="Giù"><Icon name="down" /></button>
                      </div>
                    ) : (
                      <button className="iconbtn" onClick={(e) => { e.stopPropagation(); setMenu(c); }} aria-label="Opzioni"><Icon name="more" /></button>
                    )}
                    {settings.showRoles && k && k.chars > 300 && <RoleBar report={st.roles.get(c.id)!} roles={settings.roles} height={6} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <button className="btn block" style={{ marginTop: 12 }} onClick={add}><Icon name="plus" /> Aggiungi capitolo</button>
      </div>

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.title}>
        {menu && (
          <div className="list">
            <button className="item" onClick={() => { nav('write/' + menu.id); setMenu(null); }}><Icon name="pen" /><span className="grow title">Apri</span></button>
            <button className="item" onClick={() => void duplicate(menu)}><Icon name="file" /><span className="grow title">Duplica</span></button>
            <button className="item" onClick={() => void remove(menu)}><Icon name="trash" /><span className="grow title" style={{ color: 'var(--bad)' }}>Elimina</span></button>
          </div>
        )}
      </Sheet>
      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} chapters={chapters} />
    </div>
  );
}
