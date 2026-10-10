import { useEffect, useState } from 'react';

const parse = () => (location.hash.replace(/^#\/?/, '') || 'home').split('/').map(decodeURIComponent);

export function useRoute(): string[] {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const h = () => setR(parse());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return r;
}

export function nav(path: string, replace = false) {
  const h = '#/' + path.replace(/^\/+/, '');
  if (replace) history.replaceState(null, '', h);
  else location.hash = h;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function back(fallback = 'home') {
  if (history.length > 1 && (history.state as unknown) !== 'root') history.back();
  else nav(fallback, true);
}
