import type { TFunction } from 'i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUpDown, ChevronRight, Map as MapIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { ChosenLocation, LngLat, ParkingSpot, RouteRequest } from '../api/types';
import { useAnnounce } from '../components/Announcer';
import { Layout } from '../components/Layout';
import { LocationInput } from '../components/LocationInput';
import { MapSheet } from '../components/MapSheet';
import { MapView, type MapFocus } from '../components/MapView';
import { ParkingList, ParkingToggle, parkingLabel, useParking, type ParkingArea } from '../components/Parking';
import { PreferencesEditor, ProfilePicker } from '../components/NeedsEditor';
import { RouteResults } from '../components/RouteResults';
import { Button, ErrorBox, ErrorSummary, Footnote, Notice, StepHeading } from '../components/ui';
import { currentLanguage } from '../i18n';
import { pickName } from '../lib/format';
import { useVoiceCue, type VoiceCue } from '../lib/voiceCues';
import { prefersReducedMotion, useSettings } from '../settings/SettingsContext';
import { useTrip } from '../settings/TripContext';

export const SKOPJE_CENTER: LngLat = [21.4314, 41.9965];

export function useAppConfig() {
  return useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity, retry: 1 });
}

export function useProfiles() {
  return useQuery({ queryKey: ['profiles'], queryFn: api.profiles, staleTime: Infinity, retry: 1 });
}

/** Label a point chosen on the map with the nearest mapped street, if any. */
export async function labelForPoint(lat: number, lon: number, t: TFunction): Promise<ChosenLocation> {
  try {
    const r = await api.reverse(lat, lon);
    const name = r.street ? pickName(r.street.names, currentLanguage()) : undefined;
    if (name) return { lat, lon, label: t('plan.pointNear', { street: name }), source: 'map' };
  } catch {
    /* fall back to coordinates */
  }
  return { lat, lon, label: t('plan.pointAt', { lat: lat.toFixed(5), lon: lon.toFixed(5) }), source: 'map' };
}

const STEPS = ['origin', 'destination', 'needs', 'review'] as const;
type Step = (typeof STEPS)[number];
const REVIEW = STEPS.length - 1;
const STEP_LABELS: Record<Step, string> = {
  origin: 'plan.from', destination: 'plan.to', needs: 'plan.needsTitle', review: 'plan.reviewStep',
};

export function PlanPage() {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const { settings, updateRouting, updateUi } = useSettings();
  const trip = useTrip();
  const config = useAppConfig();
  const profiles = useProfiles();
  const [pickField, setPickField] = useState<'origin' | 'destination' | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  // A trip that already has both points opens on its summary.
  const [step, setStep] = useState(() => (trip.origin && trip.destination ? REVIEW : 0));
  // Set when a step is opened from the summary, so "Continue" goes straight back to it.
  const [fromReview, setFromReview] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [needsOpen, setNeedsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [mapView, setMapView] = useState<{ center: LngLat; radiusM: number } | null>(null);
  const stepRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const shownStep = useRef(step);

  const profile = profiles.data?.profiles.find((p) => p.code === settings.routing.profile);
  const route = useMutation({
    mutationFn: (req: RouteRequest) => api.route(req),
    onSuccess: (res, req) => {
      trip.setResult(req, res);
      setEditing(false);
      setSheetOpen(true);
      // Bring the map back to the top of the screen with the new route on it.
      document.getElementById('main')?.scrollTo?.({ top: 0 });
    },
    onError: (e) => announce(t(`errors.${e instanceof ApiError ? e.code : 'default'}`, { defaultValue: t('errors.default') }), 'assertive'),
  });

  function findRoute() {
    if (!trip.origin || !trip.destination) return;
    route.mutate({
      origin: { lat: trip.origin.lat, lon: trip.origin.lon },
      destination: { lat: trip.destination.lat, lon: trip.destination.lon },
      profile: settings.routing.profile,
      preferences: settings.routing.overrides,
      alternatives: true,
    });
  }

  function missing(s: Step): string | null {
    if (s === 'origin' && !trip.origin) return t('plan.needOrigin');
    if (s === 'destination' && !trip.destination) return t('plan.needDestination');
    return null;
  }

  function showErrors(errs: string[]) {
    setErrors(errs);
    if (errs.length) window.setTimeout(() => errorRef.current?.focus(), 0);
  }

  function goTo(next: number) {
    setErrors([]);
    setPickField(null);
    setSheetOpen(true);
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
    findRoute();
  }

  function back() {
    setFromReview(false);
    goTo(step - 1);
  }

  /** Open the form at a step, from the trip summary or the route results. */
  function edit(s: Step) {
    setEditing(true);
    setFromReview(s !== 'review');
    goTo(STEPS.indexOf(s));
  }

  // Once there is a route, the form folds into a short trip summary so the
  // map and the route choices fit on screen together.
  const hasRoutes = !!trip.response && trip.response.routes.length > 0;
  const showForm = editing || !hasRoutes || !trip.origin || !trip.destination;

  // While the trip is folded into its summary, points changed from outside the
  // form (such as a parking spot), or in a form that was then cancelled, find
  // new routes straight away. Points that were already routed are left alone,
  // so coming back from navigation keeps the current result.
  useEffect(() => {
    const o = trip.origin;
    const d = trip.destination;
    const last = trip.lastRequest;
    if (showForm || !o || !d) return;
    if (last && last.origin.lat === o.lat && last.origin.lon === o.lon
      && last.destination.lat === d.lat && last.destination.lon === d.lon) return;
    findRoute();
    // only point changes trigger a search; needs changes wait for "Find route"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.origin, trip.destination, showForm]);

  // Move focus to the step heading when the step changes or the form opens,
  // so keyboard and screen reader users start at its top.
  // Compared with the last step shown rather than skipping the first run, which
  // StrictMode repeats.
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    stepRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (editing) stepRef.current?.focus();
  }, [editing]);

  /** On phones the map sits above the sheet; scroll back up so it is in view. */
  function revealMap() {
    document.getElementById('main')?.scrollTo?.({ top: 0, behavior: prefersReducedMotion(settings.ui) ? 'auto' : 'smooth' });
  }

  function togglePick(field: 'origin' | 'destination') {
    const next = pickField === field ? null : field;
    setPickField(next);
    // Choosing on the map gets the whole screen; the sheet comes back after.
    setSheetOpen(!next);
  }

  async function onPick([lon, lat]: LngLat) {
    const field = pickField;
    setPickField(null);
    setSheetOpen(true);
    if (!field) return;
    const loc = await labelForPoint(lat, lon, t);
    (field === 'origin' ? trip.setOrigin : trip.setDestination)(loc);
    announce(t('plan.selected', { field: t(field === 'origin' ? 'plan.from' : 'plan.to'), label: loc.label }));
  }

  const center = config.data?.region.center ?? SKOPJE_CENTER;
  const routes = trip.response?.routes ?? [];
  const showMap = settings.ui.showMap;
  const errorCode = route.error instanceof ApiError ? route.error.code : route.error ? 'default' : null;
  const showParking = settings.ui.showParking;
  // With the map, parking follows what is on screen; without it, the chosen points.
  const near = trip.destination ?? trip.origin;
  const parkingArea: ParkingArea | null = showMap
    ? mapView && { ...mapView, label: t('parking.mapCenter') }
    : { center: near ? [near.lon, near.lat] : center, radiusM: 2000, label: near?.label ?? t('parking.center') };
  const parking = useParking(parkingArea, showParking);

  /** A parking spot or a named place tapped on the map becomes the start or destination. */
  function choosePlace(place: ChosenLocation, field: 'origin' | 'destination') {
    (field === 'origin' ? trip.setOrigin : trip.setDestination)(place);
    setFocus({ lngLat: [place.lon, place.lat], nonce: Date.now() });
    announce(t('plan.selected', { field: t(field === 'origin' ? 'plan.from' : 'plan.to'), label: place.label }));
  }

  function chooseParking(p: ParkingSpot, field: 'origin' | 'destination') {
    choosePlace({ lat: p.lat, lon: p.lon, label: parkingLabel(p, t('parking.unnamed')), source: 'search' }, field);
  }

  function showParkingOnMap(p: ParkingSpot) {
    setFocus({ lngLat: [p.lon, p.lat], nonce: Date.now() });
    setSheetOpen(false);
    revealMap();
  }

  function swap() {
    const o = trip.origin;
    trip.setOrigin(trip.destination);
    trip.setDestination(o);
  }

  const current = STEPS[step];
  const notGiven = <span className="text-muted">{t('common.notGiven')}</span>;
  const needsChanged = Object.keys(settings.routing.overrides).length > 0;
  const summary: { step: Step; label: string; value: React.ReactNode }[] = [
    { step: 'origin', label: t('plan.from'), value: trip.origin?.label ?? notGiven },
    { step: 'destination', label: t('plan.to'), value: trip.destination?.label ?? notGiven },
    {
      step: 'needs', label: t('plan.needsTitle'),
      value: (
        <>
          {t(`plan.profiles.${settings.routing.profile}.name`)}
          {needsChanged && <span className="block text-[0.875rem] font-normal text-muted">{t('prefs.changed')}</span>}
        </>
      ),
    },
  ];

  // Spoken hint for the next thing to choose (demo: only these steps have one).
  const cue: VoiceCue | null = pickField ? 'pickOnMap'
    : route.isPending ? null
    : !showForm ? 'chooseRoute'
    : current === 'origin' ? 'chooseStart'
    : current === 'destination' ? 'chooseDestination'
    : null;
  useVoiceCue(cue, currentLanguage(), settings.ui.voicePrompts);

  const content = (
    <>
      <h1 className={showForm ? 'large-title' : 'sr-only'}>{t('plan.title')}</h1>
      {!showForm && trip.origin && trip.destination && (
        <div className="card flex items-center gap-3 py-3 pl-4 pr-3">
          <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
            {([[trip.origin, 'A', 'plan.from'], [trip.destination, 'B', 'plan.to']] as const).map(([loc, letter, key]) => (
              <li key={letter} className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden="true" className={`grid size-6 shrink-0 place-items-center rounded-full border-2 border-ink font-display text-[0.75rem] font-semibold ${
                  letter === 'A' ? 'bg-card text-ink' : 'bg-ink text-card'}`}>{letter}</span>
                <span className="sr-only">{t(key)}: </span>
                <span className="truncate font-medium">{loc.label}</span>
              </li>
            ))}
            <li className="pl-[2.125rem] text-[0.875rem] text-muted">
              <span className="sr-only">{t('plan.profileLegend')}: </span>
              {t(`plan.profiles.${settings.routing.profile}.name`)}
            </li>
          </ul>
          <Button variant="tinted" aria-label={t('plan.editTripLabel')} onClick={() => edit('review')}>{t('plan.editTrip')}</Button>
        </div>
      )}
      {showForm && (
        <StepHeading ref={stepRef} step={step} total={STEPS.length}
          progress={t('common.stepOf', { n: step + 1, total: STEPS.length })}>
          {t(STEP_LABELS[current])}
        </StepHeading>
      )}
      {showForm && errors.length > 0 && <ErrorSummary ref={errorRef} title={t('common.errorSummary')} errors={errors} />}

      {/* Every step stays mounted and is hidden when inactive, so field state survives. */}
      {showForm && <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <div hidden={current !== 'origin'} className="card flex flex-col gap-3 p-4">
          <LocationInput
            label={t('plan.from')}
            value={trip.origin}
            onChange={trip.setOrigin}
            onPickOnMap={showMap ? () => togglePick('origin') : undefined}
            pickActive={pickField === 'origin'}
          />
        </div>

        <div hidden={current !== 'destination'} className="card flex flex-col gap-3 p-4">
          <LocationInput
            label={t('plan.to')}
            value={trip.destination}
            onChange={trip.setDestination}
            onPickOnMap={showMap ? () => togglePick('destination') : undefined}
            pickActive={pickField === 'destination'}
            allowGps={false}
          />
        </div>

        <div hidden={current !== 'needs'} className="flex flex-col gap-3">
          <ProfilePicker value={settings.routing.profile} onChange={(p) => updateRouting({ profile: p, overrides: {} })} />
          <details open={needsOpen} onToggle={(e) => setNeedsOpen(e.currentTarget.open)} className="group card">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-card px-4 font-medium text-link [&::-webkit-details-marker]:hidden">
              {t('plan.adjust')}
              <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-90" />
            </summary>
            <div className="border-t border-hairline bg-canvas p-3 pb-4">
              <PreferencesEditor profile={profile} overrides={settings.routing.overrides}
                onChange={(o) => updateRouting({ overrides: o })} />
            </div>
          </details>
        </div>

        {current === 'review' && (
          <div className="flex flex-col gap-4">
            <Footnote>{t('plan.reviewIntro')}</Footnote>
            <dl className="card rows px-4">
              {summary.map((row) => (
                <div key={row.step} className="py-3">
                  <dt className="text-[0.875rem] text-muted">{row.label}</dt>
                  <dd className="flex items-center gap-3">
                    <div className="min-w-0 flex-1 break-words font-medium">{row.value}</div>
                    <Button variant="quiet" className="-mr-2 shrink-0" onClick={() => edit(row.step)}
                      aria-label={`${t('common.change')}: ${row.label}`}>
                      {t('common.change')}
                    </Button>
                  </dd>
                </div>
              ))}
            </dl>
            <Button variant="secondary" className="self-start" onClick={swap}
              icon={<ArrowUpDown aria-hidden="true" className="size-4.5" />}>
              {t('plan.swap')}
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            {step > 0 && (
              <Button size="lg" className="sm:flex-1" onClick={back}>{t('common.back')}</Button>
            )}
            {step < REVIEW ? (
              <Button type="submit" variant="primary" size="lg" className="w-full sm:flex-[2]">
                {fromReview ? t('common.backToReview') : t('common.continue')}
              </Button>
            ) : (
              <Button type="submit" variant="primary" size="lg" className="w-full sm:flex-[2]" disabled={route.isPending}>
                {route.isPending ? t('plan.finding') : t('plan.findRoute')}
              </Button>
            )}
          </div>
          {editing && hasRoutes && (
            <Button variant="quiet" className="w-full" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
          )}
        </div>
      </form>}

      {route.isPending && <p role="status" className="px-1 text-muted">{t('plan.finding')}</p>}
      {errorCode && !route.isPending && (
        <ErrorBox onRetry={findRoute} retryLabel={t('common.retry')}>
          {t(`errors.${errorCode}`, { defaultValue: t('errors.default') })}
        </ErrorBox>
      )}
      {trip.response && !route.isPending && !editing && (
        <RouteResults
          response={trip.response}
          selectedId={trip.selectedId}
          onSelect={trip.select}
          onFocusLocation={showMap ? (l) => {
            setFocus({ lngLat: l, nonce: Date.now() });
            setSheetOpen(false);
          } : undefined}
          onAdjustNeeds={() => {
            setNeedsOpen(true);
            edit('needs');
          }}
        />
      )}
      {!showMap && <ParkingToggle className="self-start" />}
      {showParking && (
        <ParkingList area={parkingArea} query={parking} onSelect={chooseParking}
          onShowOnMap={showMap ? showParkingOnMap : undefined} />
      )}
      {!showMap && (
        <Notice className="flex-wrap items-center justify-between">
          <p>{t('common.mapHidden')}</p>
          <Button className="mt-2" variant="tinted" icon={<MapIcon aria-hidden="true" className="size-4.5" />}
            onClick={() => updateUi({ showMap: true })}>
            {t('common.showMap')}
          </Button>
        </Notice>
      )}
    </>
  );

  const mapPanel = (
    <>
      <MapView
        center={center}
        zoom={config.data?.region.zoom ?? 14}
        routes={routes}
        selectedId={trip.selectedId}
        origin={trip.origin}
        destination={trip.destination}
        pickLabel={pickField ? t(pickField === 'origin' ? 'plan.from' : 'plan.to') : null}
        onPick={onPick}
        onCancelPick={() => {
          setPickField(null);
          setSheetOpen(true);
        }}
        focus={focus}
        parking={showParking ? parking.data : null}
        onViewChange={setMapView}
        onPlaceSelect={choosePlace}
      />
      {!pickField && (
        <div className="absolute left-2.5 top-2.5">
          <ParkingToggle />
        </div>
      )}
      {!pickField && (
        <div className="absolute right-16 top-2.5">
          <Button variant="secondary" className="glass bg-[var(--c-glass)]!" icon={<MapIcon aria-hidden="true" className="size-4.5" />}
            onClick={() => updateUi({ showMap: false })}>
            {t('common.hideMap')}
          </Button>
        </div>
      )}
    </>
  );

  return (
    <Layout title={showForm ? `${t(STEP_LABELS[current])} · ${t('plan.title')}` : t('plan.title')} wide={showMap}>
      {showMap ? (
        <MapSheet map={mapPanel} mapLabel={t('common.mapRegion')} onMapFocus={revealMap} open={sheetOpen}
          onOpenChange={setSheetOpen} className="flex flex-col gap-6">
          {content}
        </MapSheet>
      ) : <div className="flex flex-col gap-6">{content}</div>}
    </Layout>
  );
}
