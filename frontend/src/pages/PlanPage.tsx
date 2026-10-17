import type { TFunction } from 'i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUpDown, ChevronRight, Map as MapIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { ChosenLocation, LngLat, RouteRequest } from '../api/types';
import { useAnnounce } from '../components/Announcer';
import { Layout } from '../components/Layout';
import { LocationInput } from '../components/LocationInput';
import { MapView, type MapFocus } from '../components/MapView';
import { PreferencesEditor, ProfilePicker } from '../components/NeedsEditor';
import { RouteResults } from '../components/RouteResults';
import { Button, ErrorBox, Notice } from '../components/ui';
import { currentLanguage } from '../i18n';
import { pickName } from '../lib/format';
import { useSettings } from '../settings/SettingsContext';
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
  const needsRef = useRef<HTMLDetailsElement>(null);
  const mapSectionRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const profile = profiles.data?.profiles.find((p) => p.code === settings.routing.profile);
  const route = useMutation({
    mutationFn: (req: RouteRequest) => api.route(req),
    onSuccess: (res, req) => trip.setResult(req, res),
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

  async function onPick([lon, lat]: LngLat) {
    const field = pickField;
    setPickField(null);
    if (!field) return;
    const loc = await labelForPoint(lat, lon, t);
    (field === 'origin' ? trip.setOrigin : trip.setDestination)(loc);
    announce(t('plan.selected', { field: t(field === 'origin' ? 'plan.from' : 'plan.to'), label: loc.label }));
  }

  const center = config.data?.region.center ?? SKOPJE_CENTER;
  const routes = trip.response?.routes ?? [];
  const showMap = settings.ui.showMap;
  const errorCode = route.error instanceof ApiError ? route.error.code : route.error ? 'default' : null;

  return (
    <Layout title={t('plan.title')} wide={showMap}>
      <div className={showMap ? 'lg:absolute lg:inset-0' : ''}>
        <div
          ref={panelRef}
          className={showMap
            ? 'panel-scroll flex flex-col gap-6 px-4 py-6 sm:px-6 lg:absolute lg:bottom-4 lg:left-4 lg:top-4 lg:z-10 lg:w-[30rem] lg:overflow-y-auto lg:rounded-panel lg:glass lg:px-6'
            : 'flex flex-col gap-6'}
        >
          <h1 className="text-[2rem] sm:text-[2.25rem]">{t('plan.title')}</h1>
          <form onSubmit={submit} noValidate className="flex flex-col gap-6" aria-describedby={formError ? 'plan-error' : undefined}>
            <div className="card flex flex-col gap-3 p-4">
              <LocationInput
                label={t('plan.from')}
                value={trip.origin}
                onChange={trip.setOrigin}
                onPickOnMap={showMap ? () => setPickField(pickField === 'origin' ? null : 'origin') : undefined}
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
                onPickOnMap={showMap ? () => setPickField(pickField === 'destination' ? null : 'destination') : undefined}
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
                <div className="border-t border-hairline bg-canvas p-3 pb-4 sm:p-4">
                  <PreferencesEditor profile={profile} overrides={settings.routing.overrides}
                    onChange={(o) => updateRouting({ overrides: o })} />
                </div>
              </details>
            </section>

            {formError && <p id="plan-error" className="px-1 font-medium text-issue">{formError}</p>}
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={route.isPending}>
              {route.isPending ? t('plan.finding') : t('plan.findRoute')}
            </Button>
          </form>

          {route.isPending && <p role="status" className="px-1 text-muted">{t('plan.finding')}</p>}
          {errorCode && !route.isPending && (
            <ErrorBox onRetry={() => submit()} retryLabel={t('common.retry')}>
              {t(`errors.${errorCode}`, { defaultValue: t('errors.default') })}
            </ErrorBox>
          )}
          {trip.response && !route.isPending && (
            <RouteResults
              response={trip.response}
              selectedId={trip.selectedId}
              onSelect={trip.select}
              onFocusLocation={showMap ? (l) => {
                setFocus({ lngLat: l, nonce: Date.now() });
                mapSectionRef.current?.scrollIntoView({ block: 'nearest' });
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
        </div>

        {showMap && (
          <section
            ref={mapSectionRef}
            aria-label={t('common.mapRegion')}
            className="relative mx-4 mb-6 h-[60vh] overflow-hidden rounded-panel card sm:mx-6 lg:absolute lg:inset-0 lg:m-0 lg:h-auto lg:rounded-none"
          >
            <MapView
              center={center}
              zoom={config.data?.region.zoom ?? 14}
              routes={routes}
              selectedId={trip.selectedId}
              origin={trip.origin}
              destination={trip.destination}
              pickLabel={pickField ? t(pickField === 'origin' ? 'plan.from' : 'plan.to') : null}
              onPick={onPick}
              onCancelPick={() => setPickField(null)}
              focus={focus}
              obstruct={panelRef}
            />
            {!pickField && (
              <div className="absolute right-16 top-2.5">
                <Button variant="secondary" className="glass bg-[var(--c-glass)]!" icon={<MapIcon aria-hidden="true" className="size-4.5" />}
                  onClick={() => updateUi({ showMap: false })}>
                  {t('common.hideMap')}
                </Button>
              </div>
            )}
          </section>
        )}
      </div>
    </Layout>
  );
}
