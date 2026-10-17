import { ChevronLeft, ChevronRight, Info, LocateFixed, Repeat, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import type { LngLat } from '../api/types';
import { useAnnounce } from '../components/Announcer';
import { Layout } from '../components/Layout';
import { MapSheet } from '../components/MapSheet';
import { MapView } from '../components/MapView';
import { ROUTE_COLORS } from '../components/RouteResults';
import { RouteLine } from '../components/RouteLine';
import { Button, Checkbox, Group, Notice, PageTitle } from '../components/ui';
import { currentLanguage } from '../i18n';
import { formatDistance } from '../lib/format';
import { projectOnLine } from '../lib/geo';
import { fullInstruction } from '../lib/instructions';
import { speak, speechSupported, stopSpeaking, vibrate, VIBRATION } from '../lib/speech';
import { prefersReducedMotion, useSettings } from '../settings/SettingsContext';
import { selectedRoute, useTrip } from '../settings/TripContext';

/** GPS fixes worse than this never move steps or trigger turn announcements. */
export const MAX_GUIDANCE_ACCURACY_M = 30;
const ANNOUNCE_AHEAD_M = 25;
const OFF_ROUTE_FIXES = 3;

export function NavigatePage() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const navigate = useNavigate();
  const announce = useAnnounce();
  const { settings, updateUi } = useSettings();
  const trip = useTrip();
  const route = selectedRoute(trip);
  const simple = settings.ui.instructionDetail === 'simple';

  const [step, setStep] = useState(0);
  const [following, setFollowing] = useState(false);
  const [fix, setFix] = useState<{ lngLat: LngLat; accuracyM: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [offRouteM, setOffRouteM] = useState<number | null>(null);
  const [arrived, setArrived] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const watchId = useRef<number | null>(null);
  const offCount = useRef(0);
  const announcedAhead = useRef<number>(-1);
  const stepRef = useRef(0);
  const [sheetOpen, setSheetOpen] = useState(true);

  const instructions = route?.instructions ?? [];
  const current = instructions[step];

  const tell = useCallback((index: number, prefix?: string) => {
    const ins = instructions[index];
    if (!ins) return;
    const text = (prefix ? prefix + ' ' : '') + fullInstruction(ins, t, lang, simple);
    announce(text);
    if (settings.ui.speech) speak(text, lang, settings.ui.speechRate);
    if (settings.ui.vibration) {
      vibrate(ins.type === 'CROSS' ? VIBRATION.crossing : ins.type === 'ARRIVE' ? VIBRATION.arrive : VIBRATION.step);
    }
  }, [instructions, t, lang, simple, announce, settings.ui.speech, settings.ui.speechRate, settings.ui.vibration]);

  const goTo = useCallback((i: number) => {
    const n = Math.max(0, Math.min(instructions.length - 1, i));
    stepRef.current = n;
    setStep(n);
    tell(n, t('instr.stepLabel', { n: n + 1, total: instructions.length }) + '.');
  }, [instructions.length, tell, t]);

  // Stop GPS and speech when leaving the page.
  useEffect(() => () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    stopSpeaking();
  }, []);

  // Reset when a new route arrives (e.g. after recalculation).
  useEffect(() => {
    setStep(0);
    stepRef.current = 0;
    setArrived(false);
    setOffRouteM(null);
    offCount.current = 0;
    announcedAhead.current = -1;
  }, [route?.id, trip.response]);

  const onFix = useCallback((pos: GeolocationPosition) => {
    if (!route) return;
    const lngLat: LngLat = [pos.coords.longitude, pos.coords.latitude];
    const acc = pos.coords.accuracy;
    setFix({ lngLat, accuracyM: acc });
    setGpsError(null);
    if (acc > MAX_GUIDANCE_ACCURACY_M) return; // never guide on an imprecise fix

    const proj = projectOnLine(lngLat, route.geometry.coordinates);
    const limit = Math.max(30, acc * 1.5);
    if (proj.offsetM > limit) {
      offCount.current += 1;
      if (offCount.current === OFF_ROUTE_FIXES) {
        setOffRouteM(Math.round(proj.offsetM));
        announce(t('nav2.offRoute', { m: Math.round(proj.offsetM) }), 'assertive');
        if (settings.ui.vibration) vibrate(VIBRATION.warning);
      }
      return;
    }
    offCount.current = 0;
    setOffRouteM(null);

    const total = route.distanceM;
    if (proj.alongM >= total - 15) {
      if (!arrived) {
        setArrived(true);
        stepRef.current = instructions.length - 1;
        setStep(instructions.length - 1);
        tell(instructions.length - 1);
      }
      return;
    }
    let idx = 0;
    for (let i = 0; i < instructions.length; i++) {
      if (instructions[i].startDistanceM <= proj.alongM + 5) idx = i;
    }
    if (idx !== stepRef.current) {
      stepRef.current = idx;
      setStep(idx);
      tell(idx);
    }
    const next = instructions[idx + 1];
    if (next && next.startDistanceM - proj.alongM <= ANNOUNCE_AHEAD_M && announcedAhead.current !== idx + 1) {
      announcedAhead.current = idx + 1;
      tell(idx + 1, t('nav2.inDistance', { distance: formatDistance(next.startDistanceM - proj.alongM, lang) }) + ':');
    }
  }, [route, instructions, arrived, tell, announce, t, lang, settings.ui.vibration]);

  // The watch always calls the latest handler without being restarted.
  const onFixRef = useRef(onFix);
  onFixRef.current = onFix;

  function startFollowing() {
    if (!('geolocation' in navigator)) {
      setGpsError(t('nav2.gpsUnavailable'));
      return;
    }
    watchId.current = navigator.geolocation.watchPosition((p) => onFixRef.current(p), (err) => {
      setGpsError(err.code === err.PERMISSION_DENIED ? t('nav2.permissionDenied') : t('nav2.gpsUnavailable'));
      setFollowing(false);
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 });
    setFollowing(true);
    announce(t('nav2.gpsOn'));
  }

  function stopFollowing() {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setFollowing(false);
    setFix(null);
  }

  function stop() {
    stopFollowing();
    stopSpeaking();
    announce(t('nav2.stopped'));
    navigate('/');
  }

  async function recalculate() {
    if (!fix || !trip.destination || !trip.lastRequest) return;
    setRecalculating(true);
    announce(t('nav2.recalculating'));
    try {
      const req = { ...trip.lastRequest, origin: { lat: fix.lngLat[1], lon: fix.lngLat[0] }, alternatives: false };
      const res = await api.route(req);
      trip.setResult(req, res);
    } catch {
      announce(t('errors.NETWORK'), 'assertive');
    } finally {
      setRecalculating(false);
    }
  }

  if (!route) {
    return (
      <Layout title={t('nav2.title')}>
        <PageTitle subtitle={t('nav2.noRoute')}>{t('nav2.title')}</PageTitle>
        <Link to="/" className="inline-flex min-h-11 items-center rounded-pill bg-accent px-5 font-medium text-accent-ink hover:bg-accent-hover">
          {t('nav2.planRoute')}
        </Link>
      </Layout>
    );
  }

  /** On phones the sheet scrolls over the map; bring the map back when it takes focus. */
  const revealMap = () => document.getElementById('main')?.scrollTo?.({ top: 0, behavior: prefersReducedMotion(settings.ui) ? 'auto' : 'smooth' });
  const poor = fix && fix.accuracyM > MAX_GUIDANCE_ACCURACY_M;
  const next = instructions[step + 1];
  const showMap = settings.ui.showMap;
  const alertBox = 'card p-4 ring-[length:var(--hair)] ring-issue';

  const content = (
    <>
      <div>
        <h1 className="large-title">{t('nav2.title')}</h1>
        <p className="mt-1 text-muted">{t('nav2.intro')}</p>
      </div>

      <section aria-labelledby="now-h" className="rounded-panel bg-bar p-5 text-bar-ink shadow-[var(--shadow-float)]">
        <h2 id="now-h" className="text-[0.9375rem] font-semibold text-bar-muted">
          {t('nav2.current')}, {t('instr.stepLabel', { n: step + 1, total: instructions.length })}
        </h2>
        <p className="mt-2 font-display text-[1.75rem] font-semibold leading-tight tracking-[-0.015em]">
          {current && fullInstruction(current, t, lang, simple)}
        </p>
        {next && (
          <p className="mt-4 border-t border-white/15 pt-3 text-[1.0625rem] text-bar-ink">
            <span className="font-semibold text-bar-muted">{t('nav2.upcoming')}: </span>
            {fullInstruction(next, t, lang, true)}
          </p>
        )}
        {arrived && <p className="mt-3 text-[1.25rem] font-semibold">{t('nav2.arrived')}</p>}
      </section>

      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => goTo(step - 1)} disabled={step === 0} icon={<ChevronLeft aria-hidden="true" className="size-5" />}>
          {t('nav2.prev')}
        </Button>
        <Button onClick={() => goTo(step + 1)} disabled={step >= instructions.length - 1} icon={<ChevronRight aria-hidden="true" className="size-5" />}>
          {t('nav2.next')}
        </Button>
        <Button onClick={() => tell(step)} icon={<Repeat aria-hidden="true" className="size-5" />}>{t('nav2.repeat')}</Button>
        <Button variant="danger" onClick={stop} icon={<Square aria-hidden="true" className="size-4" fill="currentColor" />}>{t('nav2.stop')}</Button>
      </div>

      <div className="flex flex-col gap-3">
        <Button variant={following ? 'tinted' : 'primary'} size="lg" aria-pressed={following}
          onClick={following ? stopFollowing : startFollowing} icon={<LocateFixed aria-hidden="true" className="size-5" />}>
          {t('nav2.useGps')}
        </Button>
        <p className="flex items-center gap-2 px-1 text-[0.9375rem]">
          <span aria-hidden="true" className={`inline-block size-2.5 rounded-full ${following ? 'bg-ok' : 'border-2 border-control'}`} />
          {following ? t('nav2.gpsOn') : t('nav2.gpsOff')}
        </p>
        {fix && !poor && <p className="px-1 text-[0.9375rem] text-muted">{t('nav2.accuracy', { m: Math.round(fix.accuracyM) })}</p>}
        {poor && <p role="alert" className={alertBox}>{t('nav2.poorAccuracy', { m: Math.round(fix!.accuracyM) })}</p>}
        {gpsError && <p role="alert" className={alertBox}>{gpsError}</p>}
        {offRouteM != null && (
          <div role="alert" className={alertBox}>
            <p className="font-medium">{t('nav2.offRoute', { m: offRouteM })}</p>
            <Button className="mt-3" variant="tinted" onClick={recalculate} disabled={recalculating}>
              {recalculating ? t('nav2.recalculating') : t('nav2.recalculate')}
            </Button>
          </div>
        )}
        <Group>
          <Checkbox
            label={t('nav2.speechOn')}
            checked={settings.ui.speech}
            onChange={(v) => updateUi({ speech: v })}
            hint={speechSupported() ? undefined : t('nav2.speechUnavailable')}
          />
        </Group>
      </div>

      <Notice icon={<Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" />}>{t('nav2.safety')}</Notice>

      <section aria-labelledby="all-steps-h">
        <h2 id="all-steps-h" className="mb-2 px-1 text-[1.375rem]">{t('results.steps')}</h2>
        <div className="card px-2 py-3">
          <RouteLine instructions={instructions} color={ROUTE_COLORS[0]} currentIndex={step} onSelect={goTo} />
        </div>
      </section>
    </>
  );

  const mapPanel = (
    <>
      <MapView center={route.geometry.coordinates[0]} zoom={17} routes={[route]} selectedId={route.id}
        origin={trip.origin} destination={trip.destination} position={fix}
        focus={fix && !poor ? { lngLat: fix.lngLat, nonce: Math.round(fix.lngLat[0] * 1e5) } : null} />
    </>
  );

  return (
    <Layout title={t('nav2.title')} wide={showMap}>
      {showMap ? (
        <MapSheet map={mapPanel} mapLabel={t('common.mapRegion')} onMapFocus={revealMap} open={sheetOpen}
          onOpenChange={setSheetOpen} className="flex flex-col gap-5">
          {content}
        </MapSheet>
      ) : <div className="flex flex-col gap-5">{content}</div>}
    </Layout>
  );
}
