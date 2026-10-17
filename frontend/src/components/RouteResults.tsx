import { useMutation } from '@tanstack/react-query';
import { Armchair, ArrowLeftRight, ChevronRight, CircleAlert, Footprints, Info, MapPinned, Navigation, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
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

/**
 * A collapsible row in the route detail list (iOS disclosure row). Secondary
 * detail stays one tap away instead of filling the sheet.
 */
function Disclosure({ title, meta, open, children }: { title: string; meta?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details className="group" open={open}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-card px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 font-medium">{title}</span>
        {meta && <span className="flex shrink-0 items-center gap-1 text-[0.9375rem] text-muted">{meta}</span>}
        <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-control transition-transform group-open:rotate-90" />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

/** Small fact capsule with an icon, e.g. "No mapped stairs". */
function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="inline-flex min-h-9 items-center gap-1.5 rounded-pill bg-card px-3 py-1 text-[0.9375rem] shadow-[var(--shadow-card)]">
      {icon}
      {children}
    </li>
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
    // Focus the heading and bring it into view (the page keeps the map on screen where it can).
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView?.({ block: 'nearest' });
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
  const several = response.routes.length > 1;

  /** One route as a compact row: time first, then distance and what kind of route it is. */
  const routeRow = (r: RouteOption, i: number, on = false) => (
    <>
      <LineSample n={i} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-display text-[1.25rem] font-semibold leading-tight tracking-[-0.01em]">{formatDuration(r.durationS, t)}</span>
        {/* Darker grey on the tinted selected row keeps 4.5:1. */}
        <span className={`text-[0.9375rem] ${on ? 'text-ink-2' : 'text-muted'}`}>
          {formatDistance(r.distanceM, lang)} · {r.kinds.map((k) => t(`results.kinds.${k}`)).join(', ')}
        </span>
        <span className="sr-only">
          {t('results.routeName', { n: i + 1 })}, {t(`results.lineStyle.${i + 1}`)}. {t(`results.suitability.${r.suitability.level}`)}.
        </span>
      </span>
      <StatusMark status={suitabilityStatus(r.suitability.level)} />
    </>
  );

  return (
    <section aria-labelledby="results-h" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id="results-h" ref={headingRef} tabIndex={-1} className="scroll-mt-4 text-[1.375rem]">{t('results.title')}</h2>
        <p className="text-[0.9375rem] text-muted">{t('results.count', { count: response.routes.length })}</p>
      </div>

      {several ? (
        <fieldset>
          <legend className="sr-only">{t('results.choose')}</legend>
          <div className="card rows overflow-hidden">
            {response.routes.map((r, i) => {
              const on = r.id === selected.id;
              return (
                <label
                  key={r.id}
                  className={`relative flex min-h-16 cursor-pointer items-center gap-3 px-4 py-3 transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:-outline-offset-3 has-[:focus-visible]:outline-[var(--c-focus)] ${
                    on ? 'bg-tint' : 'hover:bg-fill'}`}
                >
                  {routeRow(r, i, on)}
                  <input type="radio" name="route" className="check-radio" checked={on} onChange={() => onSelect(r.id)} />
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : (
        <div className="card flex min-h-16 items-center gap-3 px-4 py-3">{routeRow(selected, 0)}</div>
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

  const snaps = [
    response.origin && response.origin.snapDistanceM >= 15
      && t('results.snapOrigin', { distance: formatDistance(response.origin.snapDistanceM, lang) }),
    response.destination && response.destination.snapDistanceM >= 15
      && t('results.snapDestination', { distance: formatDistance(response.destination.snapDistanceM, lang) }),
  ].filter(Boolean) as string[];
  const indicators = route.suitability.indicators;
  const statusCount = (st: 'OK' | 'PROBLEM' | 'UNKNOWN') => indicators.filter((i) => i.status === st).length;
  const chipIcon = 'size-4 shrink-0 text-muted';

  return (
    <article aria-labelledby="route-detail-h" className="flex flex-col gap-4">
      <h3 id="route-detail-h" className="sr-only">
        {t('results.routeName', { n: index + 1 })}: {route.kinds.map((k) => t(`results.kinds.${k}`)).join(', ')}
      </h3>

      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 px-1 font-medium">
          <StatusMark status={suitabilityStatus(route.suitability.level)} />
          {t(`results.suitability.${route.suitability.level}`)}
        </p>
        <Button variant="primary" size="lg" className="w-full" icon={<Navigation aria-hidden="true" className="size-5" />}
          onClick={() => navigate('/navigate')}>
          {t('results.startNavigation')}
        </Button>
      </div>

      <section aria-labelledby="facts-h">
        <h4 id="facts-h" className="sr-only">{t('results.facts')}</h4>
        <ul className="flex flex-wrap gap-2">
          <Chip icon={<Footprints aria-hidden="true" className={chipIcon} />}>
            {s.stairs > 0 ? t('results.fact.stairs', { count: s.stairs }) : t('results.fact.noStairs')}
          </Chip>
          <Chip icon={<ArrowLeftRight aria-hidden="true" className={chipIcon} />}>
            {s.crossings > 0 ? t('results.fact.crossings', { count: s.crossings, signals: s.crossingsWithSignals }) : t('results.fact.noCrossings')}
          </Chip>
          {s.benchesNearRoute > 0 && (
            <Chip icon={<Armchair aria-hidden="true" className={chipIcon} />}>{t('results.fact.benches', { count: s.benchesNearRoute })}</Chip>
          )}
        </ul>
      </section>

      {(warnings.length > 0 || snaps.length > 0) && (
        <section aria-labelledby="warn-h">
          <h4 id="warn-h" className="mb-1.5 px-1 text-[1.0625rem]">{t('results.warnings')}</h4>
          <ul className="card rows px-4">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-3 py-2.5">
                {SEVERITY_ICON[w.severity]}
                <p className="min-w-0 flex-1">
                  <span className="sr-only">{t(`warning.severity.${w.severity}`)}: </span>
                  {warningText(w, t, lang)}
                </p>
                {onFocusLocation && w.location && (
                  <Button variant="quiet" className="-my-1 -mr-3 shrink-0" icon={<MapPinned aria-hidden="true" className="size-4.5" />}
                    onClick={() => onFocusLocation(w.location!)}>
                    {t('warning.showOnMap')}
                  </Button>
                )}
              </li>
            ))}
            {snaps.map((text) => (
              <li key={text} className="flex items-start gap-3 py-2.5">
                {SEVERITY_ICON.INFO}
                <p className="min-w-0 flex-1">{text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="card rows overflow-hidden">
        {indicators.length > 0 && (
          <Disclosure
            title={t('results.indicators')}
            open={statusCount('PROBLEM') > 0}
            meta={(['PROBLEM', 'UNKNOWN', 'OK'] as const).filter((st) => statusCount(st) > 0).map((st) => (
              <span key={st} aria-hidden="true" className="inline-flex items-center gap-0.5">
                <StatusMark status={st} />{statusCount(st)}
              </span>
            ))}
          >
            <ul className="rows">
              {indicators.map((ind) => (
                <li key={ind.need} className="flex items-start gap-2.5 py-2.5">
                  <StatusMark status={ind.status} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap justify-between gap-x-3">
                      <span className="font-medium">{t(`results.need.${ind.need}`)}</span>
                      <span className="text-[0.9375rem] text-muted">{t(`results.status.${ind.status}`)}</span>
                    </span>
                    {ind.detail && <span className="block text-[0.875rem] text-muted">{t(`results.statusDetail.${ind.detail}`)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}

        <Disclosure title={t('results.steps')} meta={<span aria-hidden="true">{route.instructions.length}</span>}>
          <RouteLine instructions={route.instructions} color={ROUTE_COLORS[index]} />
        </Disclosure>

        <Disclosure title={t('results.why')}>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-control">
            {route.explanation.reasons.map((r) => <li key={r}>{t(`results.reasons.${r}`, { defaultValue: r })}</li>)}
            {route.explanation.extraDistanceM != null && route.explanation.extraDistanceM > 10 && (
              <li>{t('results.extra', { distance: formatDistance(route.explanation.extraDistanceM, lang) })}</li>
            )}
          </ul>
        </Disclosure>

        <Disclosure title={t('results.coverage')} meta={t(`results.coverageLevel.${route.coverage.level}`)}>
          <p className="text-[0.9375rem] text-ink-2">
            {t('results.coverageDetail', {
              surface: Math.round(route.coverage.knownSurfacePct), incline: Math.round(route.coverage.mappedInclinePct),
              estimated: Math.round(route.coverage.estimatedInclinePct), lit: Math.round(route.coverage.knownLitPct),
            })}
          </p>
        </Disclosure>

        {route.obstacles.length > 0 && (
          <Disclosure title={t('results.obstacles')} meta={<span aria-hidden="true">{route.obstacles.length}</span>}>
            <ul className="rows">
              {route.obstacles.map((o) => (
                <li key={o.id} className="flex flex-col gap-1 py-2.5">
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
          </Disclosure>
        )}
      </div>

      <p className="flex gap-2 px-1 text-[0.8125rem] text-muted">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          {t('results.notGuaranteed')}{' '}
          {response.dataNotice.osmDataTimestamp && t('results.dataDate', { date: formatDate(response.dataNotice.osmDataTimestamp, lang) })}
        </span>
      </p>
    </article>
  );
}
