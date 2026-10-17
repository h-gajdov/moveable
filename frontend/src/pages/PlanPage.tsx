import type { TFunction } from 'i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUpDown, Map as MapIcon } from 'lucide-react';
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
import { Button, ErrorBox } from '../components/ui';
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
    <Layout title={t('plan.title')} wide>
      <div className={`grid ${showMap ? 'lg:grid-cols-[minmax(24rem,30rem)_1fr]' : ''}`}>
        <div className="flex flex-col gap-6 px-4 py-6">
          <h1 className="text-3xl font-bold">{t('plan.title')}</h1>
          <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-describedby={formError ? 'plan-error' : undefined}>
            <LocationInput
              label={t('plan.from')}
              value={trip.origin}
              onChange={trip.setOrigin}
              onPickOnMap={showMap ? () => setPickField(pickField === 'origin' ? null : 'origin') : undefined}
              pickActive={pickField === 'origin'}
            />
            <div>
              <Button
                variant="quiet"
                onClick={() => {
                  const o = trip.origin;
                  trip.setOrigin(trip.destination);
                  trip.setDestination(o);
                }}
                icon={<ArrowUpDown aria-hidden="true" className="size-5" />}
              >
                {t('plan.swap')}
              </Button>
            </div>
            <LocationInput
              label={t('plan.to')}
              value={trip.destination}
              onChange={trip.setDestination}
              onPickOnMap={showMap ? () => setPickField(pickField === 'destination' ? null : 'destination') : undefined}
              pickActive={pickField === 'destination'}
              allowGps={false}
            />

            <section aria-labelledby="needs-h" className="flex flex-col gap-3 border-t-2 border-line pt-4">
              <h2 id="needs-h" className="text-2xl font-bold">{t('plan.needsTitle')}</h2>
              <ProfilePicker value={settings.routing.profile} onChange={(p) => updateRouting({ profile: p, overrides: {} })} />
              <details ref={needsRef} className="rounded-lg border-2 border-line bg-surface">
                <summary className="min-h-11 cursor-pointer content-center px-4 font-medium">{t('plan.adjust')}</summary>
                <div className="px-4 pb-4">
                  <PreferencesEditor profile={profile} overrides={settings.routing.overrides}
                    onChange={(o) => updateRouting({ overrides: o })} />
                </div>
              </details>
            </section>

            {formError && <p id="plan-error" className="font-medium text-issue">{formError}</p>}
            <Button type="submit" variant="primary" className="min-h-14 text-lg" disabled={route.isPending}>
              {route.isPending ? t('plan.finding') : t('plan.findRoute')}
            </Button>
          </form>

          {route.isPending && <p role="status">{t('plan.finding')}</p>}
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
        </div>

        {showMap ? (
          <section ref={mapSectionRef} aria-label={t('common.mapRegion')} className="relative h-[55vh] lg:sticky lg:top-0 lg:h-dvh">
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
            />
            <div className="absolute right-14 top-2">
              <Button variant="secondary" className="shadow" icon={<MapIcon aria-hidden="true" className="size-5" />}
                onClick={() => updateUi({ showMap: false })}>
                {t('common.hideMap')}
              </Button>
            </div>
          </section>
        ) : (
          <div className="px-4 pb-6">
            <p className="text-ink-soft">{t('common.mapHidden')}</p>
            <Button className="mt-2" onClick={() => updateUi({ showMap: true })}>{t('common.showMap')}</Button>
          </div>
        )}
      </div>
    </Layout>
  );
}
