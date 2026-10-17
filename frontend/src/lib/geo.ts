import type { LngLat, Warning } from '../api/types';

const R = 6_371_008.8;

export function distanceM(a: LngLat, b: LngLat): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface Projection {
  /** Distance along the line to the projected point (m). */
  alongM: number;
  /** Distance from the point to the line (m). */
  offsetM: number;
}

/**
 * Project a point onto a polyline using a local equirectangular approximation
 * (accurate to well under a metre at city scale).
 */
export function projectOnLine(p: LngLat, line: LngLat[]): Projection {
  const kx = Math.cos((p[1] * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  let best: Projection = { alongM: 0, offsetM: Infinity };
  let along = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
    const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const tt = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const cx = ax + tt * dx, cy = ay + tt * dy;
    const off = Math.hypot(cx, cy);
    const segLen = Math.sqrt(len2);
    if (off < best.offsetM) best = { alongM: along + tt * segLen, offsetM: off };
    along += segLen;
  }
  return best;
}

export function lineLength(line: LngLat[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += distanceM(line[i - 1], line[i]);
  return s;
}

export function bboxOf(points: LngLat[], padDeg = 0): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return [minX - padDeg, minY - padDeg, maxX + padDeg, maxY + padDeg];
}

/** Parse "42.0, 21.43" style input as coordinates (lat, lon). */
export function parseCoordinates(text: string): { lat: number; lon: number } | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(',', '.'));
  const lon = parseFloat(m[2].replace(',', '.'));
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export type Severity = Warning['severity'];
/** Most severe first. */
export const SEVERITIES: Severity[] = ['WARNING', 'CAUTION', 'INFO'];

export interface RouteFlag {
  at: LngLat;
  severity: Severity;
  warnings: Warning[];
}

/** One flag per place along the route; warnings at the same place share it and it flies the most severe. */
export function routeFlags(warnings: Warning[]): RouteFlag[] {
  const byPlace = new Map<string, RouteFlag>();
  for (const w of warnings) {
    for (const at of w.locations ?? (w.location ? [w.location] : [])) {
      const key = `${at[0].toFixed(6)},${at[1].toFixed(6)}`;
      const flag = byPlace.get(key) ?? { at, severity: w.severity, warnings: [] };
      if (!flag.warnings.includes(w)) flag.warnings.push(w);
      if (SEVERITIES.indexOf(w.severity) < SEVERITIES.indexOf(flag.severity)) flag.severity = w.severity;
      byPlace.set(key, flag);
    }
  }
  return [...byPlace.values()];
}
