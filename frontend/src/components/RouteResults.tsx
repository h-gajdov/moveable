import { useMutation } from '@tanstack/react-query';
import { Navigation } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import type { RouteOption, RouteResponse, Warning } from '../api/types';
import { currentLanguage } from '../i18n';
import { formatDate, formatDistance, formatDuration } from '../lib/format';
import { useAnnounce } from './Announcer';
import { RouteLine } from './RouteLine';
import { Button, StatusMark } from './ui';

export const ROUTE_COLORS = ['var(--c-route-1)', 'var(--c-route-2)', 'var(--c-route-3)'];

function LineSample({ n }: { n: number }) {
  const dash = n === 0 ? undefined : n === 1 ? '10 6' : '2 6';
  return (
    <svg aria-hidden="true" width="44" height="12" className="shrink-0">
      <line x1="2" y1="6" x2="42" y2="6" stroke={ROUTE_COLORS[n]} strokeWidth="6" strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
}

function warningText(w: Warning, t: ReturnType<typeof useTranslation>['t'], lang: ReturnType<typeof currentLanguage>) {
  return t(`warning.${w.code}`, {
    count: w.count ?? 1,
    length: w.lengthM != null ? formatDistance(w.lengthM, lang) : '',
    defaultValue: w.code,
  });
}

export function RouteResults({ response, selectedId, onSelect, onFocusLocation, onAdjustNeeds }: {
  response: RouteResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFocusLocation?: (lngLat: [number, number]) => void;
  onAdjustNeeds?: () => void;
}) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const announce = useAnnounce();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    if (response.routes.length > 0) {
      const r = response.routes[0];
      announce(`${t('results.count', { count: response.routes.length })} ${t('results.distanceDuration', {
        distance: formatDistance(r.distanceM, lang), duration: formatDuration(r.durationS, t),
      })}. ${t(`results.suitability.${r.suitability.level}`)}.`);
    } else if (response.noRoute) {
      announce(t('noRoute.title'), 'assertive');
    }
    // announce once per response
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  if (response.routes.length === 0 && response.noRoute) {
    const nr = response.noRoute;
    return (
      <section aria-labelledby="no-route-h" className="rounded-lg border-2 border-issue bg-surface p-4">
        <h2 id="no-route-h" ref={headingRef} tabIndex={-1} className="text-2xl font-bold">{t('noRoute.title')}</h2>
        <p className="mt-2">{t(`noRoute.${nr.reason}`, { defaultValue: t('errors.default') })}</p>
        {nr.blockingFeatures.length > 0 && (
          <ul className="mt-2 list-disc pl-6">
            {nr.blockingFeatures.map((b) => (
              <li key={b.type}>
                {t(`noRoute.blocking.${b.type}`, { count: b.count })}
                {onFocusLocation && b.locations[0] && (
                  <Button variant="quiet" className="ml-2 underline" onClick={() => onFocusLocation(b.locations[0])}>
                    {t('warning.showOnMap')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {nr.shortestUnconstrainedM != null && (
          <p className="mt-2">{t('noRoute.shortest', { distance: formatDistance(nr.shortestUnconstrainedM, lang) })}</p>
        )}
        <p className="mt-2 text-ink-soft">{t('noRoute.whatNext')}</p>
        {onAdjustNeeds && <Button className="mt-3" onClick={onAdjustNeeds}>{t('noRoute.adjust')}</Button>}
      </section>
    );
  }

  const selected = response.routes.find((r) => r.id === selectedId) ?? response.routes[0];
  const selectedIndex = response.routes.indexOf(selected);

  return (
    <section aria-labelledby="results-h" className="flex flex-col gap-6">
      <div>
        <h2 id="results-h" ref={headingRef} tabIndex={-1} className="text-2xl font-bold">{t('results.title')}</h2>
        <p className="text-ink-soft">{t('results.count', { count: response.routes.length })}</p>
      </div>

      {response.routes.length > 1 && (
        <fieldset>
          <legend className="sr-only">{t('results.choose')}</legend>
          <div className="flex flex-col gap-2">
            {response.routes.map((r, i) => (
              <label
                key={r.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 ${
                  r.id === selected.id ? 'border-vardar bg-surface' : 'border-line bg-surface hover:bg-surface-2'}`}
              >
                <input
                  type="radio" name="route" className="mt-1 size-6 shrink-0 accent-[var(--c-vardar)]"
                  checked={r.id === selected.id} onChange={() => onSelect(r.id)}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 font-display text-lg font-bold">
                    <LineSample n={i} />
                    {r.kinds.map((k) => t(`results.kinds.${k}`)).join(', ')}
                  </span>
                  <span>{t('results.distanceDuration', { distance: formatDistance(r.distanceM, lang), duration: formatDuration(r.durationS, t) })}</span>
                  <span className="text-sm text-ink-soft">
                    {t('results.routeName', { n: i + 1 })}, {t(`results.lineStyle.${i + 1}`)}. {t(`results.suitability.${r.suitability.level}`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <RouteDetail route={selected} index={selectedIndex} response={response} onFocusLocation={onFocusLocation} />
    </section>
  );
}

function RouteDetail({ route, index, response, onFocusLocation }: {
  route: RouteOption; index: number; response: RouteResponse; onFocusLocation?: (l: [number, number]) => void;
}) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const navigate = useNavigate();
  const announce = useAnnounce();
  const s = route.summary;
  const confirm = useMutation({
    mutationFn: (id: string) => api.confirmObstacle(id),
    onSuccess: () => announce(t('results.confirmed')),
  });
  const severityOrder = { WARNING: 0, CAUTION: 1, INFO: 2 } as const;
  const warnings = [...route.warnings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return (
    <article aria-labelledby="route-detail-h" className="flex flex-col gap-6">
      <header className="border-l-8 pl-4" style={{ borderColor: ROUTE_COLORS[index] }}>
        <h3 id="route-detail-h" className="text-xl font-bold">
          {route.kinds.map((k) => t(`results.kinds.${k}`)).join(', ')}
        </h3>
        <p className="font-display text-3xl font-bold">
          {formatDistance(route.distanceM, lang)}
          <span className="ml-3 text-xl font-semibold text-ink-soft">{formatDuration(route.durationS, t)}</span>
        </p>
        <p className="mt-1 flex items-center gap-2 font-medium">
          <StatusMark status={route.suitability.level === 'NO_KNOWN_ISSUES' ? 'OK' : route.suitability.level === 'HAS_KNOWN_ISSUES' ? 'PROBLEM' : 'UNKNOWN'} />
          {t(`results.suitability.${route.suitability.level}`)}
        </p>
        <Button variant="primary" className="mt-3" icon={<Navigation aria-hidden="true" className="size-5" />} onClick={() => navigate('/navigate')}>
          {t('results.startNavigation')}
        </Button>
      </header>

      <p className="rounded-lg bg-surface-2 p-3 text-sm">
        {t('results.notGuaranteed')}{' '}
        {response.dataNotice.osmDataTimestamp && t('results.dataDate', { date: formatDate(response.dataNotice.osmDataTimestamp, lang) })}
      </p>

      {route.suitability.indicators.length > 0 && (
        <section aria-labelledby="ind-h">
          <h4 id="ind-h" className="font-display text-lg font-bold">{t('results.indicators')}</h4>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {route.suitability.indicators.map((ind) => (
              <li key={ind.need} className="flex items-start gap-2">
                <StatusMark status={ind.status} />
                <span>
                  <span className="font-medium">{t(`results.need.${ind.need}`)}</span>: {t(`results.status.${ind.status}`)}
                  {ind.detail && <span className="block text-sm text-ink-soft">{t(`results.statusDetail.${ind.detail}`)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="facts-h">
        <h4 id="facts-h" className="font-display text-lg font-bold">{t('results.facts')}</h4>
        <ul className="mt-1 list-disc pl-6">
          <li>{s.stairs > 0 ? t('results.fact.stairs', { count: s.stairs }) : t('results.fact.noStairs')}</li>
          <li>{s.crossings > 0 ? t('results.fact.crossings', { count: s.crossings, signals: s.crossingsWithSignals }) : t('results.fact.noCrossings')}</li>
          {s.benchesNearRoute > 0 && <li>{t('results.fact.benches', { count: s.benchesNearRoute })}</li>}
          {response.origin && response.origin.snapDistanceM >= 15 && (
            <li>{t('results.snapOrigin', { distance: formatDistance(response.origin.snapDistanceM, lang) })}</li>
          )}
          {response.destination && response.destination.snapDistanceM >= 15 && (
            <li>{t('results.snapDestination', { distance: formatDistance(response.destination.snapDistanceM, lang) })}</li>
          )}
        </ul>
      </section>

      <section aria-labelledby="warn-h">
        <h4 id="warn-h" className="font-display text-lg font-bold">{t('results.warnings')}</h4>
        {warnings.length === 0 ? (
          <p className="mt-1">{t('results.noWarnings')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {warnings.map((w, i) => (
              <li key={i} className={`border-l-4 pl-3 ${w.severity === 'WARNING' ? 'border-issue' : w.severity === 'CAUTION' ? 'border-unknown' : 'border-line'}`}>
                <span className="font-semibold">{t(`warning.severity.${w.severity}`)}: </span>
                {warningText(w, t, lang)}
                {onFocusLocation && w.location && (
                  <Button variant="quiet" className="ml-1 min-h-9 px-2 py-0 text-sm underline" onClick={() => onFocusLocation(w.location!)}>
                    {t('warning.showOnMap')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {route.obstacles.length > 0 && (
        <section aria-labelledby="obs-h">
          <h4 id="obs-h" className="font-display text-lg font-bold">{t('results.obstacles')}</h4>
          <ul className="mt-2 flex flex-col gap-3">
            {route.obstacles.map((o) => (
              <li key={o.id} className="flex flex-col gap-1">
                <span className="font-medium">{t(`report.categories.${o.category}`)}: {t(`report.impacts.${o.impact}`)}</span>
                <span className="text-sm">
                  {o.status === 'VERIFIED' ? t('results.obstacleVerified') : t('results.obstacleUnverified')}.{' '}
                  {o.affectsRouting ? t('results.obstacleAffects') : t('results.obstacleAway', { distance: formatDistance(o.distanceM, lang) })}
                </span>
                <span>
                  <Button variant="secondary" className="min-h-10 text-sm" disabled={confirm.isPending || confirm.isSuccess}
                    onClick={() => confirm.mutate(o.id)}>
                    {t('results.stillThere')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="why-h">
        <h4 id="why-h" className="font-display text-lg font-bold">{t('results.why')}</h4>
        <ul className="mt-1 list-disc pl-6">
          {route.explanation.reasons.map((r) => <li key={r}>{t(`results.reasons.${r}`, { defaultValue: r })}</li>)}
          {route.explanation.extraDistanceM != null && route.explanation.extraDistanceM > 10 && (
            <li>{t('results.extra', { distance: formatDistance(route.explanation.extraDistanceM, lang) })}</li>
          )}
        </ul>
      </section>

      <section aria-labelledby="cov-h">
        <h4 id="cov-h" className="font-display text-lg font-bold">{t('results.coverage')}</h4>
        <p className="mt-1 flex items-center gap-2 font-medium">
          <StatusMark status={route.coverage.level === 'GOOD' ? 'OK' : 'UNKNOWN'} />
          {t(`results.coverageLevel.${route.coverage.level}`)}
        </p>
        <p className="mt-1 text-sm">
          {t('results.coverageDetail', {
            surface: Math.round(route.coverage.knownSurfacePct), incline: Math.round(route.coverage.mappedInclinePct),
            estimated: Math.round(route.coverage.estimatedInclinePct), lit: Math.round(route.coverage.knownLitPct),
          })}
        </p>
      </section>

      <section aria-labelledby="steps-h">
        <h4 id="steps-h" className="mb-3 font-display text-lg font-bold">{t('results.steps')}</h4>
        <RouteLine instructions={route.instructions} color={ROUTE_COLORS[index]} />
      </section>
    </article>
  );
}
