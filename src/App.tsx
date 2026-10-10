import { App as CapApp } from '@capacitor/app';
import { useEffect, useState } from 'react';
import { startBackup } from './lib/backup';
import { ensureInit, useSettings } from './lib/store';
import { back, nav, useRoute } from './lib/router';
import { refreshStale } from './lib/search/saved';
import { isNative } from './lib/platform';
import { Icon } from './ui/Icon';
import { handleBack, toast, ToastHost } from './ui/kit';
import { EditorScreen } from './editor/EditorScreen';
import { Home } from './views/Home';
import { Write } from './views/Write';
import { Sources } from './views/Sources';
import { SourceDetail } from './views/SourceDetail';
import { Concepts, NoteView } from './views/Concepts';
import { More, MetaView, SettingsView } from './views/More';
import { ResearchQuestion } from './views/ResearchQuestion';
import { RequirementsView } from './views/Requirements';
import { BackupView } from './views/ImportExport';

const TABS = [
  { key: 'home', label: 'Inizio', icon: 'home' },
  { key: 'write', label: 'Scrivi', icon: 'pen' },
  { key: 'sources', label: 'Fonti', icon: 'book' },
  { key: 'map', label: 'Concetti', icon: 'graph' },
  { key: 'more', label: 'Altro', icon: 'menu' },
];

function useTheme() {
  const [s] = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = s.theme === 'dark' || (s.theme === 'auto' && mq.matches);
      root.dataset.theme = dark ? 'dark' : 'light';
      root.dataset.density = s.density;
      root.style.setProperty('--accent-base', s.accent);
      root.style.setProperty('--editor-font', s.editorFont === 'serif' ? 'var(--serif)' : s.editorFont === 'mono' ? 'var(--mono)' : 'var(--ui)');
      root.style.setProperty('--editor-size', s.editorSize + 'px');
      root.style.setProperty('--editor-leading', String(s.editorLeading));
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#11151b' : '#f5f6f3');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [s]);
}

function useWide() {
  const q = '(min-width: 840px)';
  const [w, setW] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setW(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return w;
}

export default function App() {
  const wide = useWide();
  const [ready, setReady] = useState(false);
  const route = useRoute();
  useTheme();

  useEffect(() => {
    (async () => {
      await ensureInit();
      await startBackup();
      setReady(true);
      setTimeout(async () => {
        const fresh = await refreshStale(20).catch(() => 0);
        if (fresh) toast(`${fresh} nuovi risultati nelle ricerche monitorate`, { label: 'Vedi', run: () => nav('sources/saved') });
      }, 4000);
    })();
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    const h = CapApp.addListener('backButton', () => {
      if (handleBack()) return;
      const r = location.hash.replace(/^#\/?/, '') || 'home';
      if (r === 'home') void CapApp.minimizeApp();
      else if (TABS.some((t) => t.key === r)) nav('home', true);
      else back(r.split('/')[0]);
    });
    return () => { void h.then((x) => x.remove()); };
  }, []);

  if (!ready) return null;
  const [a, b, c] = route;
  let screen: React.JSX.Element;
  let showNav = true;
  switch (a) {
    case 'write':
      if (b && wide) screen = <div className="split"><Write currentId={b} /><EditorScreen key={b} id={b} /></div>;
      else screen = b ? <EditorScreen id={b} /> : <Write />;
      showNav = !b || wide;
      break;
    case 'sources': screen = <Sources tab={b} />; break;
    case 'source': screen = <SourceDetail id={b} />; showNav = false; break;
    case 'map': screen = b === 'note' && c ? <NoteView id={c} /> : <Concepts tab={b} />; showNav = b !== 'note'; break;
    case 'more': screen = <More />; break;
    case 'rq': screen = <ResearchQuestion />; showNav = false; break;
    case 'req': screen = <RequirementsView />; showNav = false; break;
    case 'settings': screen = <SettingsView />; showNav = false; break;
    case 'meta': screen = <MetaView />; showNav = false; break;
    case 'backup': screen = <BackupView />; showNav = false; break;
    default: screen = <Home />;
  }
  if (wide) showNav = true;
  const active = a === 'source' ? 'sources' : TABS.some((t) => t.key === a) ? a : 'home';
  return (
    <div className={'app' + (showNav && wide ? ' has-nav' : '')}>
      {screen}
      {showNav && (
        <nav className="bottomnav" aria-label="Sezioni">
          {TABS.map((t) => (
            <button key={t.key} aria-current={active === t.key ? 'page' : undefined} onClick={() => nav(t.key)}>
              <span className="pill"><Icon name={t.icon} /></span>
              {t.label}
            </button>
          ))}
        </nav>
      )}
      <ToastHost />
    </div>
  );
}
