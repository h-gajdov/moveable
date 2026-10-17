import type { FeatureCollection } from 'geojson';
import type {
  AppConfig, ObstacleReportInput, ObstacleView, Place, Profile, RouteRequest, RouteResponse,
} from './types';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

/** An error the UI can translate: `code` maps to an i18n key under `errors.`. */
export class ApiError extends Error {
  constructor(public code: string, public status: number, message?: string) {
    super(message ?? code);
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (init.signal) {
    init.signal.addEventListener('abort', () => controller.abort());
  }
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted && !init.signal?.aborted) {
      throw new ApiError('TIMEOUT', 0);
    }
    if (init.signal?.aborted) {
      throw e;
    }
    throw new ApiError(navigator.onLine === false ? 'OFFLINE' : 'NETWORK', 0);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let code = res.status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
    try {
      const body = await res.json();
      if (body && typeof body.code === 'string') code = body.code;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(code, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  config: () => request<AppConfig>('/api/config'),
  profiles: () => request<{ profiles: Profile[] }>('/api/routing-profiles'),
  route: (req: RouteRequest, signal?: AbortSignal) => request<RouteResponse>('/api/routes', { ...json(req), signal }, 60_000),
  places: (q: string, signal?: AbortSignal) =>
    request<Place[]>(`/api/places?q=${encodeURIComponent(q)}&limit=8`, { signal }),
  reverse: (lat: number, lon: number) =>
    request<{ lat: number; lon: number; street?: { names: Record<string, string>; distanceM: number } }>(
      `/api/places/reverse?lat=${lat}&lon=${lon}`),
  obstacles: (bbox: string) => request<ObstacleView[]>(`/api/obstacles?bbox=${bbox}`),
  mapFeatures: (bbox: string) => request<FeatureCollection>(`/api/map-features?bbox=${bbox}`),
  coverage: (bbox: string) =>
    request<{ summary: Record<string, number>; grid?: FeatureCollection }>(`/api/coverage?bbox=${bbox}&grid=true`),
  report: (input: ObstacleReportInput, photo?: File | null) => {
    if (!photo) return request<{ id: string; status: string }>('/api/obstacles/reports', json(input));
    const form = new FormData();
    form.append('report', new Blob([JSON.stringify(input)], { type: 'application/json' }));
    form.append('photo', photo);
    return request<{ id: string; status: string }>('/api/obstacles/reports', { method: 'POST', body: form }, 60_000);
  },
  confirmObstacle: (id: string) => request<ObstacleView>(`/api/obstacles/${id}/confirm`, { method: 'POST' }),
};

/** Admin calls carry HTTP Basic credentials held in memory only. */
export function adminApi(username: string, password: string) {
  const auth = { Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(`${username}:${password}`))) };
  return {
    me: () => request<{ username: string; roles: string[] }>('/api/admin/me', { headers: auth }),
    reports: (status: string, page = 0) =>
      request<{ items: AdminReport[]; totalItems: number; totalPages: number; page: number }>(
        `/api/admin/reports?status=${status}&page=${page}&size=20`, { headers: auth }),
    report: (id: string) =>
      request<{ report: AdminReport; history: { from: string; to: string; by: string; note: string; at: string }[] }>(
        `/api/admin/reports/${id}`, { headers: auth }),
    setStatus: (id: string, status: string, note?: string, extendDays?: number) =>
      request<AdminReport>(`/api/admin/reports/${id}/status`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note: note || undefined, extendDays }),
      }),
    photoUrl: (id: string) => `/api/admin/reports/${id}/photo`,
    photo: async (id: string) => {
      const res = await fetch(`${BASE}/api/admin/reports/${id}/photo`, { headers: auth });
      if (!res.ok) throw new ApiError('PHOTO_NOT_FOUND', res.status);
      return URL.createObjectURL(await res.blob());
    },
    ingestionRuns: () => request<IngestionRun[]>('/api/admin/ingestion-runs', { headers: auth }),
  };
}

export interface AdminReport {
  id: string;
  category: string;
  impact: string;
  status: string;
  lat: number;
  lon: number;
  description?: string | null;
  hasPhoto: boolean;
  temporary: boolean;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lastConfirmedAt: string;
  confirmations: number;
  language?: string | null;
}

export interface IngestionRun {
  id: number;
  region: string;
  source: string;
  startedAt: string;
  finishedAt?: string | null;
  status: string;
  sourceVersion?: string | null;
  stats: Record<string, unknown>;
}
