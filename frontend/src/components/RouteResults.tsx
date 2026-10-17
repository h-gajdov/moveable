import { useMutation } from '@tanstack/react-query';
import { CircleAlert, Info, MapPinned, Navigation, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import type { RouteOption, RouteResponse, Warning } from '../api/types';
import { currentLanguage } from '../i18n';
import { formatDate, formatDistance, formatDuration } from '../lib/format';
import { useAnnounce } from './Announcer';
import { RouteLine } from './RouteLine';
import { Button, Notice, StatusMark } from './ui';

export const ROUTE_COLORS = ['var(--c-route-1)', 'var(--c-route-2)', 'var(--c-route-3)'];

function LineSample({ n }: { n: number }) {
  const dash = n === 0 ? undefined : n === 1 ? '10 6' : '2 6';
  return (
    <svg aria-hidden="true" width="40" height="10" className="shrink-0">
      <line x1="3" y1="5" x2="37" y2="5" stroke={ROUTE_COLORS[n]} strokeWidth="5" strokeDasharray={dash} strokeLinecap="round" />
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

function suitabilityStatus(level: RouteOption['suitability']['level']) {
  return level === 'NO_KNOWN_ISSUES' ? 'OK' : level === 'HAS_KNOWN_ISSUES' ? 'PROBLEM' : 'UNKNOWN';
}

/** A titled grouped section inside the route detail. */
function DetailSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h4 id={id} className="mb-2 px-1 text-[1.0625rem]">{title}</h4>
      {children}
    </section>
  );
}

const SEVERITY_ICON = {
  WARNING: <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-issue" />,
  CAUTION: <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-caution" />,
  INFO: <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" />,
} as const;

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
    // Focus the heading and bring the results to the top of the panel/page.
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView?.({ block: 'start' });
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
      <section aria-labelledby="no-route-h" className="card p-5 ring-[length:var(--hair)] ring-issue">
        <div className="flex items-start gap-3">
          <StatusMark status="PROBLEM" size="lg" />
          <h2 id="no-route-h" ref={headingRef} tabIndex={-1} className="scroll-mt-6 text-[1.5rem]">{t('noRoute.title')}</h2>
        </div>
        <p className="mt-3">{t(`noRoute.${nr.reason}`, { defaultValue: t('errors.default') })}</p>
        {nr.blockingFeatures.length > 0 && (
          <ul className="rows mt-3 rounded-[14px] bg-fill px-3.5">
            {nr.blockingFeatures.map((b) => (
              <li key={b.type} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 py-1.5">
                <span className="font-medium">{t(`noRoute.blocking.${b.type}`, { count: b.count })}</span>
                {onFocusLocation && b.locations[0] && (
                  <Button variant="quiet" className="-mr-3" icon={<MapPinned aria-hidden="true" className="size-4.5" />}
                    onClick={() => onFocusLocation(b.locations[0])}>
                    {t('warning.showOnMap')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {nr.shortestUnconstrainedM != null && (
          <p className="mt-3">{t('noRoute.shortest', { distance: formatDistance(nr.shortestUnconstrainedM, lang) })}</p>
        )}
        <p className="mt-3 text-muted">{t('noRoute.whatNext')}</p>
        {onAdjustNeeds && <Button className="mt-4" variant="tinted" onClick={onAdjustNeeds}>{t('noRoute.adjust')}</Button>}
      </section>
    );
  }

  const selected = response.routes.find((r) => r.id === selectedId) ?? response.routes[0];
  const selectedIndex = response.routes.indexOf(selected);

  return (
    <section aria-labelledby="results-h" className="flex flex-col gap-5">
      <div className="px-1">
        <h2 id="results-h" ref={headingRef} tabIndex={-1} className="scroll-mt-6 text-[1.75rem]">{t('results.title')}</h2>
        <p className="text-muted">{t('results.count', { count: response.routes.length })}</p>
      </div>

      {response.routes.length > 1 && (
        <fieldset>
          <legend className="sr-only">{t('results.choose')}</legend>
          <div className="flex flex-col gap-2">
            {response.routes.map((r, i) => {
              const on = r.id === selected.id;
              return (
                <label
                  key={r.id}
                  className={`card flex cursor-pointer items-center gap-3 p-4 transition-shadow has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--c-focus)] ${
                    on ? 'ring-2 ring-accent' : 'hover:ring-[length:var(--hair)] hover:ring-hairline'}`}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-display text-[1.375rem] font-semibold tracking-[-0.01em]">{formatDuration(r.durationS, t)}</span>
                      <span className="text-muted">{formatDistance(r.distanceM, lang)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      <LineSample n={i} />
                      {r.kinds.map((k) => t(`results.kinds.${k}`)).join(', ')}
                    </span>
                    <span className="text-[0.875rem] text-muted">
                      <span className="sr-only">{t('results.distanceDuration', { distance: formatDistance(r.distanceM, lang), duration: formatDuration(r.durationS, t) })}. </span>
                      {t('results.routeName', { n: i + 1 })}, {t(`results.lineStyle.${i + 1}`)}. {t(`results.suitability.${r.suitability.level}`)}
                    </span>
                  </span>
                  <input
                    type="radio" name="route" className="check-radio"
                    checked={on} onChange={() => onSelect(r.id)}
                  />
                </label>
              );
            })}
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
      <header className="card overflow-hidden">
        <div aria-hidden="true" className="h-1.5" style={{ background: ROUTE_COLORS[index] }} />
        <div className="p-5">
          <h3 id="route-detail-h" className="text-[0.9375rem] font-semibold text-muted">
            {route.kinds.map((k) => t(`results.kinds.${k}`)).join(', ')}
          </h3>
          <p className="mt-1 font-display text-[2.5rem] font-semibold leading-none tracking-[-0.02em]">
            {formatDuration(route.durationS, t)}
          </p>
          <p className="mt-1.5 text-[1.0625rem] text-muted">{formatDistance(route.distanceM, lang)}</p>
          <p className="mt-3 flex items-center gap-2 font-medium">
            <StatusMark status={suitabilityStatus(route.suitability.level)} />
            {t(`results.suitability.${route.suitability.level}`)}
          </p>
          <Button variant="primary" size="lg" className="mt-4 w-full" icon={<Navigation aria-hidden="true" className="size-5" />}
            onClick={() => navigate('/navigate')}>
            {t('results.startNavigation')}
          </Button>
        </div>
      </header>

      <Notice icon={<Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" />}>
        {t('results.notGuaranteed')}{' '}
        {response.dataNotice.osmDataTimestamp && t('results.dataDate', { date: formatDate(response.dataNotice.osmDataTimestamp, lang) })}
      </Notice>

      {route.suitability.indicators.length > 0 && (
        <DetailSection id="ind-h" title={t('results.indicators')}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {route.suitability.indicators.map((ind) => (
              <li key={ind.need} className="card flex items-start gap-2.5 p-3.5">
                <StatusMark status={ind.status} />
                <span className="min-w-0">
                  <span className="block font-medium">{t(`results.need.${ind.need}`)}</span>
                  <span className="block text-[0.9375rem]">{t(`results.status.${ind.status}`)}</span>
                  {ind.detail && <span className="block text-[0.875rem] text-muted">{t(`results.statusDetail.${ind.detail}`)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      <DetailSection id="facts-h" title={t('results.facts')}>
        <ul className="card rows px-4">
          <li className="py-3">{s.stairs > 0 ? t('results.fact.stairs', { count: s.stairs }) : t('results.fact.noStairs')}</li>
          <li className="py-3">{s.crossings > 0 ? t('results.fact.crossings', { count: s.crossings, signals: s.crossingsWithSignals }) : t('results.fact.noCrossings')}</li>
          {s.benchesNearRoute > 0 && <li className="py-3">{t('results.fact.benches', { count: s.benchesNearRoute })}</li>}
          {response.origin && response.origin.snapDistanceM >= 15 && (
            <li className="py-3">{t('results.snapOrigin', { distance: formatDistance(response.origin.snapDistanceM, lang) })}</li>
          )}
          {response.destination && response.destination.snapDistanceM >= 15 && (
            <li className="py-3">{t('results.snapDestination', { distance: formatDistance(response.destination.snapDistanceM, lang) })}</li>
          )}
        </ul>
      </DetailSection>

      <DetailSection id="warn-h" title={t('results.warnings')}>
        {warnings.length === 0 ? (
          <p className="card p-4">{t('results.noWarnings')}</p>
        ) : (
          <ul className="card rows px-4">
            {warnings.map((w, i) => (
              <li key={i} className="flex gap-3 py-3">
                {SEVERITY_ICON[w.severity]}
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-semibold">{t(`warning.severity.${w.severity}`)}: </span>
                    <span>{warningText(w, t, lang)}</span>
                  </p>
                  {onFocusLocation && w.location && (
                    <Button variant="quiet" className="-ml-4 mt-0.5" icon={<MapPinned aria-hidden="true" className="size-4.5" />}
                      onClick={() => onFocusLocation(w.location!)}>
                      {t('warning.showOnMap')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      {route.obstacles.length > 0 && (
        <DetailSection id="obs-h" title={t('results.obstacles')}>
          <ul className="card rows px-4">
            {route.obstacles.map((o) => (
              <li key={o.id} className="flex flex-col gap-1 py-3">
                <span className="font-medium">{t(`report.categories.${o.category}`)}: {t(`report.impacts.${o.impact}`)}</span>
                <span className="text-[0.9375rem] text-muted">
                  {o.status === 'VERIFIED' ? t('results.obstacleVerified') : t('results.obstacleUnverified')}.{' '}
                  {o.affectsRouting ? t('results.obstacleAffects') : t('results.obstacleAway', { distance: formatDistance(o.distanceM, lang) })}
                </span>
                <span>
                  <Button variant="tinted" className="mt-1" disabled={confirm.isPending || confirm.isSuccess}
                    onClick={() => confirm.mutate(o.id)}>
                    {t('results.stillThere')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      <DetailSection id="why-h" title={t('results.why')}>
        <ul className="card rows px-4">
          {route.explanation.reasons.map((r) => <li key={r} className="py-3">{t(`results.reasons.${r}`, { defaultValue: r })}</li>)}
          {route.explanation.extraDistanceM != null && route.explanation.extraDistanceM > 10 && (
            <li className="py-3">{t('results.extra', { distance: formatDistance(route.explanation.extraDistanceM, lang) })}</li>
          )}
        </ul>
      </DetailSection>

      <DetailSection id="cov-h" title={t('results.coverage')}>
        <div className="card p-4">
          <p className="flex items-center gap-2 font-medium">
            <StatusMark status={route.coverage.level === 'GOOD' ? 'OK' : 'UNKNOWN'} />
            {t(`results.coverageLevel.${route.coverage.level}`)}
          </p>
          <p className="mt-1.5 text-[0.9375rem] text-muted">
            {t('results.coverageDetail', {
              surface: Math.round(route.coverage.knownSurfacePct), incline: Math.round(route.coverage.mappedInclinePct),
              estimated: Math.round(route.coverage.estimatedInclinePct), lit: Math.round(route.coverage.knownLitPct),
            })}
          </p>
        </div>
      </DetailSection>

      <DetailSection id="steps-h" title={t('results.steps')}>
        <div className="card px-2 py-3">
          <RouteLine instructions={route.instructions} color={ROUTE_COLORS[index]} />
        </div>
      </DetailSection>
    </article>
  );
}
