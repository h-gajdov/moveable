import { ChevronLeft, ChevronRight, LocateFixed, Repeat, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import type { LngLat } from '../api/types';
import { useAnnounce } from '../components/Announcer';
import { Layout } from '../components/Layout';
import { MapView } from '../components/MapView';
import { ROUTE_COLORS } from '../components/RouteResults';
import { RouteLine } from '../components/RouteLine';
import { Button, Checkbox } from '../components/ui';
import { currentLanguage } from '../i18n';
import { formatDistance } from '../lib/format';
import { projectOnLine } from '../lib/geo';
import { fullInstruction } from '../lib/instructions';
import { speak, speechSupported, stopSpeaking, vibrate, VIBRATION } from '../lib/speech';
import { useSettings } from '../settings/SettingsContext';
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
        <h1 className="text-3xl font-bold">{t('nav2.title')}</h1>
        <p className="mt-3">{t('nav2.noRoute')}</p>
        <Link to="/" className="mt-3 inline-flex min-h-11 items-center underline">{t('nav2.planRoute')}</Link>
      </Layout>
    );
  }

  const poor = fix && fix.accuracyM > MAX_GUIDANCE_ACCURACY_M;
  const next = instructions[step + 1];

  return (
    <Layout title={t('nav2.title')} wide>
      <div className={`grid ${settings.ui.showMap ? 'lg:grid-cols-[minmax(24rem,34rem)_1fr]' : ''}`}>
        <div className="flex flex-col gap-5 px-4 py-6">
          <h1 className="text-3xl font-bold">{t('nav2.title')}</h1>
          <p className="text-ink-soft">{t('nav2.intro')}</p>

          <section aria-labelledby="now-h" className="rounded-xl border-4 border-vardar bg-surface p-5">
            <h2 id="now-h" className="font-display text-lg font-semibold text-ink-soft">
              {t('nav2.current')}, {t('instr.stepLabel', { n: step + 1, total: instructions.length })}
            </h2>
            <p className="mt-1 text-2xl font-bold leading-snug">{current && fullInstruction(current, t, lang, simple)}</p>
            {next && (
              <p className="mt-3 text-lg">
                <span className="font-semibold">{t('nav2.upcoming')}: </span>
                {fullInstruction(next, t, lang, true)}
              </p>
            )}
            {arrived && <p className="mt-3 text-xl font-bold">{t('nav2.arrived')}</p>}
          </section>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Button onClick={() => goTo(step - 1)} disabled={step === 0} icon={<ChevronLeft aria-hidden="true" className="size-5" />}>
              {t('nav2.prev')}
            </Button>
            <Button onClick={() => tell(step)} icon={<Repeat aria-hidden="true" className="size-5" />}>{t('nav2.repeat')}</Button>
            <Button onClick={() => goTo(step + 1)} disabled={step >= instructions.length - 1} icon={<ChevronRight aria-hidden="true" className="size-5" />}>
              {t('nav2.next')}
            </Button>
            <Button variant="danger" onClick={stop} icon={<Square aria-hidden="true" className="size-5" />}>{t('nav2.stop')}</Button>
          </div>

          <div className="flex flex-col gap-2">
            <Button variant={following ? 'secondary' : 'primary'} aria-pressed={following}
              onClick={following ? stopFollowing : startFollowing} icon={<LocateFixed aria-hidden="true" className="size-5" />}>
              {t('nav2.useGps')}
            </Button>
            <p className="text-sm">{following ? t('nav2.gpsOn') : t('nav2.gpsOff')}</p>
            {fix && !poor && <p className="text-sm">{t('nav2.accuracy', { m: Math.round(fix.accuracyM) })}</p>}
            {poor && <p role="alert" className="rounded-lg border-2 border-issue p-3">{t('nav2.poorAccuracy', { m: Math.round(fix!.accuracyM) })}</p>}
            {gpsError && <p role="alert" className="rounded-lg border-2 border-issue p-3">{gpsError}</p>}
            {offRouteM != null && (
              <div role="alert" className="rounded-lg border-2 border-issue p-3">
                <p className="font-medium">{t('nav2.offRoute', { m: offRouteM })}</p>
                <Button className="mt-2" onClick={recalculate} disabled={recalculating}>
                  {recalculating ? t('nav2.recalculating') : t('nav2.recalculate')}
                </Button>
              </div>
            )}
            <Checkbox
              label={t('nav2.speechOn')}
              checked={settings.ui.speech}
              onChange={(v) => updateUi({ speech: v })}
              hint={speechSupported() ? undefined : t('nav2.speechUnavailable')}
            />
          </div>

          <p className="rounded-lg bg-surface-2 p-3 text-sm">{t('nav2.safety')}</p>

          <section aria-labelledby="all-steps-h">
            <h2 id="all-steps-h" className="mb-3 text-xl font-bold">{t('results.steps')}</h2>
            <RouteLine instructions={instructions} color={ROUTE_COLORS[0]} currentIndex={step} onSelect={goTo} />
          </section>
        </div>
        {settings.ui.showMap && (
          <section aria-label={t('common.mapRegion')} className="h-[45vh] lg:sticky lg:top-0 lg:h-dvh">
            <MapView center={route.geometry.coordinates[0]} zoom={17} routes={[route]} selectedId={route.id}
              origin={trip.origin} destination={trip.destination} position={fix}
              focus={fix && !poor ? { lngLat: fix.lngLat, nonce: Math.round(fix.lngLat[0] * 1e5) } : null} />
          </section>
        )}
      </div>
    </Layout>
  );
}
