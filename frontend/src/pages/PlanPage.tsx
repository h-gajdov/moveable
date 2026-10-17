import type { TFunction } from 'i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUpDown, ChevronRight, Map as MapIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { ChosenLocation, LngLat, RouteRequest } from '../api/types';
import { useAnnounce } from '../components/Announcer';
import { Layout } from '../components/Layout';
import { LocationInput } from '../components/LocationInput';
import { MapSheet } from '../components/MapSheet';
import { ParkingSearch } from '../components/ParkingSearch';
import { MapView, type MapFocus } from '../components/MapView';
import { PreferencesEditor, ProfilePicker } from '../components/NeedsEditor';
import { RouteResults } from '../components/RouteResults';
import { Button, ErrorBox, Notice } from '../components/ui';
import { currentLanguage } from '../i18n';
import { pickName } from '../lib/format';
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

export function PlanPage() {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const { settings, updateRouting, updateUi } = useSettings();
  const trip = useTrip();
  const config = useAppConfig();
  const profiles = useProfiles();
  const [pickField, setPickField] = useState<'origin' | 'destination' | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  const needsRef = useRef<HTMLDetailsElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

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

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!trip.origin || !trip.destination) {
      setFormError(t('plan.missingPoints'));
      announce(t('plan.missingPoints'), 'assertive');
      return;
    }
    setFormError(null);
    route.mutate({
      origin: { lat: trip.origin.lat, lon: trip.origin.lon },
      destination: { lat: trip.destination.lat, lon: trip.destination.lon },
      profile: settings.routing.profile,
      preferences: settings.routing.overrides,
      alternatives: true,
    });
  }

  // Find routes as soon as both points are chosen (or changed), without a
  // separate button press. Points that were already routed are left alone, so
  // coming back from navigation keeps the current result.
  useEffect(() => {
    const o = trip.origin;
    const d = trip.destination;
    const last = trip.lastRequest;
    if (!o || !d) return;
    if (last && last.origin.lat === o.lat && last.origin.lon === o.lon
      && last.destination.lat === d.lat && last.destination.lon === d.lon) return;
    submit();
    // only point changes trigger a search; needs changes wait for "Find route"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.origin, trip.destination]);

  // "Change" opens the full form: start at the first field.
  useEffect(() => {
    if (editing) formRef.current?.querySelector('input')?.focus();
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
  // Once there is a route, the form folds into a short trip summary so the
  // map and the route choices fit on screen together.
  const showForm = editing || !trip.response || trip.response.routes.length === 0;

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
          <Button variant="tinted" aria-label={t('plan.editTripLabel')} onClick={() => setEditing(true)}>{t('plan.editTrip')}</Button>
        </div>
      )}
      {showForm && <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-6" aria-describedby={formError ? 'plan-error' : undefined}>
        <div className="card flex flex-col gap-3 p-4">
          <LocationInput
            label={t('plan.from')}
            value={trip.origin}
            onChange={trip.setOrigin}
            onPickOnMap={showMap ? () => togglePick('origin') : undefined}
            pickActive={pickField === 'origin'}
          />
          <div className="flex items-center gap-3">
            <div aria-hidden="true" className="h-px flex-1 bg-hairline" />
            <Button
              variant="secondary"
              onClick={() => {
                const o = trip.origin;
                trip.setOrigin(trip.destination);
                trip.setDestination(o);
              }}
              icon={<ArrowUpDown aria-hidden="true" className="size-4.5" />}
            >
              {t('plan.swap')}
            </Button>
            <div aria-hidden="true" className="h-px flex-1 bg-hairline" />
          </div>
          <LocationInput
            label={t('plan.to')}
            value={trip.destination}
            onChange={trip.setDestination}
            onPickOnMap={showMap ? () => togglePick('destination') : undefined}
            pickActive={pickField === 'destination'}
            allowGps={false}
          />
        </div>

        <section aria-labelledby="needs-h" className="flex flex-col gap-3">
          <h2 id="needs-h" className="px-1 text-[1.375rem]">{t('plan.needsTitle')}</h2>
          <ProfilePicker value={settings.routing.profile} onChange={(p) => updateRouting({ profile: p, overrides: {} })} />
          <details ref={needsRef} className="group card">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-card px-4 font-medium text-link [&::-webkit-details-marker]:hidden">
              {t('plan.adjust')}
              <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-90" />
            </summary>
            <div className="border-t border-hairline bg-canvas p-3 pb-4">
              <PreferencesEditor profile={profile} overrides={settings.routing.overrides}
                onChange={(o) => updateRouting({ overrides: o })} />
            </div>
          </details>
        </section>

        {formError && <p id="plan-error" className="px-1 font-medium text-issue">{formError}</p>}
        <div className="flex flex-col gap-2">
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={route.isPending}>
            {route.isPending ? t('plan.finding') : t('plan.findRoute')}
          </Button>
          {editing && trip.response && trip.response.routes.length > 0 && (
            <Button variant="quiet" className="w-full" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
          )}
        </div>
      </form>}

      {showForm && (
        <ParkingSearch center={center} origin={trip.origin} destination={trip.destination}
          onSelect={(location, field) => {
            (field === 'origin' ? trip.setOrigin : trip.setDestination)(location);
            if (trip.lastRequest) trip.setResult(trip.lastRequest, null);
            setFocus({ lngLat: [location.lon, location.lat], nonce: Date.now() });
          }} />
      )}

      {route.isPending && <p role="status" className="px-1 text-muted">{t('plan.finding')}</p>}
      {errorCode && !route.isPending && (
        <ErrorBox onRetry={() => submit()} retryLabel={t('common.retry')}>
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
            if (needsRef.current) {
              needsRef.current.open = true;
              needsRef.current.querySelector('summary')?.focus();
            }
          }}
        />
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
      />
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
    <Layout title={t('plan.title')} wide={showMap}>
      {showMap ? (
        <MapSheet map={mapPanel} mapLabel={t('common.mapRegion')} onMapFocus={revealMap} open={sheetOpen}
          onOpenChange={setSheetOpen} className="flex flex-col gap-6">
          {content}
        </MapSheet>
      ) : <div className="flex flex-col gap-6">{content}</div>}
    </Layout>
  );
}
