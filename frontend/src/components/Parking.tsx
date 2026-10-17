import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Accessibility, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { LngLat, ParkingSpot } from '../api/types';
import { currentLanguage } from '../i18n';
import { formatDistance, pickName } from '../lib/format';
import { useSettings } from '../settings/SettingsContext';
import { useAnnounce } from './Announcer';
import { Button, ErrorBox } from './ui';

/** Where to look for parking: the map view, or a chosen point when the map is hidden. */
export interface ParkingArea {
  center: LngLat;
  radiusM: number;
  /** Shown in "near …" messages. */
  label: string;
}

/** Mapped disabled parking around an area, nearest first (the API caps it at 50). */
export function useParking(area: ParkingArea | null, enabled: boolean) {
  // Rounded so small pans reuse the last result instead of refetching.
  const lat = area ? Number(area.center[1].toFixed(4)) : 0;
  const lon = area ? Number(area.center[0].toFixed(4)) : 0;
  const radiusM = area ? Math.min(10_000, Math.max(100, Math.ceil(area.radiusM / 100) * 100)) : 0;
  return useQuery({
    queryKey: ['parking', lat, lon, radiusM],
    queryFn: ({ signal }) => api.parking(lat, lon, radiusM, signal),
    enabled: enabled && area !== null,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function parkingLabel(p: ParkingSpot, unnamed: string) {
  return pickName(p.names, currentLanguage()) || unnamed;
}

/**
 * Small round on/off button for the disabled parking layer (on the map, or in
 * the page when the map is hidden). Icon only; the name comes from aria-label.
 * "On" is shown by fill plus a check badge, and announced through aria-pressed.
 */
export function ParkingToggle({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const { settings, updateUi } = useSettings();
  const on = settings.ui.showParking;
  return (
    <Button
      variant={on ? 'primary' : 'secondary'}
      aria-pressed={on}
      aria-label={t('parking.toggle')}
      title={t('parking.toggle')}
      className={`relative size-11 px-0! ${on ? '' : 'glass bg-[var(--c-glass)]!'} ${className}`}
      onClick={() => {
        updateUi({ showParking: !on });
        announce(t(on ? 'parking.hidden' : 'parking.shown'));
      }}
    >
      <Accessibility aria-hidden="true" className="size-5" />
      {on && (
        <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 grid size-4.5 place-items-center rounded-full border-2 border-card bg-ink text-card">
          <Check className="size-2.5" strokeWidth={4} />
        </span>
      )}
    </Button>
  );
}

/** Text version of the parking layer: everything drawn on the map is listed here too. */
export function ParkingList({ area, query, onSelect, onShowOnMap }: {
  area: ParkingArea | null;
  query: ReturnType<typeof useParking>;
  onSelect: (spot: ParkingSpot, field: 'origin' | 'destination') => void;
  onShowOnMap?: (p: ParkingSpot) => void;
}) {
  const { t } = useTranslation();
  const spots = query.data ?? [];
  return (
    <section aria-labelledby="parking-heading" className="card flex flex-col gap-3 p-4">
      <h2 id="parking-heading" className="text-[1.375rem]">{t('parking.title')}</h2>
      <p className="text-[0.875rem] text-muted">{t('parking.notice')}</p>
      <div role="status">
        {query.isFetching && !query.isPlaceholderData ? t('parking.loading') : area && query.isSuccess
          ? <>
            {t(spots.length ? 'parking.results' : 'parking.empty', { count: spots.length, label: area.label })}
            {!spots.length && onShowOnMap && <> {t('parking.emptyMapHint')}</>}
          </>
          : ''}
      </div>
      {query.isError && (
        <ErrorBox onRetry={() => void query.refetch()} retryLabel={t('common.retry')}>
          {t(`errors.${query.error instanceof ApiError ? query.error.code : 'default'}`, { defaultValue: t('errors.default') })}
        </ErrorBox>
      )}
      {!query.isError && spots.length > 0 && (
        <ul className="flex flex-col">
          {spots.map((p) => (
            <li key={p.id} className="border-t border-hairline py-3">
              <h3 className="font-semibold">{parkingLabel(p, t('parking.unnamed'))}</h3>
              <p className="text-[0.875rem] text-muted">
                {t('parking.distance', { distance: formatDistance(p.distanceM, currentLanguage()), label: area?.label })}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="tinted" onClick={() => onSelect(p, 'origin')}>{t('parking.useOrigin')}</Button>
                <Button variant="tinted" onClick={() => onSelect(p, 'destination')}>{t('parking.useDestination')}</Button>
                {onShowOnMap && <Button variant="quiet" onClick={() => onShowOnMap(p)}>{t('parking.showOnMap')}</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
