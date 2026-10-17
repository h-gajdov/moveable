import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router';
import { LANGUAGES, type Language } from '../i18n';

function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? 'mk') as Language;
  return (
    <div role="group" aria-label={t('nav.language')} className="flex flex-wrap gap-1">
      {LANGUAGES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={current === l}
          onClick={() => void i18n.changeLanguage(l)}
          className={`min-h-11 min-w-11 rounded-md px-2.5 text-sm font-medium ${
            current === l ? 'bg-tactile text-tactile-ink' : 'text-vardar-ink hover:bg-white/15'
          }`}
        >
          {t(`lang.${l}`)}
        </button>
      ))}
    </div>
  );
}

/** Path of the previously rendered page (module-level: each page mounts its own Layout). */
let lastPath: string | null = null;

const links = [
  { to: '/', key: 'nav.plan', end: true },
  { to: '/report', key: 'nav.report' },
  { to: '/settings', key: 'nav.settings' },
  { to: '/help', key: 'nav.help' },
];

/**
 * Page shell: skip link, header with navigation and language switcher, and a
 * main landmark that receives focus after every page change, so screen-reader
 * and keyboard users start at the new content.
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
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only-focusable absolute left-2 top-2 z-50 rounded-md bg-tactile px-4 py-3 font-medium text-tactile-ink">
        {t('nav.skip')}
      </a>
      <header className="bg-vardar text-vardar-ink">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2">
          <NavLink to="/" className="flex min-h-11 items-center gap-2 rounded-md">
            <svg aria-hidden="true" viewBox="0 0 64 64" className="size-8">
              <path d="M14 48 C24 48 22 16 34 16 S46 42 50 42" fill="none" stroke="var(--c-tactile)" strokeWidth="8" strokeLinecap="round" />
              <circle cx="14" cy="48" r="7" fill="currentColor" />
              <circle cx="50" cy="42" r="7" fill="currentColor" />
            </svg>
            <span className="font-display text-xl font-bold">{t('app.name')}</span>
          </NavLink>
          <LanguageSwitcher />
        </div>
        <nav aria-label={t('nav.main')} className="mx-auto max-w-[110rem] px-2">
          <ul className="flex flex-wrap">
            {links.map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) =>
                    `flex min-h-11 items-center border-b-4 px-3 font-medium ${isActive ? 'border-tactile' : 'border-transparent hover:border-white/40'}`}
                >
                  {t(l.key)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className={`mx-auto w-full flex-1 focus:outline-none ${wide ? 'max-w-[110rem]' : 'max-w-3xl px-4 py-6'}`}
      >
        {children}
      </main>
      <footer className="border-t border-line px-4 py-4 text-sm text-ink-soft">
        <div className="mx-auto flex max-w-[110rem] flex-wrap gap-x-6 gap-y-1">
          <span>{t('map.attribution')}</span>
          <NavLink to="/help" className="underline">{t('nav.help')}</NavLink>
          <NavLink to="/admin" className="underline">{t('nav.admin')}</NavLink>
        </div>
      </footer>
    </div>
  );
}
