import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { ChosenLocation, LngLat } from '../api/types';
import { currentLanguage } from '../i18n';
import { formatDistance, pickName } from '../lib/format';
import { useAnnounce } from './Announcer';
import { Button, ErrorBox } from './ui';

export function ParkingSearch({ center, origin, destination, onSelect }: {
  center: LngLat;
  origin: ChosenLocation | null;
  destination: ChosenLocation | null;
  onSelect: (location: ChosenLocation, field: 'origin' | 'destination') => void;
}) {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const [near, setNear] = useState<'origin' | 'destination' | 'center'>('destination');
  const [search, setSearch] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const point = near === 'origin' ? origin : near === 'destination' ? destination :
    { lat: center[1], lon: center[0], label: t('parking.center') };
  const results = useQuery({
    queryKey: ['parking', search?.lat, search?.lon],
    queryFn: ({ signal }) => api.parking(search!.lat, search!.lon, signal),
    enabled: search !== null,
    retry: 1,
  });
  function choose(p: NonNullable<typeof results.data>[number], field: 'origin' | 'destination') {
    const label = pickName(p.names, currentLanguage()) || t('parking.unnamed');
    onSelect({ lat: p.lat, lon: p.lon, label, source: 'search' }, field);
    announce(t('plan.selected', { field: t(field === 'origin' ? 'plan.from' : 'plan.to'), label }));
  }
  return <section aria-labelledby="parking-heading" className="card flex flex-col gap-3 p-4">
    <h2 id="parking-heading" className="text-[1.375rem]">{t('parking.title')}</h2>
    <p className="text-sm text-muted">{t('parking.notice')}</p>
    <label htmlFor="parking-near">{t('parking.near')}</label>
    <select id="parking-near" className="min-h-11 rounded-xl border border-control bg-card px-3"
      value={near} onChange={(e) => setNear(e.target.value as typeof near)}>
      <option value="destination">{t('plan.to')}</option>
      <option value="origin">{t('plan.from')}</option>
      <option value="center">{t('parking.center')}</option>
    </select>
    {!point && <p>{t('parking.choosePoint')}</p>}
    <Button disabled={!point || results.isFetching} onClick={() => {
      if (point) {
        setSearch({ lat: point.lat, lon: point.lon, label: point.label });
        if (search?.lat === point.lat && search?.lon === point.lon) void results.refetch();
      }
    }}>{t('parking.find')}</Button>
    <div role="status">
      {results.isFetching ? t('parking.loading') : search && results.isSuccess ?
        t(results.data.length ? 'parking.results' : 'parking.empty', { count: results.data.length, label: search.label }) : ''}
    </div>
    {results.isError && <ErrorBox onRetry={() => void results.refetch()} retryLabel={t('common.retry')}>
      {t(`errors.${results.error instanceof ApiError ? results.error.code : 'default'}`, { defaultValue: t('errors.default') })}
    </ErrorBox>}
    {!results.isFetching && !results.isError && results.data && <ul className="flex flex-col gap-3">
      {results.data.map((p) => <li key={p.id} className="border-t border-hairline py-3">
        <h3 className="font-bold">{pickName(p.names, currentLanguage()) || t('parking.unnamed')}</h3>
        <p>{t('parking.distance', { distance: formatDistance(p.distanceM, currentLanguage()) })}</p>
        <p className="text-sm text-muted">{p.lat.toFixed(5)}, {p.lon.toFixed(5)}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button onClick={() => choose(p, 'origin')}>{t('parking.useOrigin')}</Button>
          <Button onClick={() => choose(p, 'destination')}>{t('parking.useDestination')}</Button>
        </div>
      </li>)}
    </ul>}
  </section>;
}
