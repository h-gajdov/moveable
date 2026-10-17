-- Accessible Skopje: core schema.
-- Geometry is stored in WGS84 (EPSG:4326). Metric calculations use ::geography.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Regions (the graph is multi-city ready; Skopje is the first region)
-- ---------------------------------------------------------------------------
CREATE TABLE region (
    code        text PRIMARY KEY,
    names       jsonb NOT NULL,
    bbox        geometry(Polygon, 4326) NOT NULL,
    center      geometry(Point, 4326) NOT NULL,
    default_zoom smallint NOT NULL DEFAULT 13,
    created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO region (code, names, bbox, center, default_zoom) VALUES (
    'skopje',
    '{"en": "Skopje", "mk": "Скопје", "sq": "Shkup"}',
    ST_MakeEnvelope(21.28, 41.92, 21.62, 42.08, 4326),
    ST_SetSRID(ST_MakePoint(21.4314, 41.9965), 4326),
    14
);

-- ---------------------------------------------------------------------------
-- Data provenance
-- ---------------------------------------------------------------------------
CREATE TABLE data_source (
    id                 smallserial PRIMARY KEY,
    code               text NOT NULL UNIQUE,
    name               text NOT NULL,
    kind               text NOT NULL CHECK (kind IN ('OSM', 'MUNICIPAL', 'USER_REPORT', 'DERIVED', 'OTHER')),
    url                text,
    license            text,
    attribution        text,
    integration_status text NOT NULL CHECK (integration_status IN ('INTEGRATED', 'NOT_INTEGRATED', 'UNAVAILABLE', 'PLANNED')),
    version            text,
    retrieved_at       timestamptz,
    notes              text
);

INSERT INTO data_source (code, name, kind, url, license, attribution, integration_status, notes) VALUES
('osm', 'OpenStreetMap (Geofabrik extract for North Macedonia)', 'OSM',
 'https://download.geofabrik.de/europe/macedonia.html', 'ODbL 1.0', '© OpenStreetMap contributors',
 'INTEGRATED', 'Pedestrian network, accessibility tags, benches, searchable places.'),
('copernicus_dem', 'Copernicus DEM GLO-30', 'DERIVED',
 'https://registry.opendata.aws/copernicus-dem/', 'Copernicus DEM licence (free use with attribution)',
 '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',
 'INTEGRATED', 'Used only for ESTIMATED slopes (soft penalty + warnings). Surface model: may be inaccurate near buildings, bridges and underpasses.'),
('user_reports', 'Accessible Skopje community obstacle reports', 'USER_REPORT', NULL,
 'ODbL 1.0 (contributions)', 'Accessible Skopje contributors', 'INTEGRATED',
 'Only moderator-verified reports affect routing.'),
('derived', 'Values derived by the Accessible Skopje pipeline', 'DERIVED', NULL, NULL, NULL,
 'INTEGRATED', 'E.g. traffic exposure, surface class, bench proximity.'),
('skopje_gis', 'City of Skopje GIS portal (INFRA layers: sidewalks, kerbs, road damage, traffic signals)', 'MUNICIPAL',
 'https://gisportal.skopje.gov.mk/arcgis/rest/services', 'No open-data licence published', NULL,
 'UNAVAILABLE', 'Layer schemas are public but queries return 0 records (checked 2026-10-17). Not ingested.');

CREATE TABLE ingestion_run (
    id           bigserial PRIMARY KEY,
    region_code  text NOT NULL REFERENCES region (code),
    source_code  text NOT NULL REFERENCES data_source (code),
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    status       text NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
    source_version text,
    stats        jsonb,
    message      text
);

-- ---------------------------------------------------------------------------
-- Routing graph
-- ---------------------------------------------------------------------------
CREATE TABLE routing_node (
    id            bigint PRIMARY KEY,           -- OSM node id
    region_code   text NOT NULL REFERENCES region (code),
    geom          geometry(Point, 4326) NOT NULL,
    degree        smallint NOT NULL DEFAULT 0,
    component_id  bigint,
    tags          jsonb                         -- relevant raw OSM node tags (crossing, kerb, barrier...)
);
CREATE INDEX routing_node_geom_idx ON routing_node USING gist (geom);

CREATE TABLE routing_edge (
    id            bigserial PRIMARY KEY,
    region_code   text NOT NULL REFERENCES region (code),
    source        bigint NOT NULL REFERENCES routing_node (id),
    target        bigint NOT NULL REFERENCES routing_node (id),
    osm_way_id    bigint NOT NULL,
    way_segment   integer NOT NULL,
    geom          geometry(LineString, 4326) NOT NULL,
    length_m      double precision NOT NULL CHECK (length_m > 0),
    highway       text NOT NULL,
    path_class    text NOT NULL,
    road_class    text,
    sidewalk      text,
    names         jsonb,
    component_id  bigint,
    component_size integer,
    source_id     smallint NOT NULL REFERENCES data_source (id),
    imported_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (osm_way_id, way_segment)
);
CREATE INDEX routing_edge_geom_idx ON routing_edge USING gist (geom);
CREATE INDEX routing_edge_source_idx ON routing_edge (source);
CREATE INDEX routing_edge_target_idx ON routing_edge (target);

-- Accessibility attributes, 1:1 with routing_edge. NULL always means "unknown".
CREATE TABLE edge_accessibility (
    edge_id            bigint PRIMARY KEY REFERENCES routing_edge (id) ON DELETE CASCADE,
    surface            text,
    smoothness         text,
    surface_class      text NOT NULL DEFAULT 'UNKNOWN',
    width_m            real,
    width_estimated    boolean,
    incline_pct        real,              -- signed, in the direction of the geometry
    incline_source     text CHECK (incline_source IN ('OSM', 'DEM')),
    incline_hint       text,              -- 'incline' / 'steep' when tagged qualitatively
    is_stairs          boolean NOT NULL DEFAULT false,
    step_count         integer,
    handrail           boolean,
    ramp_wheelchair    boolean,
    kerb_type          text,              -- flush / lowered / rolled / yes(unknown height) / raised
    kerb_height_cm     real,
    wheelchair         text,
    lit                boolean,
    tactile_paving     boolean,
    barrier            text,
    barrier_effect     text CHECK (barrier_effect IN ('MINOR', 'WHEELCHAIR', 'ALL')),
    is_crossing        boolean NOT NULL DEFAULT false,
    crossing_via_node  boolean NOT NULL DEFAULT false,
    crossing_ref       text,
    crossing_type      text,              -- SIGNALS / MARKED / UNMARKED / INFORMAL / NONE
    crossing_markings  boolean,
    crossing_signals   boolean,
    crossing_sound     boolean,
    crossing_vibration boolean,
    crossing_island    boolean,
    crossing_forbidden boolean NOT NULL DEFAULT false,
    traffic_exposure   smallint NOT NULL DEFAULT 0 CHECK (traffic_exposure BETWEEN 0 AND 4),
    carriageway_surface text,
    bench_nearby       boolean NOT NULL DEFAULT false,
    max_node_degree    smallint NOT NULL DEFAULT 0,
    completeness       real NOT NULL DEFAULT 0 CHECK (completeness BETWEEN 0 AND 1)
);

-- Where each attribute value came from. Lets us add municipal data or user
-- reports later without overwriting OSM values.
CREATE TABLE edge_attribute_provenance (
    edge_id      bigint NOT NULL REFERENCES routing_edge (id) ON DELETE CASCADE,
    attribute    text NOT NULL,
    value        text NOT NULL,
    source_id    smallint NOT NULL REFERENCES data_source (id),
    method       text NOT NULL CHECK (method IN ('TAG', 'INFERRED', 'DERIVED_DEM', 'USER_REPORT', 'MUNICIPAL')),
    source_ref   text,                -- e.g. 'node/123:kerb'
    observed_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (edge_id, attribute, source_id)
);

-- Point features that matter for accessibility (benches, toilets, elevators...)
CREATE TABLE accessibility_feature (
    id            bigserial PRIMARY KEY,
    region_code   text NOT NULL REFERENCES region (code),
    feature_type  text NOT NULL,
    osm_type      char(1),
    osm_id        bigint,
    geom          geometry(Point, 4326) NOT NULL,
    tags          jsonb,
    source_id     smallint NOT NULL REFERENCES data_source (id)
);
CREATE INDEX accessibility_feature_geom_idx ON accessibility_feature USING gist (geom);

-- Searchable places (self-hosted geocoding; no queries leave the server)
CREATE TABLE place (
    id           bigserial PRIMARY KEY,
    region_code  text NOT NULL REFERENCES region (code),
    osm_type     char(1),
    osm_id       bigint,
    kind         text NOT NULL CHECK (kind IN ('STREET', 'POI', 'ADDRESS')),
    category     text,
    names        jsonb NOT NULL,
    search_text  text NOT NULL,
    rank         smallint NOT NULL DEFAULT 0,
    geom         geometry(Point, 4326) NOT NULL
);
CREATE INDEX place_search_trgm_idx ON place USING gin (search_text gin_trgm_ops);
CREATE INDEX place_geom_idx ON place USING gist (geom);

-- ---------------------------------------------------------------------------
-- Routing profiles (defaults; weights live in application configuration)
-- ---------------------------------------------------------------------------
CREATE TABLE route_profile (
    code         text PRIMARY KEY,
    sort_order   smallint NOT NULL,
    preferences  jsonb NOT NULL,
    enabled      boolean NOT NULL DEFAULT true
);

INSERT INTO route_profile (code, sort_order, preferences) VALUES
('STANDARD', 1, '{"wheeled": false, "visualGuidance": false, "avoidStairs": false, "maxInclinePct": null, "minWidthM": null, "maxKerbHeightCm": null, "avoidRoughSurfaces": false, "preferPedestrianAreas": false, "preferAccessibleCrossings": false, "minimizeTrafficExposure": false, "preferSimpleIntersections": false, "minimizeDistance": true, "preferRestingSpots": false, "preferLitPaths": false, "walkingSpeedMps": 1.3}'),
('WHEELCHAIR', 2, '{"wheeled": true, "visualGuidance": false, "avoidStairs": true, "maxInclinePct": 8, "minWidthM": 0.9, "maxKerbHeightCm": 3, "avoidRoughSurfaces": true, "preferPedestrianAreas": true, "preferAccessibleCrossings": true, "minimizeTrafficExposure": false, "preferSimpleIntersections": false, "minimizeDistance": false, "preferRestingSpots": false, "preferLitPaths": false, "walkingSpeedMps": 1.0}'),
('VISUALLY_IMPAIRED', 3, '{"wheeled": false, "visualGuidance": true, "avoidStairs": false, "maxInclinePct": null, "minWidthM": null, "maxKerbHeightCm": null, "avoidRoughSurfaces": false, "preferPedestrianAreas": true, "preferAccessibleCrossings": true, "minimizeTrafficExposure": true, "preferSimpleIntersections": true, "minimizeDistance": false, "preferRestingSpots": false, "preferLitPaths": false, "walkingSpeedMps": 1.0}'),
('REDUCED_MOBILITY', 4, '{"wheeled": false, "visualGuidance": false, "avoidStairs": true, "maxInclinePct": 10, "minWidthM": null, "maxKerbHeightCm": null, "avoidRoughSurfaces": true, "preferPedestrianAreas": true, "preferAccessibleCrossings": true, "minimizeTrafficExposure": false, "preferSimpleIntersections": false, "minimizeDistance": true, "preferRestingSpots": true, "preferLitPaths": false, "walkingSpeedMps": 0.8}'),
('CUSTOM', 5, '{"wheeled": false, "visualGuidance": false, "avoidStairs": false, "maxInclinePct": null, "minWidthM": null, "maxKerbHeightCm": null, "avoidRoughSurfaces": false, "preferPedestrianAreas": false, "preferAccessibleCrossings": false, "minimizeTrafficExposure": false, "preferSimpleIntersections": false, "minimizeDistance": false, "preferRestingSpots": false, "preferLitPaths": false, "walkingSpeedMps": 1.2}');

-- ---------------------------------------------------------------------------
-- Community obstacle reports and moderation
-- ---------------------------------------------------------------------------
CREATE TABLE obstacle_report (
    id                 uuid PRIMARY KEY,
    region_code        text NOT NULL REFERENCES region (code),
    lat                double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon                double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
    geom               geometry(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)) STORED,
    category           text NOT NULL,
    impact             text NOT NULL CHECK (impact IN ('IMPASSABLE', 'DIFFICULT', 'MINOR')),
    description        text CHECK (char_length(description) <= 1000),
    is_temporary       boolean NOT NULL DEFAULT false,
    expires_at         timestamptz,
    status             text NOT NULL CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED', 'RESOLVED', 'EXPIRED')),
    photo_path         text,
    photo_content_type text,
    language           text,
    confirmation_count integer NOT NULL DEFAULT 0,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    last_confirmed_at  timestamptz NOT NULL DEFAULT now(),
    version            bigint NOT NULL DEFAULT 0
);
CREATE INDEX obstacle_report_geom_idx ON obstacle_report USING gist (geom);
CREATE INDEX obstacle_report_status_idx ON obstacle_report (status);

CREATE TABLE report_status_history (
    id          bigserial PRIMARY KEY,
    report_id   uuid NOT NULL REFERENCES obstacle_report (id) ON DELETE CASCADE,
    from_status text,
    to_status   text NOT NULL,
    changed_by  text NOT NULL,
    note        text CHECK (char_length(note) <= 1000),
    changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_status_history_report_idx ON report_status_history (report_id);

-- ---------------------------------------------------------------------------
-- Administration
-- ---------------------------------------------------------------------------
CREATE TABLE admin_user (
    id            bigserial PRIMARY KEY,
    username      text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role          text NOT NULL CHECK (role IN ('ADMIN', 'MODERATOR')),
    enabled       boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Reserved for OPT-IN preference synchronisation. Routing never requires it and
-- the application stores preferences locally on the device by default.
CREATE TABLE user_preference_sync (
    id           uuid PRIMARY KEY,
    token_hash   text NOT NULL UNIQUE,
    preferences  jsonb NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now()
);
