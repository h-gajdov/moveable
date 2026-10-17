import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi, ApiError, type AdminReport } from '../api/client';
import { useAnnounce } from '../components/Announcer';
import { Layout } from '../components/Layout';
import { Button, ErrorBox, Select } from '../components/ui';
import { currentLanguage } from '../i18n';
import { formatDate } from '../lib/format';

const STATUSES = ['PENDING', 'VERIFIED', 'REJECTED', 'RESOLVED', 'EXPIRED'];
const NEXT: Record<string, string[]> = {
  PENDING: ['VERIFIED', 'REJECTED', 'EXPIRED'],
  VERIFIED: ['RESOLVED', 'EXPIRED', 'REJECTED'],
  RESOLVED: ['VERIFIED'],
  EXPIRED: ['VERIFIED', 'PENDING'],
  REJECTED: ['PENDING'],
};

/** Moderation. Credentials are kept in memory only and sent with HTTP Basic (use HTTPS). */
export function AdminPage() {
  const { t } = useTranslation();
  const [creds, setCreds] = useState<{ u: string; p: string } | null>(null);
  const [form, setForm] = useState({ u: '', p: '' });
  const [loginError, setLoginError] = useState<string | null>(null);
  const client = useMemo(() => (creds ? adminApi(creds.u, creds.p) : null), [creds]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    try {
      await adminApi(form.u, form.p).me();
      setCreds(form);
      setLoginError(null);
    } catch (err) {
      setLoginError(err instanceof ApiError && err.status === 401 ? t('admin.badCredentials')
        : t(`errors.${err instanceof ApiError ? err.code : 'default'}`, { defaultValue: t('errors.default') }));
    }
  }

  if (!client) {
    return (
      <Layout title={t('admin.title')}>
        <h1 className="text-3xl font-bold">{t('admin.title')}</h1>
        <form onSubmit={signIn} className="mt-6 flex max-w-sm flex-col gap-3">
          <label htmlFor="u" className="font-medium">{t('admin.username')}</label>
          <input id="u" autoComplete="username" value={form.u} onChange={(e) => setForm({ ...form, u: e.target.value })}
            className="min-h-11 rounded-lg border-2 border-line bg-surface px-3" />
          <label htmlFor="p" className="font-medium">{t('admin.password')}</label>
          <input id="p" type="password" autoComplete="current-password" value={form.p}
            onChange={(e) => setForm({ ...form, p: e.target.value })} className="min-h-11 rounded-lg border-2 border-line bg-surface px-3" />
          {loginError && <ErrorBox>{loginError}</ErrorBox>}
          <Button type="submit" variant="primary">{t('admin.signIn')}</Button>
        </form>
      </Layout>
    );
  }
  return <Moderation client={client} onSignOut={() => setCreds(null)} />;
}

function Moderation({ client, onSignOut }: { client: ReturnType<typeof adminApi>; onSignOut: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState('PENDING');
  const reports = useQuery({ queryKey: ['admin-reports', status], queryFn: () => client.reports(status) });
  const runs = useQuery({ queryKey: ['admin-runs'], queryFn: client.ingestionRuns });
  const lang = currentLanguage();

  return (
    <Layout title={t('admin.title')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t('admin.title')}</h1>
        <Button onClick={onSignOut}>{t('admin.signOut')}</Button>
      </div>
      <section aria-labelledby="q-h" className="mt-6">
        <h2 id="q-h" className="text-2xl font-bold">{t('admin.queue')}</h2>
        <Select label={t('admin.status')} value={status} onChange={setStatus}
          options={STATUSES.map((s) => ({ value: s, label: t(`admin.statuses.${s}`) }))} />
        {reports.isLoading && <p role="status">{t('common.loading')}</p>}
        {reports.data?.items.length === 0 && <p className="mt-3">{t('admin.empty')}</p>}
        <ul className="mt-3 flex flex-col gap-4">
          {reports.data?.items.map((r) => <ReportItem key={r.id} report={r} client={client} />)}
        </ul>
      </section>
      <section aria-labelledby="ing-h" className="mt-10">
        <h2 id="ing-h" className="text-2xl font-bold">{t('admin.ingestion')}</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {runs.data?.map((r) => (
            <li key={r.id} className="rounded-lg border-2 border-line bg-surface p-3">
              <span className="font-medium">{r.source}</span>, {r.status}, {formatDate(r.startedAt, lang)}
              {r.sourceVersion && <span className="block text-sm text-ink-soft">OSM: {r.sourceVersion}</span>}
              {r.stats && 'edges' in r.stats && (
                <span className="block text-sm text-ink-soft">
                  {String(r.stats.edges)} edges, {String(r.stats.edge_km)} km, {String(r.stats.components)} components
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  );
}

function ReportItem({ report, client }: { report: AdminReport; client: ReturnType<typeof adminApi> }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const announce = useAnnounce();
  const lang = currentLanguage();
  const [note, setNote] = useState('');
  const [extend, setExtend] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: (s: string) => client.setStatus(report.id, s, note, extend ? Number(extend) : undefined),
    onSuccess: (r) => {
      announce(t('admin.updated', { status: t(`admin.statuses.${r.status}`) }));
      void qc.invalidateQueries({ queryKey: ['admin-reports'] });
    },
  });
  const err = change.error instanceof ApiError ? change.error.code : null;

  return (
    <li className="rounded-lg border-2 border-line bg-surface p-4">
      <h3 className="text-lg font-bold">{t(`report.categories.${report.category}`)}: {t(`report.impacts.${report.impact}`)}</h3>
      <p className="text-sm text-ink-soft">
        {t('admin.reported', { date: formatDate(report.createdAt, lang) })}. {t('admin.confirmations', { count: report.confirmations })}.
        {report.expiresAt && ` ${formatDate(report.expiresAt, lang)}`}
      </p>
      {report.description && <p className="mt-2 whitespace-pre-wrap">{report.description}</p>}
      <p className="mt-2">
        <a className="underline" rel="noreferrer" target="_blank"
          href={`https://www.openstreetmap.org/?mlat=${report.lat}&mlon=${report.lon}#map=19/${report.lat}/${report.lon}`}>
          {t('admin.openMap')}
        </a>
      </p>
      {report.hasPhoto && (photo
        ? <img src={photo} alt={t('admin.photoAlt')} className="mt-2 max-h-64 rounded-lg" />
        : <Button className="mt-2" onClick={async () => setPhoto(await client.photo(report.id))}>{t('admin.loadPhoto')}</Button>)}
      <div className="mt-3 flex flex-col gap-2">
        <label htmlFor={`note-${report.id}`} className="text-sm font-medium">{t('admin.note')}</label>
        <input id={`note-${report.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
          className="min-h-11 rounded-lg border-2 border-line bg-surface px-3" />
        {report.temporary && (
          <>
            <label htmlFor={`ext-${report.id}`} className="text-sm font-medium">{t('admin.extendDays')}</label>
            <input id={`ext-${report.id}`} type="number" min={1} max={365} inputMode="numeric" value={extend}
              onChange={(e) => setExtend(e.target.value)} className="min-h-11 w-32 rounded-lg border-2 border-line bg-surface px-3" />
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {(NEXT[report.status] ?? []).map((s) => (
            <Button key={s} variant={s === 'VERIFIED' ? 'primary' : s === 'REJECTED' ? 'danger' : 'secondary'}
              disabled={change.isPending} onClick={() => change.mutate(s)}>
              {t(`admin.actions.${s}`)}
            </Button>
          ))}
        </div>
        {err && <ErrorBox>{t(`errors.${err}`, { defaultValue: t('errors.default') })}</ErrorBox>}
      </div>
    </li>
  );
}
