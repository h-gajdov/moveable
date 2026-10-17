import { useTranslation } from 'react-i18next';
import { Layout } from '../components/Layout';
import { PageTitle } from '../components/ui';
import { useAppConfig } from './PlanPage';

export function HelpPage() {
  const { t } = useTranslation();
  const config = useAppConfig();
  const sections = [
    ['how', 'howBody'], ['unknown', 'unknownBody'], ['estimated', 'estimatedBody'], ['safety', 'safetyBody'],
    ['privacyTitle', 'privacyBody'], ['keyboard', 'keyboardBody'], ['accessibility', 'accessibilityBody'],
  ] as const;
  return (
    <Layout title={t('help.title')}>
      <PageTitle>{t('help.title')}</PageTitle>
      <div className="flex flex-col gap-4">
        {sections.map(([h, b]) => (
          <section key={h} aria-labelledby={`help-${h}`} className="card p-5 sm:p-6">
            <h2 id={`help-${h}`} className="text-[1.375rem]">{t(`help.${h}`)}</h2>
            <p className="mt-2 max-w-[68ch] text-ink-2">{t(`help.${b}`)}</p>
          </section>
        ))}
        <section aria-labelledby="help-data" className="card p-5 sm:p-6">
          <h2 id="help-data" className="text-[1.375rem]">{t('help.data')}</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {(config.data?.attribution ?? [
              { name: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0' },
            ]).map((a) => (
              <li key={a.name}>
                <a href={a.url} className="text-link underline underline-offset-2" rel="noreferrer">{a.name}</a>{' '}
                <span className="text-muted">({a.license})</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Layout>
  );
}
