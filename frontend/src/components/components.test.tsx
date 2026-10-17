import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import type { RouteResponse } from '../api/types';
import { DEFAULT_SETTINGS, SettingsProvider } from '../settings/SettingsContext';
import { AnnouncerProvider } from './Announcer';
import { LocationInput } from './LocationInput';
import { RouteResults } from './RouteResults';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsProvider initial={DEFAULT_SETTINGS}>
        <AnnouncerProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </AnnouncerProvider>
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.restoreAllMocks();
});

describe('LocationInput', () => {
  it('is an ARIA combobox operable with the keyboard', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
      { id: 'p1', kind: 'POI', category: 'place=square', names: { default: 'Плоштад Македонија', en: 'Macedonia Square' }, lat: 41.996, lon: 21.432 },
    ]), { headers: { 'Content-Type': 'application/json' } }));
    const onChange = vi.fn();
    wrap(<LocationInput label="Start" value={null} onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: 'Start' });
    await userEvent.type(input, 'maked');
    const option = await screen.findByRole('option', { name: /Macedonia Square/ });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', option.id);
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lat: 41.996, lon: 21.432, source: 'search' }));
  });

  it('accepts typed coordinates without the map', async () => {
    const onChange = vi.fn();
    wrap(<LocationInput label="Start" value={null} onChange={onChange} />);
    await userEvent.type(screen.getByRole('combobox'), '41.9961, 21.4316');
    await userEvent.click(await screen.findByRole('option', { name: /Use coordinates/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lat: 41.9961, lon: 21.4316, source: 'coordinates' }));
  });
});

const noRoute: RouteResponse = {
  profile: 'WHEELCHAIR', preferences: {}, routes: [],
  noRoute: { reason: 'CONSTRAINTS_UNSATISFIABLE', blockingFeatures: [{ type: 'STAIRS', count: 2, locations: [[21.43, 42]] }], shortestUnconstrainedM: 420 },
  dataNotice: { code: 'ROUTE_NOT_GUARANTEED', sources: [] },
};

describe('RouteResults', () => {
  it('explains why no route exists instead of relaxing requirements', async () => {
    wrap(<RouteResults response={noRoute} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByRole('heading', { name: 'No route meets these needs' })).toBeInTheDocument();
    expect(screen.getByText('2 sets of stairs')).toBeInTheDocument();
    expect(screen.getByText(/never loosened/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No route meets these needs'));
  });

  it('shows the not-guaranteed notice and textual steps for a route', () => {
    const resp: RouteResponse = {
      ...noRoute, noRoute: null,
      routes: [{
        id: 'r1', kinds: ['RECOMMENDED'], distanceM: 500, durationS: 420,
        geometry: { type: 'LineString', coordinates: [[21.43, 42], [21.435, 42]] },
        instructions: [
          { index: 0, type: 'DEPART', modifier: 'E', distanceM: 500, startDistanceM: 0, names: { en: 'Test Street' }, pathClass: 'SIDEWALK', location: [21.43, 42], notes: [] },
          { index: 1, type: 'ARRIVE', distanceM: 0, startDistanceM: 500, names: {}, location: [21.435, 42], notes: [] },
        ],
        summary: { stairs: 0, stairsWithHandrail: 0, crossings: 0, crossingsWithSignals: 0, crossingsWithSound: 0, crossingsWithTactile: 0,
          crossingsUnmarked: 0, crossingsKerbUnknown: 0, raisedKerbs: 0, steepSections: [], roughSurfaceM: 0, unknownSurfaceM: 500,
          carriagewayM: 0, unknownSidewalkM: 0, unlitM: 0, unknownLitM: 500, narrowM: 0, benchesNearRoute: 0, pathClassM: {} },
        coverage: { score: 0.1, level: 'LOW', knownSurfacePct: 0, knownWidthPct: 0, mappedInclinePct: 0, estimatedInclinePct: 100, knownLitPct: 0, crossingsCompletePct: 100 },
        suitability: { level: 'PARTLY_UNKNOWN', indicators: [{ need: 'SURFACE', status: 'UNKNOWN' }] },
        warnings: [{ code: 'SURFACE_UNKNOWN', severity: 'CAUTION', lengthM: 500 }],
        obstacles: [], explanation: { reasons: ['SAME_AS_SHORTEST_WALK'], extraDistanceM: 0, avoidedComparedToShortest: {} },
      }],
    };
    wrap(<RouteResults response={resp} selectedId="r1" onSelect={() => {}} />);
    expect(screen.getByText(/not guaranteed to be accessible or safe/)).toBeInTheDocument();
    expect(screen.getByText('Some details are not mapped')).toBeInTheDocument();
    expect(screen.getByText(/Head east on Test Street for 500 m/)).toBeInTheDocument();
    expect(screen.getByText(/Surface not mapped for 500 m/)).toBeInTheDocument();
    // Steps are an ordered list for screen readers.
    expect(screen.getAllByRole('list').some((l) => l.tagName === 'OL')).toBe(true);
  });
});
