import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router';
import { LANGUAGES, type Language } from '../i18n';

function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? 'mk') as Language;
  return (
    <div role="group" aria-label={t('nav.language')} className="flex flex-wrap gap-0.5 rounded-[12px] bg-white/10 p-0.5">
      {LANGUAGES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={current === l}
          onClick={() => void i18n.changeLanguage(l)}
          className={`min-h-11 min-w-11 rounded-[10px] px-3 text-[0.875rem] transition-colors ${
            current === l ? 'bg-bar-ink font-semibold text-bar' : 'text-bar-muted hover:text-bar-ink'
          }`}
        >
          {t(`lang.${l}`)}
        </button>
      ))}
    </div>
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

const links = [
  { to: '/', key: 'nav.plan', end: true },
  { to: '/report', key: 'nav.report' },
  { to: '/settings', key: 'nav.settings' },
  { to: '/help', key: 'nav.help' },
];

/**
 * Page shell: skip link, global bar with navigation and language switcher, and
 * a main landmark that receives focus after every page change, so
 * screen-reader and keyboard users start at the new content.
 *
 * `immersive` pages (map + floating panel) fill the viewport on large screens.
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
    <div className={`flex min-h-dvh flex-col ${wide ? 'lg:h-dvh' : ''}`}>
      <a href="#main" className="sr-only-focusable absolute left-3 top-3 z-50 rounded-pill bg-accent px-5 py-3 font-medium text-accent-ink">
        {t('nav.skip')}
      </a>
      <header className="relative z-20 bg-bar text-bar-ink">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-x-6 gap-y-1 px-4 py-1.5 sm:px-6">
          <NavLink to="/" className="flex min-h-11 items-center gap-2.5 rounded-[10px]">
            <Logo className="size-7 shrink-0" />
            <span className="font-display text-[1.0625rem] font-semibold tracking-[-0.01em]">{t('app.name')}</span>
          </NavLink>
          <nav aria-label={t('nav.main')} className="order-3 w-full md:order-none md:w-auto md:flex-1">
            <ul className="-mx-2 flex flex-wrap md:mx-0">
              {links.map((l) => (
                <li key={l.to}>
                  <NavLink
                    to={l.to}
                    end={l.end}
                    className={({ isActive }) =>
                      `relative flex min-h-11 items-center px-3 text-[0.875rem] transition-colors after:absolute after:inset-x-3 after:bottom-1 after:h-0.5 after:rounded-full ${
                        isActive ? 'font-semibold text-bar-ink after:bg-bar-ink' : 'text-bar-muted hover:text-bar-ink'}`}
                  >
                    {t(l.key)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto">
            <LanguageSwitcher />
          </div>
        </div>
      </header>
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className={`w-full flex-1 focus:outline-none ${wide ? 'lg:relative lg:min-h-0' : 'mx-auto max-w-3xl px-4 pb-12 pt-8 sm:px-6 sm:pt-12'}`}
      >
        {children}
      </main>
      <footer className="border-t border-hairline px-4 py-3 text-[0.8125rem] text-muted sm:px-6">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-x-5 gap-y-1">
          <span>{t('map.attribution')}</span>
          <NavLink to="/help" className="inline-flex min-h-11 items-center hover:text-ink hover:underline">{t('nav.help')}</NavLink>
          <NavLink to="/admin" className="inline-flex min-h-11 items-center hover:text-ink hover:underline">{t('nav.admin')}</NavLink>
        </div>
      </footer>
    </div>
  );
}
