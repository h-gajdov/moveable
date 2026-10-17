import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { ChosenLocation, LngLat } from '../api/types';
import { useAnnounce } from '../components/Announcer';
import { Layout } from '../components/Layout';
import { LocationInput } from '../components/LocationInput';
import { MapView } from '../components/MapView';
import { Button, Checkbox, ErrorBox, RadioGroup, Select } from '../components/ui';
import { currentLanguage } from '../i18n';
import { useSettings } from '../settings/SettingsContext';
import { labelForPoint, SKOPJE_CENTER, useAppConfig } from './PlanPage';

const CATEGORIES = ['MISSING_RAMP', 'HIGH_KERB', 'BROKEN_SIDEWALK', 'STAIRS', 'BLOCKED_PATH', 'PARKED_VEHICLES',
  'CONSTRUCTION', 'MISSING_TACTILE_PAVING', 'UNSAFE_CROSSING', 'OTHER'];
const IMPACTS = ['IMPASSABLE', 'DIFFICULT', 'MINOR'];
const TEMPORARY_DEFAULT: Record<string, number> = { PARKED_VEHICLES: 1, BLOCKED_PATH: 7, CONSTRUCTION: 30 };

export function ReportPage() {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const { settings } = useSettings();
  const config = useAppConfig();
  const [location, setLocation] = useState<ChosenLocation | null>(null);
  const [category, setCategory] = useState<string | undefined>();
  const [impact, setImpact] = useState<string | undefined>();
  const [temporary, setTemporary] = useState(false);
  const [days, setDays] = useState('7');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const submit = useMutation({
    mutationFn: () => api.report({
      lat: location!.lat, lon: location!.lon, category: category!, impact: impact!,
      description: description.trim() || undefined, temporary, durationDays: temporary ? Number(days) : undefined,
      language: currentLanguage(), website: website || undefined,
    }, photo),
    onSuccess: () => {
      announce(t('report.success'));
      window.setTimeout(() => successRef.current?.focus(), 0);
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = [
      !location && t('report.needLocation'),
      !category && t('report.needCategory'),
      !impact && t('report.needImpact'),
    ].filter(Boolean) as string[];
    setErrors(errs);
    if (errs.length) {
      window.setTimeout(() => errorRef.current?.focus(), 0);
      return;
    }
    submit.mutate();
  }

  function reset() {
    setLocation(null); setCategory(undefined); setImpact(undefined); setTemporary(false);
    setDescription(''); setPhoto(null); setErrors([]); submit.reset();
  }

  async function onPick([lon, lat]: LngLat) {
    setPicking(false);
    const loc = await labelForPoint(lat, lon, t);
    setLocation(loc);
    announce(t('plan.selected', { field: t('report.location'), label: loc.label }));
  }

  if (submit.isSuccess) {
    return (
      <Layout title={t('report.success')}>
        <h1 ref={successRef} tabIndex={-1} className="text-3xl font-bold">{t('report.success')}</h1>
        <p className="mt-3">{t('report.successBody')}</p>
        <Button className="mt-4" onClick={reset}>{t('report.another')}</Button>
      </Layout>
    );
  }

  const apiError = submit.error instanceof ApiError ? submit.error.code : submit.error ? 'default' : null;

  return (
    <Layout title={t('report.title')}>
      <h1 className="text-3xl font-bold">{t('report.title')}</h1>
      <p className="mt-2">{t('report.intro')}</p>

      {errors.length > 0 && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-lg border-2 border-issue p-4">
          <p className="font-bold">{t('report.errorSummary')}</p>
          <ul className="mt-1 list-disc pl-6">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <LocationInput label={t('report.location')} value={location} onChange={setLocation}
            onPickOnMap={settings.ui.showMap ? () => setPicking((p) => !p) : undefined} pickActive={picking} />
          {settings.ui.showMap && picking && (
            <div className="h-80 overflow-hidden rounded-lg border-2 border-line">
              <MapView center={config.data?.region.center ?? SKOPJE_CENTER} zoom={16} routes={[]} selectedId={null}
                origin={location} destination={null} pickLabel={t('report.location')} onPick={onPick}
                onCancelPick={() => setPicking(false)} />
            </div>
          )}
        </div>

        <RadioGroup legend={t('report.category')} name="category" value={category}
          onChange={(c) => {
            setCategory(c);
            if (TEMPORARY_DEFAULT[c]) {
              setTemporary(true);
              setDays(String(TEMPORARY_DEFAULT[c]));
            }
          }}
          options={CATEGORIES.map((c) => ({ value: c, label: t(`report.categories.${c}`) }))} />

        <RadioGroup legend={t('report.impact')} name="impact" value={impact} onChange={setImpact}
          options={IMPACTS.map((c) => ({ value: c, label: t(`report.impacts.${c}`) }))} />

        <div>
          <Checkbox label={t('report.temporary')} checked={temporary} onChange={setTemporary} />
          {temporary && (
            <Select label={t('report.duration')} value={days} onChange={setDays}
              options={[1, 3, 7, 14, 30, 60, 90].map((d) => ({ value: String(d), label: t('report.days', { count: d }) }))} />
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="desc" className="font-display text-lg font-semibold">
            {t('report.description')} <span className="font-sans text-sm font-normal text-ink-soft">({t('common.optional')})</span>
          </label>
          <p id="desc-hint" className="text-sm text-ink-soft">{t('report.descriptionHint')}</p>
          <textarea id="desc" rows={4} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)}
            aria-describedby="desc-hint desc-count"
            className="rounded-lg border-2 border-line bg-surface p-3 text-ink" />
          <p id="desc-count" className="text-sm text-ink-soft">{t('report.chars', { count: description.length })}</p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="photo" className="font-display text-lg font-semibold">
            {t('report.photo')} <span className="font-sans text-sm font-normal text-ink-soft">({t('common.optional')})</span>
          </label>
          <p id="photo-hint" className="text-sm text-ink-soft">{t('report.photoHint')}</p>
          <input id="photo" type="file" accept="image/jpeg,image/png" aria-describedby="photo-hint"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            className="min-h-11 file:mr-3 file:min-h-11 file:rounded-lg file:border-2 file:border-line file:bg-surface file:px-4 file:text-ink" />
          {preview && (
            <div className="mt-2 flex items-start gap-3">
              <img src={preview} alt={t('report.photoPreview')} className="max-h-40 rounded-lg border-2 border-line" />
              <Button variant="quiet" onClick={() => setPhoto(null)}>{t('report.photoRemove')}</Button>
            </div>
          )}
        </div>

        {/* Honeypot for bots: hidden from people and assistive technology. */}
        <div aria-hidden="true" className="absolute -left-[9999px]">
          <label htmlFor="website">{t('report.website')}</label>
          <input id="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>

        <p className="text-sm text-ink-soft">{t('report.privacy')}</p>
        {apiError && <ErrorBox>{t(`errors.${apiError}`, { defaultValue: t('errors.default') })}</ErrorBox>}
        <Button type="submit" variant="primary" className="min-h-14 text-lg" disabled={submit.isPending}>
          {submit.isPending ? t('report.submitting') : t('report.submit')}
        </Button>
      </form>
    </Layout>
  );
}
