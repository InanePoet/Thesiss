import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    pushBack(onClose);
    return () => { window.removeEventListener('keydown', h); popBack(onClose); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grab" />
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </>
  );
}

/* --- gestione tasto indietro Android: le sheet aperte si chiudono per prime --- */
const backStack: (() => void)[] = [];
export function pushBack(fn: () => void) { backStack.push(fn); }
export function popBack(fn: () => void) { const i = backStack.lastIndexOf(fn); if (i >= 0) backStack.splice(i, 1); }
export function handleBack(): boolean {
  const fn = backStack[backStack.length - 1];
  if (fn) { fn(); return true; }
  return false;
}

/* --- toast con eventuale "Annulla" --- */
type ToastMsg = { text: string; action?: { label: string; run: () => void }; id: number };
let setToastGlobal: ((t: ToastMsg | null) => void) | null = null;
export function toast(text: string, action?: ToastMsg['action']) {
  setToastGlobal?.({ text, action, id: Date.now() });
}
export function ToastHost() {
  const [t, setT] = useState<ToastMsg | null>(null);
  useEffect(() => { setToastGlobal = setT; return () => { setToastGlobal = null; }; }, []);
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => setT(null), t.action ? 6000 : 3200);
    return () => clearTimeout(h);
  }, [t]);
  if (!t) return null;
  return (
    <div className="toast" role="status">
      <span>{t.text}</span>
      {t.action && <button onClick={() => { t.action!.run(); setT(null); }}>{t.action.label}</button>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Switch({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="switch">
      <span className="grow">
        {label}
        {hint && <span className="tiny muted" style={{ display: 'block' }}>{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AppBar({ title, sub, onBack, actions, line }: { title: ReactNode; sub?: ReactNode; onBack?: () => void; actions?: ReactNode; line?: boolean }) {
  return (
    <header className={'appbar' + (line ? ' line' : '')}>
      {onBack && (
        <button className="iconbtn" onClick={onBack} aria-label="Indietro">
          <Icon name="back" />
        </button>
      )}
      <h1>
        {title}
        {sub && <span className="sub">{sub}</span>}
      </h1>
      {actions}
    </header>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p style={{ margin: '0 0 16px' }}>{children}</p>}
      {action}
    </div>
  );
}

export function NumInput({ value, onChange, min = 0, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  return <input className="input num" type="number" inputMode="decimal" min={min} step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(parseFloat(e.target.value.replace(',', '.')) || 0)} />;
}

export function confirmDialog(text: string): boolean {
  return window.confirm(text);
}
