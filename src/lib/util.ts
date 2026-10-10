export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = undefined; fn(...a); }, ms);
  };
  d.flush = (...a: Parameters<T>) => { if (t) { clearTimeout(t); t = undefined; } fn(...a); };
  d.pending = () => t !== undefined;
  return d;
}

export const fmt = new Intl.NumberFormat('it-IT');
export const n = (x: number) => fmt.format(Math.round(x));

export function today(d = new Date()): string {
  const z = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function timeAgo(ts?: number): string {
  if (!ts) return 'mai';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'adesso';
  if (s < 60) return `${s} s fa`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h fa`;
  return new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

export function dateTime(ts: number): string {
  return new Date(ts).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function normTitle(t: string): string {
  return t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function cleanDoi(d?: string | null): string | undefined {
  if (!d) return undefined;
  return d.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '').trim() || undefined;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
