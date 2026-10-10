import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { useEffect, useRef } from 'react';

export interface GNode extends SimulationNodeDatum { id: string; label: string; kind: 'note' | 'source' | 'tag'; weight: number }
export interface GLink extends SimulationLinkDatum<GNode> { kind: 'link' | 'source' | 'similar' }

export function GraphCanvas({ nodes, links, selected, onSelect, focus }: { nodes: GNode[]; links: GLink[]; selected: string | null; onSelect: (id: string | null) => void; focus?: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ k: 1, x: 0, y: 0, selected: null as string | null });
  state.current.selected = selected;
  const draw = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const css = getComputedStyle(document.documentElement);
    const col = {
      accent: css.getPropertyValue('--accent').trim() || '#2b4c7e',
      text: css.getPropertyValue('--text').trim() || '#222',
      muted: css.getPropertyValue('--muted').trim() || '#777',
      faint: css.getPropertyValue('--faint').trim() || '#aaa',
      line: css.getPropertyValue('--line').trim() || '#ddd',
      surface: css.getPropertyValue('--surface').trim() || '#fff',
    };
    const ns = nodes.map((n) => ({ ...n }));
    const ls = links.map((l) => ({ ...l, source: typeof l.source === 'object' ? (l.source as GNode).id : l.source, target: typeof l.target === 'object' ? (l.target as GNode).id : l.target }));
    const byId = new Map(ns.map((n) => [n.id, n]));
    const neighbors = new Map<string, Set<string>>();
    ls.forEach((l) => {
      const a = l.source as string, b = l.target as string;
      if (!neighbors.has(a)) neighbors.set(a, new Set());
      if (!neighbors.has(b)) neighbors.set(b, new Set());
      neighbors.get(a)!.add(b); neighbors.get(b)!.add(a);
    });
    const radius = (n: GNode) => (n.kind === 'note' ? 6 + Math.min(10, Math.sqrt(n.weight) * 2.2) : n.kind === 'tag' ? 5 : 4 + Math.min(4, n.weight));

    let W = 0, H = 0;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      if (!state.current.x && !state.current.y) { state.current.x = W / 2; state.current.y = H / 2; }
      render();
    };

    const sim = forceSimulation<GNode>(ns)
      .force('link', forceLink<GNode, GLink>(ls as unknown as GLink[]).id((d) => d.id).distance((l) => ((l as GLink).kind === 'similar' ? 110 : (l as GLink).kind === 'source' ? 55 : 80)).strength((l) => ((l as GLink).kind === 'similar' ? 0.08 : 0.5)))
      .force('charge', forceManyBody().strength((d) => ((d as GNode).kind === 'note' ? -170 : -60)))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide<GNode>().radius((d) => radius(d) + 4))
      .alphaDecay(0.03);

    function render() {
      const { k, x, y } = state.current;
      const sel = state.current.selected;
      const near = sel ? neighbors.get(sel) || new Set() : null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.translate(x, y);
      ctx.scale(k, k);
      ctx.lineWidth = 1 / k;
      for (const l of ls as unknown as { source: GNode; target: GNode; kind: string }[]) {
        const a = l.source, b = l.target;
        if (typeof a !== 'object') continue;
        const hi = sel && (a.id === sel || b.id === sel);
        ctx.strokeStyle = hi ? col.accent : col.line;
        ctx.globalAlpha = sel && !hi ? 0.35 : l.kind === 'similar' ? 0.6 : 1;
        if (l.kind === 'similar') ctx.setLineDash([3 / k, 4 / k]); else ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(a.x!, a.y!); ctx.lineTo(b.x!, b.y!); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const n of ns) {
        const dim = sel && n.id !== sel && !near!.has(n.id);
        ctx.globalAlpha = dim ? 0.25 : 1;
        const r = radius(n);
        ctx.beginPath();
        if (n.kind === 'source') ctx.rect(n.x! - r, n.y! - r, r * 2, r * 2);
        else ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
        ctx.fillStyle = n.kind === 'note' ? col.accent : n.kind === 'tag' ? col.muted : col.faint;
        ctx.fill();
        if (n.id === sel) { ctx.lineWidth = 3 / k; ctx.strokeStyle = col.text; ctx.stroke(); ctx.lineWidth = 1 / k; }
        const showLabel = n.kind === 'note' ? k > 0.45 : k > 1.3 || n.id === sel || (near && near.has(n.id));
        if (showLabel) {
          const fs = (n.kind === 'note' ? 13 : 11) / Math.max(0.8, Math.min(k, 1.6));
          ctx.font = `${n.kind === 'note' ? 600 : 450} ${fs}px Inter Variable, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = n.kind === 'note' ? col.text : col.muted;
          const lab = n.label.length > 34 ? n.label.slice(0, 32) + '…' : n.label;
          ctx.lineWidth = 3 / k; ctx.strokeStyle = col.surface; ctx.strokeText(lab, n.x!, n.y! + r + fs + 1);
          ctx.fillText(lab, n.x!, n.y! + r + fs + 1);
          ctx.lineWidth = 1 / k;
        }
      }
      ctx.globalAlpha = 1;
    }
    draw.current = render;
    sim.on('tick', render);

    /* ---- interazione: pan, pinch, trascina nodo, tocco ---- */
    const pointers = new Map<number, { x: number; y: number }>();
    let dragNode: GNode | null = null;
    let moved = false;
    let pinch: { d: number; k: number; cx: number; cy: number; x: number; y: number } | null = null;
    const toWorld = (px: number, py: number) => ({ x: (px - state.current.x) / state.current.k, y: (py - state.current.y) / state.current.k });
    const hit = (px: number, py: number) => {
      const w = toWorld(px, py);
      let best: GNode | null = null, bd = Infinity;
      for (const n of ns) {
        const d = Math.hypot(n.x! - w.x, n.y! - w.y);
        if (d < radius(n) + 12 / state.current.k && d < bd) { best = n; bd = d; }
      }
      return best;
    };
    const pos = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = pos(e);
      pointers.set(e.pointerId, p);
      moved = false;
      if (pointers.size === 1) {
        dragNode = hit(p.x, p.y);
        if (dragNode) { dragNode.fx = dragNode.x; dragNode.fy = dragNode.y; sim.alphaTarget(0.2).restart(); }
      } else if (pointers.size === 2) {
        if (dragNode) { dragNode.fx = null; dragNode.fy = null; dragNode = null; }
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: state.current.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, x: state.current.x, y: state.current.y };
      }
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId)!;
      const p = pos(e);
      pointers.set(e.pointerId, p);
      if (Math.hypot(p.x - prev.x, p.y - prev.y) > 1) moved = true;
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const k = Math.max(0.2, Math.min(4, (pinch.k * d) / pinch.d));
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        state.current.k = k;
        state.current.x = cx - ((pinch.cx - pinch.x) / pinch.k) * k;
        state.current.y = cy - ((pinch.cy - pinch.y) / pinch.k) * k;
        render();
      } else if (dragNode) {
        const w = toWorld(p.x, p.y);
        dragNode.fx = w.x; dragNode.fy = w.y;
      } else {
        state.current.x += p.x - prev.x;
        state.current.y += p.y - prev.y;
        render();
      }
    };
    const up = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (dragNode) { dragNode.fx = null; dragNode.fy = null; sim.alphaTarget(0); }
      if (!moved && p && pointers.size === 0) {
        const n = hit(p.x, p.y);
        onSelect(n ? n.id : null);
      }
      dragNode = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = { x: e.offsetX, y: e.offsetY };
      const k0 = state.current.k;
      const k = Math.max(0.2, Math.min(4, k0 * (e.deltaY < 0 ? 1.12 : 0.89)));
      state.current.x = p.x - ((p.x - state.current.x) / k0) * k;
      state.current.y = p.y - ((p.y - state.current.y) / k0) * k;
      state.current.k = k;
      render();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    if (focus) {
      setTimeout(() => {
        const n = byId.get(focus);
        if (n) { state.current.k = 1.2; state.current.x = W / 2 - n.x! * 1.2; state.current.y = H / 2 - n.y! * 1.2; render(); }
      }, 900);
    }
    return () => {
      sim.stop();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links]);

  useEffect(() => { draw.current(); }, [selected]);

  return <canvas ref={ref} aria-label="Mappa dei concetti" />;
}
