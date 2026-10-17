import { useMutation } from '@tanstack/react-query';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { ChosenLocation, LngLat } from '../api/types';
import { useAnnounce } from '../components/Announcer';
import { Layout } from '../components/Layout';
import { LocationInput } from '../components/LocationInput';
import { MapView } from '../components/MapView';
import { Button, Checkbox, ErrorBox, Footnote, Group, PageTitle, RadioGroup, Select } from '../components/ui';
import { currentLanguage } from '../i18n';
import { useSettings } from '../settings/SettingsContext';
import { labelForPoint, SKOPJE_CENTER, useAppConfig } from './PlanPage';

const CATEGORIES = ['MISSING_RAMP', 'HIGH_KERB', 'BROKEN_SIDEWALK', 'STAIRS', 'BLOCKED_PATH', 'PARKED_VEHICLES',
  'CONSTRUCTION', 'MISSING_TACTILE_PAVING', 'UNSAFE_CROSSING', 'OTHER'];
const IMPACTS = ['IMPASSABLE', 'DIFFICULT', 'MINOR'];
const TEMPORARY_DEFAULT: Record<string, number> = { PARKED_VEHICLES: 1, BLOCKED_PATH: 7, CONSTRUCTION: 30 };
const STEPS = ['location', 'category', 'impact', 'details', 'review'] as const;
type Step = (typeof STEPS)[number];
const REVIEW = STEPS.length - 1;

export function ReportPage() {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const { settings } = useSettings();
  const config = useAppConfig();
  const [step, setStep] = useState(0);
  // Set when a step is opened from the summary, so "Continue" goes straight back to it.
  const [fromReview, setFromReview] = useState(false);
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
  const stepRef = useRef<HTMLHeadingElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  // Move focus to the new step's heading so keyboard and screen reader users start at its top.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stepRef.current?.focus();
  }, [step]);

  const submit = useMutation({
    mutationFn: () => api.report({
      lat: location!.lat, lon: location!.lon, category: category!, impact: impact!,
      description: description.trim() || undefined, temporary, durationDays: temporary ? Number(days) : undefined,
      language: currentLanguage(), website: website || undefined,
    }, photo),
    onSuccess: () => announce(t('report.success')),
  });

  useEffect(() => {
    if (submit.isSuccess) successRef.current?.focus();
  }, [submit.isSuccess]);

  function missing(s: Step): string | null {
    if (s === 'location' && !location) return t('report.needLocation');
    if (s === 'category' && !category) return t('report.needCategory');
    if (s === 'impact' && !impact) return t('report.needImpact');
    return null;
  }

  function showErrors(errs: string[]) {
    setErrors(errs);
    if (errs.length) window.setTimeout(() => errorRef.current?.focus(), 0);
  }

  function goTo(next: number) {
    setErrors([]);
    setPicking(false);
    setStep(next);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step < REVIEW) {
      const err = missing(STEPS[step]);
      if (err) return showErrors([err]);
      goTo(fromReview ? REVIEW : step + 1);
      setFromReview(false);
      return;
    }
    // Every required step is checked again in case the summary was reached with gaps.
    const gap = STEPS.findIndex((s) => missing(s));
    if (gap >= 0) {
      goTo(gap);
      showErrors([missing(STEPS[gap])!]);
      return;
    }
    submit.mutate();
  }

  function back() {
    setFromReview(false);
    goTo(step - 1);
  }

  function change(s: Step) {
    setFromReview(true);
    goTo(STEPS.indexOf(s));
  }

  function removePhoto() {
    setPhoto(null);
    if (photoRef.current) {
      photoRef.current.value = '';
      photoRef.current.focus();
    }
  }

  function reset() {
    setLocation(null); setCategory(undefined); setImpact(undefined); setTemporary(false);
    setDescription(''); setPhoto(null); setErrors([]); setFromReview(false); submit.reset();
    firstRender.current = true;
    setStep(0);
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
        <div className="card flex flex-col items-center px-6 py-10 text-center">
          <CircleCheck aria-hidden="true" className="size-14 text-ok" strokeWidth={1.5} />
          <h1 ref={successRef} tabIndex={-1} className="mt-4 text-[2rem]">{t('report.success')}</h1>
          <p className="mt-2 max-w-[48ch] text-muted">{t('report.successBody')}</p>
          <Button className="mt-6" variant="tinted" onClick={reset}>{t('report.another')}</Button>
        </div>
      </Layout>
    );
  }

  const apiError = submit.error instanceof ApiError ? submit.error.code : submit.error ? 'default' : null;
  const fieldLabel = 'px-1 font-display text-[1.0625rem] font-semibold';
  const optional = <span className="font-sans text-[0.875rem] font-normal text-muted">({t('common.optional')})</span>;
  const current = STEPS[step];
  const notGiven = <span className="text-muted">{t('report.notGiven')}</span>;
  const summary: { step: Step; label: string; value: React.ReactNode }[] = [
    { step: 'location', label: t('report.steps.location'), value: location?.label ?? notGiven },
    { step: 'category', label: t('report.steps.category'), value: category ? t(`report.categories.${category}`) : notGiven },
    { step: 'impact', label: t('report.steps.impact'), value: impact ? t(`report.impacts.${impact}`) : notGiven },
    {
      step: 'impact', label: t('report.reviewDuration'),
      value: temporary ? t('report.temporaryFor', { duration: t('report.days', { count: Number(days) }) }) : t('report.notTemporary'),
    },
    { step: 'details', label: t('report.description'), value: description.trim() || notGiven },
    {
      step: 'details', label: t('report.photo'),
      value: preview ? <img src={preview} alt={t('report.photoPreview')} className="max-h-28 rounded-[10px]" /> : notGiven,
    },
  ];

  return (
    <Layout title={`${t(`report.steps.${current}`)} · ${t('report.title')}`}>
      <PageTitle subtitle={step === 0 ? t('report.intro') : undefined}>{t('report.title')}</PageTitle>

      <div className="mb-6">
        <div aria-hidden="true" className="mb-3 flex gap-1.5">
          {STEPS.map((s, i) => (
            <span key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? 'bg-accent' : 'bg-fill-strong'}`} />
          ))}
        </div>
        <h2 ref={stepRef} tabIndex={-1} className="px-1 text-[1.25rem]">
          <span className="block font-sans text-[0.875rem] font-normal text-muted">
            {t('report.stepOf', { n: step + 1, total: STEPS.length })}
          </span>
          {t(`report.steps.${current}`)}
        </h2>
      </div>

      {errors.length > 0 && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="card mb-6 flex gap-3 p-4 ring-[length:var(--hair)] ring-issue">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-issue" />
          <div>
            <p className="font-semibold">{t('report.errorSummary')}</p>
            <ul className="mt-1 list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        </div>
      )}

      {/* Every step stays mounted and is hidden when inactive, so field state (including the chosen file) survives. */}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
        <div hidden={current !== 'location'} className="card flex flex-col gap-3 p-4">
          <LocationInput label={t('report.location')} value={location} onChange={setLocation}
            onPickOnMap={settings.ui.showMap ? () => setPicking((p) => !p) : undefined} pickActive={picking} />
          {settings.ui.showMap && picking && (
            <div className="h-80 overflow-hidden rounded-[14px]">
              <MapView center={config.data?.region.center ?? SKOPJE_CENTER} zoom={16} routes={[]} selectedId={null}
                origin={location} destination={null} pickLabel={t('report.location')} onPick={onPick}
                onCancelPick={() => setPicking(false)} />
            </div>
          )}
        </div>

        <div hidden={current !== 'category'}>
          <RadioGroup legend={t('report.category')} name="category" value={category}
            onChange={(c) => {
              setCategory(c);
              if (TEMPORARY_DEFAULT[c]) {
                setTemporary(true);
                setDays(String(TEMPORARY_DEFAULT[c]));
              }
            }}
            options={CATEGORIES.map((c) => ({ value: c, label: t(`report.categories.${c}`) }))} />
        </div>

        <div hidden={current !== 'impact'} className="flex flex-col gap-8">
          <RadioGroup legend={t('report.impact')} name="impact" value={impact} onChange={setImpact}
            options={IMPACTS.map((c) => ({ value: c, label: t(`report.impacts.${c}`) }))} />

          <Group>
            <Checkbox label={t('report.temporary')} checked={temporary} onChange={setTemporary} />
            {temporary && (
              <Select label={t('report.duration')} value={days} onChange={setDays}
                options={[1, 3, 7, 14, 30, 60, 90].map((d) => ({ value: String(d), label: t('report.days', { count: d }) }))} />
            )}
          </Group>
        </div>

        <div hidden={current !== 'details'} className="flex flex-col gap-8">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="desc" className={fieldLabel}>{t('report.description')} {optional}</label>
            <Footnote id="desc-hint">{t('report.descriptionHint')}</Footnote>
            <textarea id="desc" rows={4} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)}
              aria-describedby="desc-hint desc-count"
              className="field p-3.5" />
            <Footnote id="desc-count" className="text-right">{t('report.chars', { count: description.length })}</Footnote>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="photo" className={fieldLabel}>{t('report.photo')} {optional}</label>
            <Footnote id="photo-hint">{t('report.photoHint')}</Footnote>
            <input ref={photoRef} id="photo" type="file" accept="image/jpeg,image/png" aria-describedby="photo-hint"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              className="min-h-11 max-w-full text-[0.9375rem] text-muted file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-pill file:border-0 file:bg-tint file:px-5 file:font-medium file:text-link hover:file:bg-fill" />
            {preview && (
              <div className="mt-2 flex flex-wrap items-start gap-3">
                <img src={preview} alt={t('report.photoPreview')} className="max-h-40 rounded-[14px]" />
                <Button variant="quiet" onClick={removePhoto}>{t('report.photoRemove')}</Button>
              </div>
            )}
          </div>
        </div>

        {current === 'review' && (
          <div className="flex flex-col gap-4">
            <Footnote>{t('report.reviewIntro')}</Footnote>
            <dl className="card rows px-4">
              {summary.map((row) => (
                <div key={row.label} className="py-3">
                  <dt className="text-[0.875rem] text-muted">{row.label}</dt>
                  <dd className="flex items-center gap-3">
                    <div className="min-w-0 flex-1 break-words font-medium">{row.value}</div>
                    <Button variant="quiet" className="-mr-2 shrink-0" onClick={() => change(row.step)}
                      aria-label={`${t('report.change')}: ${row.label}`}>
                      {t('report.change')}
                    </Button>
                  </dd>
                </div>
              ))}
            </dl>
            <Footnote>{t('report.privacy')}</Footnote>
            {apiError && <ErrorBox>{t(`errors.${apiError}`, { defaultValue: t('errors.default') })}</ErrorBox>}
          </div>
        )}

        {/* Honeypot for bots: hidden from people and assistive technology. */}
        <div aria-hidden="true" className="absolute -left-[9999px]">
          <label htmlFor="website">{t('report.website')}</label>
          <input id="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          {step > 0 && (
            <Button size="lg" className="sm:flex-1" onClick={back}>{t('common.back')}</Button>
          )}
          {step < REVIEW ? (
            <Button type="submit" variant="primary" size="lg" className="w-full sm:flex-[2]">
              {fromReview ? t('report.backToReview') : t('report.next')}
            </Button>
          ) : (
            <Button type="submit" variant="primary" size="lg" className="w-full sm:flex-[2]" disabled={submit.isPending}>
              {submit.isPending ? t('report.submitting') : t('report.submit')}
            </Button>
          )}
        </div>
      </form>
    </Layout>
  );
}
