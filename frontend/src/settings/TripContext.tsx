import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ChosenLocation, RouteRequest, RouteResponse } from '../api/types';

/**
 * The current trip lives in memory only: no location history is stored
 * on the device or the server.
 */
interface Trip {
  origin: ChosenLocation | null;
  destination: ChosenLocation | null;
  response: RouteResponse | null;
  lastRequest: RouteRequest | null;
  selectedId: string | null;
  setOrigin: (l: ChosenLocation | null) => void;
  setDestination: (l: ChosenLocation | null) => void;
  setResult: (req: RouteRequest, r: RouteResponse | null) => void;
  select: (id: string) => void;
}

const Ctx = createContext<Trip | null>(null);

export function TripProvider({ children }: { children: ReactNode }) {
  const [origin, setOrigin] = useState<ChosenLocation | null>(null);
  const [destination, setDestination] = useState<ChosenLocation | null>(null);
  const [response, setResponse] = useState<RouteResponse | null>(null);
  const [lastRequest, setLastRequest] = useState<RouteRequest | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const value = useMemo<Trip>(() => ({
    origin, destination, response, lastRequest, selectedId,
    setOrigin, setDestination,
    setResult: (req, r) => {
      setLastRequest(req);
      setResponse(r);
      setSelectedId(r?.routes[0]?.id ?? null);
    },
    select: setSelectedId,
  }), [origin, destination, response, lastRequest, selectedId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTrip() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTrip outside TripProvider');
  return c;
}

export function selectedRoute(trip: Pick<Trip, 'response' | 'selectedId'>) {
  return trip.response?.routes.find((r) => r.id === trip.selectedId) ?? trip.response?.routes[0] ?? null;
}
