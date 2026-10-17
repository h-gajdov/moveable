// Mirrors the backend records in mk.accessibleskopje.routing.RouteApi.

export type LngLat = [number, number];
export type Names = Partial<Record<'default' | 'mk' | 'sq' | 'en' | 'latn', string>>;

export interface RoutingPreferences {
  wheeled?: boolean | null;
  visualGuidance?: boolean | null;
  avoidStairs?: boolean | null;
  maxInclinePct?: number | null;
  minWidthM?: number | null;
  maxKerbHeightCm?: number | null;
  avoidRoughSurfaces?: boolean | null;
  preferPedestrianAreas?: boolean | null;
  preferAccessibleCrossings?: boolean | null;
  minimizeTrafficExposure?: boolean | null;
  preferSimpleIntersections?: boolean | null;
  minimizeDistance?: boolean | null;
  preferRestingSpots?: boolean | null;
  preferLitPaths?: boolean | null;
  walkingSpeedMps?: number | null;
}

export type ProfileCode = 'STANDARD' | 'WHEELCHAIR' | 'VISUALLY_IMPAIRED' | 'REDUCED_MOBILITY' | 'CUSTOM';

export interface Profile {
  code: ProfileCode;
  defaults: RoutingPreferences;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RouteRequest {
  origin: LatLon;
  destination: LatLon;
  profile: ProfileCode;
  preferences?: RoutingPreferences;
  alternatives?: boolean;
}

export interface SnappedPoint {
  lat: number;
  lon: number;
  requestedLat: number;
  requestedLon: number;
  snapDistanceM: number;
  streetNames?: Names;
}

export interface CrossingDetails {
  type?: string | null;
  signals?: boolean | null;
  sound?: boolean | null;
  vibration?: boolean | null;
  tactilePaving?: boolean | null;
  island?: boolean | null;
  kerb?: string | null;
  kerbHeightCm?: number | null;
}

export interface Instruction {
  index: number;
  type: 'DEPART' | 'TURN' | 'CONTINUE' | 'CROSS' | 'STAIRS' | 'ARRIVE';
  modifier?: string | null;
  distanceM: number;
  startDistanceM: number;
  names: Names;
  pathClass?: string | null;
  location: LngLat;
  bearing?: number | null;
  crossing?: CrossingDetails | null;
  stairs?: { direction: 'UP' | 'DOWN' | 'UNKNOWN'; stepCount?: number | null; handrail?: boolean | null; ramp?: boolean | null } | null;
  notes: string[];
}

export interface SteepSection {
  lengthM: number;
  maxPct: number;
  source: 'MAPPED' | 'ESTIMATED';
  location?: LngLat | null;
}

export interface RouteSummary {
  stairs: number;
  stairsWithHandrail: number;
  crossings: number;
  crossingsWithSignals: number;
  crossingsWithSound: number;
  crossingsWithTactile: number;
  crossingsUnmarked: number;
  crossingsKerbUnknown: number;
  raisedKerbs: number;
  steepSections: SteepSection[];
  roughSurfaceM: number;
  unknownSurfaceM: number;
  carriagewayM: number;
  unknownSidewalkM: number;
  unlitM: number;
  unknownLitM: number;
  narrowM: number;
  benchesNearRoute: number;
  pathClassM: Record<string, number>;
}

export interface Coverage {
  score: number;
  level: 'GOOD' | 'PARTIAL' | 'LOW';
  knownSurfacePct: number;
  knownWidthPct: number;
  mappedInclinePct: number;
  estimatedInclinePct: number;
  knownLitPct: number;
  crossingsCompletePct: number;
}

export interface Indicator {
  need: string;
  status: 'OK' | 'PROBLEM' | 'UNKNOWN';
  detail?: string | null;
}

export interface Warning {
  code: string;
  severity: 'INFO' | 'CAUTION' | 'WARNING';
  count?: number | null;
  lengthM?: number | null;
  /** The first place it occurs. */
  location?: LngLat | null;
  /** Every place along the route where it occurs; flagged on the map. */
  locations?: LngLat[] | null;
}

export interface NearbyObstacle {
  id: string;
  category: string;
  impact: string;
  status: 'VERIFIED' | 'PENDING';
  lat: number;
  lon: number;
  distanceM: number;
  lastConfirmedAt: string;
  affectsRouting: boolean;
}

export interface RouteOption {
  id: string;
  kinds: string[];
  distanceM: number;
  durationS: number;
  geometry: { type: 'LineString'; coordinates: LngLat[] };
  instructions: Instruction[];
  summary: RouteSummary;
  coverage: Coverage;
  suitability: { level: 'NO_KNOWN_ISSUES' | 'PARTLY_UNKNOWN' | 'HAS_KNOWN_ISSUES'; indicators: Indicator[] };
  warnings: Warning[];
  obstacles: NearbyObstacle[];
  explanation: { reasons: string[]; extraDistanceM?: number | null; avoidedComparedToShortest: Record<string, number> };
}

export interface BlockingFeature {
  type: string;
  count: number;
  locations: LngLat[];
}

export interface RouteResponse {
  profile: ProfileCode;
  preferences: RoutingPreferences;
  origin?: SnappedPoint | null;
  destination?: SnappedPoint | null;
  routes: RouteOption[];
  noRoute?: { reason: string; blockingFeatures: BlockingFeature[]; shortestUnconstrainedM?: number | null } | null;
  dataNotice: { code: string; osmDataTimestamp?: string | null; sources: string[] };
}

export interface Place {
  id: string;
  kind: 'STREET' | 'POI' | 'ADDRESS';
  category?: string | null;
  names: Names;
  lat: number;
  lon: number;
}

/** Mapped disabled parking (not live availability). */
export interface ParkingSpot {
  id: string;
  names: Names;
  lat: number;
  lon: number;
  /** Straight-line distance from the search point. */
  distanceM: number;
}

export interface AppConfig {
  region: { code: string; names: Names; bbox: [number, number, number, number]; center: LngLat; zoom: number };
  obstacleCategories: string[];
  obstacleImpacts: string[];
  attribution: { name: string; url: string; license: string }[];
}

export interface ObstacleView {
  id: string;
  category: string;
  impact: string;
  status: 'VERIFIED' | 'PENDING';
  verified: boolean;
  lat: number;
  lon: number;
  description?: string | null;
  hasPhoto: boolean;
  temporary: boolean;
  expiresAt?: string | null;
  createdAt: string;
  lastConfirmedAt: string;
  confirmations: number;
}

export interface ObstacleReportInput {
  lat: number;
  lon: number;
  category: string;
  impact: string;
  description?: string;
  temporary?: boolean;
  durationDays?: number;
  language?: string;
  website?: string;
}

/** A location chosen by the user, with how it was chosen (for accessible labelling). */
export interface ChosenLocation {
  lat: number;
  lon: number;
  label: string;
  source: 'search' | 'gps' | 'map' | 'coordinates';
  accuracyM?: number;
}
