import { useTranslation } from 'react-i18next';
import { Layout } from '../components/Layout';
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
      <h1 className="text-3xl font-bold">{t('help.title')}</h1>
      {sections.map(([h, b]) => (
        <section key={h} aria-labelledby={`help-${h}`} className="mt-8">
          <h2 id={`help-${h}`} className="text-2xl font-bold">{t(`help.${h}`)}</h2>
          <p className="mt-2 max-w-[70ch]">{t(`help.${b}`)}</p>
        </section>
      ))}
      <section aria-labelledby="help-data" className="mt-8">
        <h2 id="help-data" className="text-2xl font-bold">{t('help.data')}</h2>
        <ul className="mt-2 list-disc pl-6">
          {(config.data?.attribution ?? [
            { name: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0' },
          ]).map((a) => (
            <li key={a.name}>
              <a href={a.url} className="underline" rel="noreferrer">{a.name}</a> ({a.license})
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  );
}
