import type { FeatureCollection } from 'geojson';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Layers } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { ChosenLocation, LngLat, Names, ParkingSpot, RouteOption } from '../api/types';
import { currentLanguage } from '../i18n';
import { pickName } from '../lib/format';
import { bboxOf, distanceM } from '../lib/geo';
import { prefersReducedMotion, useSettings } from '../settings/SettingsContext';
import { parkingLabel } from './Parking';
import { Button, Checkbox } from './ui';

const STYLE_URL = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ?? 'https://tiles.openfreemap.org/styles/liberty';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const DASHES: (number[] | undefined)[] = [undefined, [2.5, 1.5], [0.5, 1.5]];
/** Room around fitted routes: the floating controls sit top right and the sheet overlaps the bottom edge. */
const FIT_PADDING = { top: 70, right: 60, bottom: 90, left: 50 };

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#0071e3';
}

/**
 * Blue square with the wheelchair symbol, as painted on reserved bays. Its
 * square shape sets it apart from the round obstacle and feature markers.
 */
function parkingIcon(): ImageData | null {
  const size = 64;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  ctx.canvas.width = ctx.canvas.height = size;
  ctx.fillStyle = '#1659b8';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(3, 3, size - 6, size - 6, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(30, 15, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(29, 23);
  ctx.lineTo(29, 37);
  ctx.lineTo(41, 37);
  ctx.lineTo(45, 48);
  ctx.moveTo(29, 29);
  ctx.lineTo(39, 29);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(28, 41, 11, 0.15 * Math.PI, 1.3 * Math.PI);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

/** Names of a base map place label (OpenMapTiles `poi` layer). */
function tileNames(p: Record<string, unknown>): Names {
  const s = (k: string) => (typeof p[k] === 'string' && p[k] ? p[k] as string : undefined);
  return { default: s('name'), mk: s('name:mk'), sq: s('name:sq'), en: s('name:en') ?? s('name_en'), latn: s('name:latin') };
}

export interface MapFocus {
  lngLat: LngLat;
  nonce: number;
}

/**
 * Visual map. Every piece of information shown here is also available as text
 * elsewhere; the map is never required. Keyboard: arrows pan, +/- zoom, and in
 * pick mode Enter chooses the centre point.
 */
export function MapView({ center, zoom, routes, selectedId, origin, destination, pickLabel, onPick, onCancelPick, focus, position,
  parking, onViewChange, onPlaceSelect }: {
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
  /** Disabled parking to draw; null or undefined draws none. */
  parking?: ParkingSpot[] | null;
  /** Called with the visible area after every move (and once when ready). */
  onViewChange?: (view: { center: LngLat; radiusM: number }) => void;
  /** Called when a parking sign or a named place on the base map is chosen as start or destination. */
  onPlaceSelect?: (place: ChosenLocation, field: 'origin' | 'destination') => void;
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
  const parkingRef = useRef({ parking, onViewChange, onPlaceSelect, t });
  parkingRef.current = { parking, onViewChange, onPlaceSelect, t };
  const popup = useRef<maplibregl.Popup | null>(null);
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
      ['routes', 'obstacles', 'features', 'coverage', 'parking', 'position'].forEach(add);
      const icon = parkingIcon();
      if (icon) map.addImage('parking-disabled', icon, { pixelRatio: 2 });
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
      if (icon) map.addLayer({ id: 'parking', type: 'symbol', source: 'parking', layout: {
        'icon-image': 'parking-disabled', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 16, 1],
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
      reportView();
    });
    const reportView = () => {
      const c = map.getCenter();
      const ne = map.getBounds().getNorthEast();
      parkingRef.current.onViewChange?.({ center: [c.lng, c.lat], radiusM: distanceM([c.lng, c.lat], [ne.lng, ne.lat]) });
    };
    map.on('moveend', reportView);
    // Shops, malls and other named places drawn by the base map style.
    const poiLayers = () => (map.getStyle()?.layers ?? [])
      .filter((l) => l.type === 'symbol' && 'source-layer' in l && l['source-layer'] === 'poi').map((l) => l.id);
    /** Names a tapped place and offers it as start or destination. */
    const openChooser = (place: ChosenLocation) => {
      const { onPlaceSelect: select, t: tr } = parkingRef.current;
      const body = document.createElement('div');
      body.className = 'flex flex-col gap-2';
      const title = document.createElement('p');
      title.className = 'font-semibold pr-10 text-[1.0625rem]';
      title.textContent = place.label;
      body.append(title);
      if (select) {
        for (const field of ['origin', 'destination'] as const) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'min-h-11 rounded-pill bg-tint px-4 font-medium text-link hover:bg-fill';
          b.textContent = tr(field === 'origin' ? 'parking.useOrigin' : 'parking.useDestination');
          b.addEventListener('click', () => {
            popup.current?.remove();
            select(place, field);
          });
          body.append(b);
        }
      }
      popup.current?.remove();
      // Open downwards near the top, where the floating buttons are, and inwards near the sides.
      const at = map.project([place.lon, place.lat]);
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      const side = at.x < w * 0.3 ? '-left' : at.x > w * 0.7 ? '-right' : '';
      const anchor = `${at.y < h * 0.45 ? 'top' : 'bottom'}${side}` as maplibregl.PositionAnchor;
      popup.current = new maplibregl.Popup({ maxWidth: '16rem', className: 'map-popup', anchor, offset: 18 })
        .setLngLat([place.lon, place.lat]).setDOMContent(body).addTo(map);
    };
    /** The parking sign or named place under a point, topmost first; a little slack for fingers. */
    const placeAt = (pt: maplibregl.Point): ChosenLocation | null => {
      const layers = [...(map.getLayer('parking') ? ['parking'] : []), ...poiLayers()];
      if (!layers.length) return null;
      const box: [[number, number], [number, number]] = [[pt.x - 6, pt.y - 6], [pt.x + 6, pt.y + 6]];
      for (const f of map.queryRenderedFeatures(box, { layers })) {
        const { parking: spots, t: tr } = parkingRef.current;
        if (f.layer.id === 'parking') {
          const spot = spots?.find((p) => p.id === f.properties?.id);
          if (spot) return { lat: spot.lat, lon: spot.lon, label: parkingLabel(spot, tr('parking.unnamed')), source: 'search' };
        } else if (f.geometry.type === 'Point') {
          const label = pickName(tileNames(f.properties ?? {}), currentLanguage());
          const [lon, lat] = f.geometry.coordinates;
          if (label) return { lat, lon, label, source: 'search' };
        }
      }
      return null;
    };
    map.on('click', (e) => {
      if (pickRef.current.pickLabel) {
        pickRef.current.onPick?.([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      const place = placeAt(e.point);
      if (place) openChooser(place);
    });
    map.on('mousemove', (e) => {
      map.getCanvas().style.cursor = !pickRef.current.pickLabel && placeAt(e.point) ? 'pointer' : '';
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
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: FIT_PADDING, duration: reduced ? 0 : 600, maxZoom: 17 });
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

  // Disabled parking (loaded by the page, which also lists it as text).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('parking') as GeoJSONSource).setData(parking ? {
      type: 'FeatureCollection',
      features: parking.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { id: p.id } })),
    } : EMPTY);
    if (!parking) popup.current?.remove();
  }, [parking, ready]);

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
      <details className="glass group absolute right-2.5 top-[118px] max-h-[calc(100%-128px)] max-w-[min(18rem,calc(100%-1.25rem))] overflow-y-auto rounded-[14px] text-[0.9375rem]">
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
