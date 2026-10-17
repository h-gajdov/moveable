import { Check, CircleHelp, Globe, Route, Settings, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router';
import { LANGUAGES, type Language } from '../i18n';

/**
 * The three interface languages as an inset grouped list with a checkmark on
 * the current one. Buttons keep `aria-pressed`, so the state is announced.
 */
export function LanguageList({ onChosen, className = '' }: { onChosen?: () => void; className?: string }) {
  const { t, i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? 'mk') as Language;
  return (
    <div role="group" aria-label={t('nav.language')} className={`rows ${className}`}>
      {LANGUAGES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={current === l}
          onClick={() => {
            void i18n.changeLanguage(l);
            onChosen?.();
          }}
          className={`flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-fill ${
            current === l ? 'font-semibold' : ''}`}
        >
          {t(`lang.${l}`)}
          {current === l && <Check aria-hidden="true" className="size-5 shrink-0 text-link" strokeWidth={2.5} />}
        </button>
      ))}
    </div>
  );
}

/** Globe button in the navigation bar that opens the language list as a popover. */
function LanguageMenu() {
  const { t } = useTranslation();
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const d = ref.current;
      if (d?.open && !d.contains(e.target as Node)) d.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      const d = ref.current;
      if (d?.open && e.key === 'Escape') {
        d.open = false;
        d.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <details ref={ref} className="group relative">
      <summary className="grid size-11 cursor-pointer list-none place-items-center rounded-full text-link transition-colors hover:bg-fill group-open:bg-fill [&::-webkit-details-marker]:hidden">
        <Globe aria-hidden="true" className="size-[22px]" />
        <span className="sr-only">{t('nav.language')}</span>
      </summary>
      <div className="card absolute right-0 top-full z-40 mt-2 w-60 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[14px] shadow-[var(--shadow-float)]">
        <LanguageList onChosen={() => ref.current?.removeAttribute('open')} />
      </div>
    </details>
  );
}

function Logo({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" className={className}>
      <rect width="64" height="64" rx="15" fill="var(--c-accent)" />
      <path d="M18 45 C26 45 24 19 33 19 S43 39 46 39" fill="none" stroke="var(--c-accent-ink)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="18" cy="45" r="5.5" fill="var(--c-accent-ink)" />
      <circle cx="46" cy="39" r="5.5" fill="var(--c-accent-ink)" />
    </svg>
  );
}

/** Path of the previously rendered page (module-level: each page mounts its own Layout). */
let lastPath: string | null = null;

const tabs: { to: string; key: string; icon: LucideIcon; also?: string[] }[] = [
  { to: '/', key: 'nav.tabPlan', icon: Route, also: ['/navigate'] },
  { to: '/report', key: 'nav.tabReport', icon: TriangleAlert },
  { to: '/settings', key: 'nav.tabSettings', icon: Settings },
  { to: '/help', key: 'nav.tabHelp', icon: CircleHelp },
];

/**
 * App shell, laid out like an iOS app: a navigation bar on top, the page in
 * between and a tab bar at the bottom. Only `main` scrolls, so content (and
 * keyboard focus) never hides behind either bar. On larger screens the whole
 * shell sits inside a phone frame (`.app-frame`), so it looks the same everywhere.
 *
 * The main landmark receives focus after every page change, so screen-reader
 * and keyboard users start at the new content.
 *
 * `wide` pages (map + sheet) run edge to edge instead of in a padded column.
 */
export function Layout({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  const { t } = useTranslation();
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();

  useEffect(() => {
    document.title = `${title} | ${t('app.name')}`;
  }, [title, t]);

  useEffect(() => {
    // Move focus to the new content after in-app navigation, but not on first load
    // (so the skip link stays the first Tab stop).
    if (lastPath !== null && lastPath !== location.pathname) {
      mainRef.current?.focus();
    }
    lastPath = location.pathname;
  }, [location.pathname]);

  return (
    <div className="app-frame flex flex-col">
      <a href="#main" className="sr-only-focusable absolute left-3 top-3 z-50 rounded-pill bg-accent px-5 py-3 font-medium text-accent-ink">
        {t('nav.skip')}
      </a>
      <header className="chrome relative z-30 shrink-0 border-b-[length:var(--hair)] border-hairline pt-[max(env(safe-area-inset-top),var(--frame-top))]">
        <div className="flex h-[52px] items-center gap-3 pl-4 pr-2">
          <NavLink to="/" className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-[10px]">
            <Logo className="size-8 shrink-0" />
            <span className="truncate font-display text-[1.0625rem] font-semibold tracking-[-0.01em]">{t('app.name')}</span>
          </NavLink>
          <div className="ml-auto">
            <LanguageMenu />
          </div>
        </div>
      </header>
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="panel-scroll min-h-0 w-full flex-1 overflow-y-auto overscroll-contain focus:outline-none"
      >
        {wide ? children : <div className="px-4 pb-10 pt-4">{children}</div>}
      </main>
      <nav aria-label={t('nav.main')} className="chrome relative z-30 shrink-0 select-none border-t-[length:var(--hair)] border-hairline pb-[max(env(safe-area-inset-bottom),var(--frame-bottom))]">
        <ul className="grid grid-cols-4 px-1">
          {tabs.map(({ to, key, icon: Icon, also }) => {
            const active = location.pathname === to || (also?.includes(location.pathname) ?? false);
            return (
              <li key={to}>
                <NavLink
                  to={to}
                  end
                  className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 px-1 pb-1.5 pt-1.5 text-center text-[0.75rem] leading-tight transition-colors ${
                    active ? 'font-semibold text-link' : 'font-medium text-muted hover:text-ink'}`}
                >
                  <span aria-hidden="true" className={`tab-pill grid h-7 w-14 place-items-center rounded-pill transition-colors ${active ? 'bg-tint' : ''}`}
                    data-active={active || undefined}>
                    <Icon className="size-[22px]" strokeWidth={active ? 2.4 : 1.8} />
                  </span>
                  {t(key)}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
