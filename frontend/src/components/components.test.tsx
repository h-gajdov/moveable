import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import type { LngLat, ParkingSpot, RouteResponse } from '../api/types';
import { DEFAULT_SETTINGS, SettingsProvider, useSettings } from '../settings/SettingsContext';
import { AnnouncerProvider } from './Announcer';
import { LocationInput } from './LocationInput';
import { RouteResults } from './RouteResults';
import { ParkingList, ParkingToggle, useParking } from './Parking';

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

describe('Disabled parking', () => {
  function Harness({ onSelect = vi.fn(), onShowOnMap }: {
    onSelect?: (p: ParkingSpot, field: 'origin' | 'destination') => void; onShowOnMap?: (p: ParkingSpot) => void;
  }) {
    const { settings } = useSettings();
    const area = { center: [21.43, 42] as LngLat, radiusM: 1234, label: 'the centre of the map' };
    const query = useParking(area, settings.ui.showParking);
    return <>
      <ParkingToggle />
      {settings.ui.showParking && <ParkingList area={area} query={query} onSelect={onSelect} onShowOnMap={onShowOnMap} />}
    </>;
  }

  it('is hidden until the toggle is pressed, then lists spots and offers them as start', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
      { id: 'p1', names: {}, lat: 41.996, lon: 21.432, distanceM: 100 },
    ])));
    const onSelect = vi.fn();
    wrap(<Harness onSelect={onSelect} onShowOnMap={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Parking for disabled people' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('heading', { name: 'Disabled parking' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText(/1 mapped parking locations near the centre of the map/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/places/parking?lat=42&lon=21.43&radiusM=1300&limit=50'), expect.anything());
    expect(screen.getByRole('heading', { name: 'Disabled parking (unnamed)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use as start' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 'origin');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('heading', { name: 'Disabled parking' })).not.toBeInTheDocument();
  });

  it('explains that an empty result does not establish absence of parking', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    wrap(<Harness onShowOnMap={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Parking for disabled people' }));
    expect(await screen.findByText(/This does not mean no spaces exist\. Move the map/)).toBeInTheDocument();
  });
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
