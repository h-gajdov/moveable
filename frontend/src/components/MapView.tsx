import type { FeatureCollection } from 'geojson';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Layers } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { ChosenLocation, LngLat, RouteOption } from '../api/types';
import { bboxOf } from '../lib/geo';
import { prefersReducedMotion, useSettings } from '../settings/SettingsContext';
import { Button, Checkbox } from './ui';

const STYLE_URL = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ?? 'https://tiles.openfreemap.org/styles/liberty';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const DASHES: (number[] | undefined)[] = [undefined, [2.5, 1.5], [0.5, 1.5]];

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#0071e3';
}

export interface MapFocus {
  lngLat: LngLat;
  nonce: number;
}

/** Map padding that keeps fitted routes clear of a panel floating over the map. */
function fitPadding(map: MLMap, obstruct?: RefObject<HTMLElement | null>) {
  const pad = { top: 60, right: 60, bottom: 60, left: 60 };
  const el = obstruct?.current;
  if (el && getComputedStyle(el).position === 'absolute') {
    const covered = el.getBoundingClientRect().right - map.getContainer().getBoundingClientRect().left;
    if (covered > 0 && covered < map.getContainer().clientWidth - 200) pad.left += covered;
  }
  return pad;
}

/**
 * Visual map. Every piece of information shown here is also available as text
 * elsewhere; the map is never required. Keyboard: arrows pan, +/- zoom, and in
 * pick mode Enter chooses the centre point.
 */
export function MapView({ center, zoom, routes, selectedId, origin, destination, pickLabel, onPick, onCancelPick, focus, position, obstruct }: {
  center: LngLat;
  zoom: number;
  routes: RouteOption[];
  selectedId: string | null;
  origin: ChosenLocation | null;
  destination: ChosenLocation | null;
  pickLabel?: string | null;
  onPick?: (l: LngLat) => void;
  onCancelPick?: () => void;
  focus?: MapFocus | null;
  position?: { lngLat: LngLat; accuracyM: number } | null;
  /** Element floating over the map (e.g. the side panel) that fitted routes should avoid. */
  obstruct?: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [layers, setLayers] = useState({ obstacles: true, features: false, coverage: false });
  const [zoomTooLow, setZoomTooLow] = useState(false);
  const pickRef = useRef({ pickLabel, onPick, onCancelPick });
  pickRef.current = { pickLabel, onPick, onCancelPick };
  const reduced = prefersReducedMotion(settings.ui);

  // Create the map once.
  useEffect(() => {
    if (!container.current) return;
    let map: MLMap;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: STYLE_URL,
        center,
        zoom,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: { compact: false },
        locale: {
          'NavigationControl.ZoomIn': '+',
          'NavigationControl.ZoomOut': '−',
        },
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', (e) => {
      if (!map.isStyleLoaded() && (e.error as Error | undefined)?.message?.match(/style|fetch|Failed/i)) setFailed(true);
    });
    map.on('load', () => {
      const add = (id: string) => map.addSource(id, { type: 'geojson', data: EMPTY });
      ['routes', 'obstacles', 'features', 'coverage', 'position'].forEach(add);
      map.addLayer({ id: 'coverage', type: 'fill', source: 'coverage', paint: {
        'fill-color': '#3634a3', 'fill-opacity': ['interpolate', ['linear'], ['get', 'completeness'], 0, 0.05, 0.6, 0.45],
      } });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'routes', filter: ['==', ['get', 'selected'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 11 } });
      for (let i = 0; i < 3; i++) {
        map.addLayer({ id: `route-${i}`, type: 'line', source: 'routes', filter: ['==', ['get', 'index'], i],
          layout: { 'line-cap': i === 0 ? 'round' : 'butt', 'line-join': 'round' },
          paint: {
            'line-color': '#0071e3',
            'line-width': ['case', ['get', 'selected'], 7, 4],
            ...(DASHES[i] ? { 'line-dasharray': DASHES[i] } : {}),
          } });
      }
      map.addLayer({ id: 'features', type: 'circle', source: 'features', paint: {
        'circle-radius': 6, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff',
        'circle-color': ['match', ['get', 'kind'], 'STAIRS', '#c4000f', 'CROSSING', '#0071e3', 'BARRIER', '#3634a3', 'KERB', '#3634a3', '#1e7b34'],
      } });
      map.addLayer({ id: 'obstacles', type: 'circle', source: 'obstacles', paint: {
        'circle-radius': 9, 'circle-stroke-width': 3,
        'circle-color': ['case', ['get', 'verified'], '#c4000f', '#ffffff'],
        'circle-stroke-color': ['case', ['get', 'verified'], '#ffffff', '#c4000f'],
      } });
      map.addLayer({ id: 'position-accuracy', type: 'circle', source: 'position', paint: {
        'circle-radius': ['get', 'radiusPx'], 'circle-color': '#0071e3', 'circle-opacity': 0.15,
      } });
      map.addLayer({ id: 'position', type: 'circle', source: 'position', paint: {
        'circle-radius': 8, 'circle-color': '#0071e3', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff',
      } });
      setReady(true);
    });
    map.on('click', (e) => {
      if (pickRef.current.pickLabel && pickRef.current.onPick) pickRef.current.onPick([e.lngLat.lng, e.lngLat.lat]);
    });
    const canvas = map.getCanvasContainer();
    const onKey = (e: KeyboardEvent) => {
      if (!pickRef.current.pickLabel) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        const c = map.getCenter();
        pickRef.current.onPick?.([c.lng, c.lat]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        pickRef.current.onCancelPick?.();
      }
    };
    canvas.addEventListener('keydown', onKey);
    return () => {
      canvas.removeEventListener('keydown', onKey);
      map.remove();
      mapRef.current = null;
    };
    // the map is created once; later prop changes are applied by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Accessible name for the canvas (localised).
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) {
      canvas.setAttribute('aria-label', pickLabel ? t('plan.mapPickActive', { field: pickLabel }) : t('map.label'));
      canvas.setAttribute('role', 'application');
    }
  }, [t, pickLabel, ready]);

  // Routes (colours follow the theme).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('routes') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: routes.map((r, i) => ({
        type: 'Feature', geometry: r.geometry, properties: { index: i, selected: r.id === (selectedId ?? routes[0]?.id) },
      })),
    });
    for (let i = 0; i < 3; i++) map.setPaintProperty(`route-${i}`, 'line-color', cssVar(`--c-route-${i + 1}`));
    map.setPaintProperty('route-casing', 'line-color', cssVar('--c-card'));
    // Draw the selected route on top.
    const sel = routes.findIndex((r) => r.id === selectedId);
    if (sel >= 0) map.moveLayer(`route-${sel}`);
    if (routes.length > 0) {
      const b = bboxOf(routes.flatMap((r) => r.geometry.coordinates));
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: fitPadding(map, obstruct), duration: reduced ? 0 : 600, maxZoom: 17 });
    }
  }, [routes, selectedId, ready, settings.ui.theme, reduced]);

  // Start/destination markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    ([[origin, 'A', t('map.origin')], [destination, 'B', t('map.destination')]] as const).forEach(([loc, letter, title]) => {
      if (!loc) return;
      const el = document.createElement('div');
      el.setAttribute('aria-hidden', 'true');
      el.title = `${title}: ${loc.label}`;
      el.style.cssText = 'width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font:600 15px var(--font-display);'
        + `background:${letter === 'A' ? 'var(--c-card)' : 'var(--c-ink)'};color:${letter === 'A' ? 'var(--c-ink)' : 'var(--c-card)'};`
        + 'border:3px solid var(--c-ink);box-shadow:0 0 0 2px var(--c-card),0 4px 12px rgb(0 0 0/.25)';
      el.textContent = letter;
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([loc.lon, loc.lat]).addTo(map));
    });
    if (routes.length === 0) {
      const pts = [origin, destination].filter(Boolean) as ChosenLocation[];
      if (pts.length === 1) map.easeTo({ center: [pts[0].lon, pts[0].lat], zoom: Math.max(map.getZoom(), 16), duration: reduced ? 0 : 500 });
    }
  }, [origin, destination, t, routes.length, reduced]);

  // Focus requests (e.g. "Show on map" next to a warning).
  useEffect(() => {
    if (focus && mapRef.current) mapRef.current.easeTo({ center: focus.lngLat, zoom: 18, duration: reduced ? 0 : 600 });
  }, [focus, reduced]);

  // Current position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource('position') as GeoJSONSource;
    if (!position) {
      src.setData(EMPTY);
      return;
    }
    const metersPerPx = (156543.03 * Math.cos((position.lngLat[1] * Math.PI) / 180)) / 2 ** map.getZoom();
    src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: position.lngLat },
      properties: { radiusPx: Math.min(200, position.accuracyM / metersPerPx) } }] });
  }, [position, ready]);

  // Overlays loaded for the visible area.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;
    const refresh = async () => {
      const b = map.getBounds();
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(5)).join(',');
      const small = b.getEast() - b.getWest() <= 0.05 && b.getNorth() - b.getSouth() <= 0.05;
      setZoomTooLow(layers.features && !small);
      try {
        const [obs, feat, cov] = await Promise.all([
          layers.obstacles && b.getEast() - b.getWest() < 0.5 ? api.obstacles(bbox) : Promise.resolve(null),
          layers.features && small ? api.mapFeatures(bbox) : Promise.resolve(null),
          layers.coverage && b.getEast() - b.getWest() < 0.4 ? api.coverage(bbox) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        (map.getSource('obstacles') as GeoJSONSource).setData(obs ? {
          type: 'FeatureCollection',
          features: obs.map((o) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [o.lon, o.lat] }, properties: { verified: o.verified } })),
        } : EMPTY);
        (map.getSource('features') as GeoJSONSource).setData(feat ?? EMPTY);
        (map.getSource('coverage') as GeoJSONSource).setData(cov?.grid ?? EMPTY);
      } catch {
        /* overlays are optional; failures leave them empty */
      }
    };
    void refresh();
    map.on('moveend', refresh);
    return () => {
      cancelled = true;
      map.off('moveend', refresh);
    };
  }, [layers, ready]);

  if (failed) {
    return <p role="status" className="m-4 rounded-[14px] bg-fill p-4">{t('common.mapUnavailable')}</p>;
  }

  return (
    <div className="relative flex h-full min-h-[18rem] flex-col">
      <div ref={container} className="flex-1" />
      {pickLabel && (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2">
            <div className="absolute left-1/2 top-0 h-full w-1 -translate-x-1/2 rounded-full bg-ink shadow-[0_0_0_2px_var(--c-card)]" />
            <div className="absolute left-0 top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-ink shadow-[0_0_0_2px_var(--c-card)]" />
          </div>
          <div className="glass absolute left-1/2 top-3 w-[min(26rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-card p-4">
            <p className="font-medium">{t('plan.mapPickActive', { field: pickLabel })}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => { const c = mapRef.current?.getCenter(); if (c) onPick?.([c.lng, c.lat]); }}>
                {t('map.pickHere')}
              </Button>
              <Button variant="secondary" onClick={onCancelPick}>{t('plan.mapPickCancel')}</Button>
            </div>
          </div>
        </>
      )}
      <details className="glass group absolute right-2.5 top-[118px] max-w-[min(18rem,calc(100%-1.25rem))] rounded-[14px] text-[0.9375rem]">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[14px] px-3 font-medium [&::-webkit-details-marker]:hidden">
          <Layers aria-hidden="true" className="size-5" />
          {t('map.layers')}
        </summary>
        <div className="rows px-3 pb-2">
          <Checkbox label={t('map.obstacles')} checked={layers.obstacles} onChange={(v) => setLayers((l) => ({ ...l, obstacles: v }))} />
          <Checkbox label={t('map.features')} checked={layers.features} onChange={(v) => setLayers((l) => ({ ...l, features: v }))}
            hint={zoomTooLow ? t('map.zoomIn') : undefined} />
          <Checkbox label={t('map.coverage')} checked={layers.coverage} onChange={(v) => setLayers((l) => ({ ...l, coverage: v }))}
            hint={layers.coverage ? t('map.coverageScale') : undefined} />
          <div className="flex flex-col gap-1 py-2.5 text-[0.875rem]">
            <p className="flex items-center gap-2"><span aria-hidden="true" className="inline-block size-4 rounded-full border-[3px] border-white bg-issue" />{t('map.legendVerified')}</p>
            <p className="flex items-center gap-2"><span aria-hidden="true" className="inline-block size-4 rounded-full border-[3px] border-issue bg-white" />{t('map.legendPending')}</p>
          </div>
        </div>
      </details>
    </div>
  );
}
