# Project overview

MoveAble is a walking-route planner for Skopje. Instead of finding the
shortest path, it finds routes that suit a person's accessibility needs (a
wheelchair user, someone with a visual impairment, someone with reduced
mobility), and it is honest about what the map data doesn't know.

This page is a guided tour. For details see [ARCHITECTURE.md](../ARCHITECTURE.md),
[DATA_SOURCES.md](../DATA_SOURCES.md) and [API.md](API.md).

## The big picture

```
OpenStreetMap + Copernicus DEM
        │  (Python data pipeline, run once per import)
        ▼
PostgreSQL + PostGIS + pgRouting   ◄── community obstacle reports
        │  (SQL / JDBC)
        ▼
Spring Boot backend (REST API under /api)
        │  (served through nginx on the same origin)
        ▼
React web app (PWA): plan → review route → navigate
```

## 1. Where the data comes from

| Source | What it gives | How it's fetched |
|---|---|---|
| **OpenStreetMap** via Geofabrik | Walkable paths, stairs, kerbs, surfaces, widths, crossings, traffic signals, lighting, benches, toilets, disabled parking, place names for search | Downloads `macedonia-latest.osm.pbf` (`data-pipeline/regions.yml`), then `osmium` cuts out the Skopje area (21.28–21.62 E, 41.92–42.08 N) |
| **Copernicus DEM GLO-30** (AWS Open Data) | Elevation at 30 m resolution, used to estimate slopes where OSM has no `incline` tag | Two GeoTIFF tiles from `copernicus-dem-30m.s3.amazonaws.com` (`data-pipeline/pipeline/dem.py`) |
| **Community reports** (from the app itself) | Obstacles such as blocked sidewalks or construction, with an optional photo | `POST /api/obstacles/reports`. A moderator must verify a report before it affects routing |

Investigated and **not** used (see [DATA_SOURCES.md](../DATA_SOURCES.md)):

- **City of Skopje ArcGIS portal:** it has the right layers (sidewalks, kerbs),
  but anonymous queries return 0 records and there's no licence. The schema
  has a slot ready for it (`method='MUNICIPAL'`).
- **Wheelmap:** its wheelchair data already comes in through OSM.
- **Project Sidewalk:** it has no Skopje deployment.
- **KartaView:** it provides street imagery, not structured data.

## 2. The data pipeline (`data-pipeline/`, Python)

`docker compose run --rm pipeline all --region skopje` runs four steps:

1. **Download and extract** the OSM file, then cut it to the city area.
2. **Build the walking graph** (`graph.py`, `tags.py`):
   - `classify_way` decides which ways are walkable and gives each a class
     (SIDEWALK, CROSSING, STEPS, ROAD_WITH_SIDEWALK, ROAD_SIDEWALK_UNKNOWN, …).
   - Ways are split at junctions, crossings, kerbs and barriers.
   - Point features are attached to edges by explicit rules. For example, a
     kerb belongs to the crossing that steps down from it.
3. **Estimate slopes from the DEM.** The DEM shows the surface including
   buildings, so the pipeline first strips buildings out (a morphological
   opening filter), smooths the result, and then takes the gradient along each
   edge. These slopes are marked `incline_source='DEM'` and are only ever soft
   penalties and warnings.
4. **Load into PostGIS:**
   - Data goes into `routing_node`, `routing_edge` and `edge_accessibility`.
     `NULL` means "unknown".
   - `edge_attribute_provenance` records where each value came from.
   - Each edge gets a `completeness` score from 0 to 1.
   - Post-processing finds connected components (`pgr_connectedComponents`)
     and bench proximity.

Result for Skopje: about 43,000 edges covering about 3,450 km of walkable
network. Average completeness is only about 0.23, because accessibility tags
are sparse in OSM.

## 3. The backend (`backend/`, Java 21 + Spring Boot 4)

There's no machine learning in routing. It's classic graph search with
**pgRouting's Dijkstra** (`pgr_dijkstra`) inside PostgreSQL. A route request
goes through these steps:

1. **Profile and preferences.** There are five profiles in `route_profile`:
   STANDARD, WHEELCHAIR, VISUALLY_IMPAIRED, REDUCED_MOBILITY and CUSTOM. For
   example, WHEELCHAIR means no stairs, slope ≤ 8 %, width ≥ 0.9 m and
   kerbs ≤ 3 cm. The user's own settings are merged on top.
2. **Obstacles.** Verified, unexpired reports within 10 m of an edge either
   remove that edge or add a penalty to it, depending on the user's needs.
3. **SQL cost function** (`EdgeCostBuilder`):
   - **Hard requirements** remove edges. They're written as
     `(cond) IS NOT TRUE`, so an edge with *unknown* data is never silently dropped.
   - **Soft preferences** become costs:
     `length·(1 + Σ multipliers) + Σ penalties`.
4. **Snapping.** The start and destination each snap to the nearest allowed
   edge within 150 m. Above 40 m, the user gets a warning.
5. **Routes.** Up to three: RECOMMENDED, SHORTEST_SUITABLE and BEST_COVERAGE
   (which prefers well-mapped paths). Any route that overlaps an earlier one by
   85 % or more is merged into it.
6. **Analysis** (`RouteAnalyzer`): a summary, data coverage, warnings, and an
   OK / PROBLEM / UNKNOWN status for each need. It also compares against a
   baseline shortest route to explain *why* this route was chosen.
7. **No route found.** `RoutingService.diagnose` lists exactly what blocks the
   way (stairs, kerbs, …) and where. It never quietly loosens the user's
   requirements.
8. **Instructions** (`InstructionBuilder`): structured steps (type, direction,
   street names, crossing details). The frontend turns them into text in the
   user's language.

Other parts of the backend:

- **Place search:** self-hosted, using `pg_trgm` and Cyrillic↔Latin transliteration.
- **Coverage:** a data-completeness grid.
- **Map overlays:** stairs, crossings, kerbs, barriers and benches.
- **Disabled-parking lookup.**
- **Admin moderation:** HTTP Basic login, BCrypt-hashed passwords, throttled
  failed logins.

### API endpoints

Full list in [API.md](API.md); live docs at `/api/docs`.

- `POST /api/routes`: plan routes
- `GET /api/routing-profiles`
- `GET /api/places?q=`, `/api/places/reverse`, `/api/places/parking`
- `GET /api/obstacles?bbox=`, `POST /api/obstacles/reports`,
  `POST /api/obstacles/{id}/confirm`, `GET /api/obstacles/{id}/photo`
- `GET /api/coverage`, `GET /api/map-features`, `GET /api/config`, `GET /api/health`
- `/api/admin/*`: moderation queue, status changes, import history

## 4. The frontend (`frontend/`, React 19 + Vite)

- **Pages:** Plan (a step-by-step form), route results (text first, with steps
  drawn like a transit-line diagram), Navigate, Report, Settings, Help and Admin.
- **Map:** MapLibre GL using **OpenFreeMap** tiles (`tiles.openfreemap.org`,
  free and keyless, configurable via `VITE_MAP_STYLE_URL`). The map is
  optional; the whole app works without it.
- **Navigation:** manual Next/Previous steps, or GPS following:
  - GPS fixes worse than 30 m are ignored.
  - Off-route needs 3 consecutive bad fixes before the app reacts.
  - Rerouting is offered, never forced.
- **Output:** screen text, screen-reader live regions, optional speech and
  optional vibration.
- **Languages:** Macedonian, Albanian and English via i18next.
- **Privacy:** settings live only in `localStorage`, and trip data stays in memory.

## 5. External APIs and models

| Used at runtime | Purpose |
|---|---|
| OpenFreeMap tile server | Map background (optional) |
| Browser **Web Speech API** (`speechSynthesis`) | Spoken navigation instructions, using the device's own voices |
| Browser **Geolocation API** | "Use my location" and GPS following |
| Browser **Vibration API** | Vibration patterns for each step, crossing, warning and arrival |

| Used offline, not at runtime | Purpose |
|---|---|
| Geofabrik and Copernicus S3 downloads | Data import |
| **OmniVoice TTS model** (`k2-fsa/OmniVoice`, PyTorch) via `scripts/generate-voice-cues.py` | Generates the pre-recorded planner prompts ("choose start", etc.) in all three languages in one designed, cloned voice. The output is static MP3s in `frontend/public/audio/cues/`, so the deployed app never runs this model |

The only AI model in the project is that offline text-to-speech generator.
There are no LLMs and no paid or keyed third-party APIs at runtime, and no
geocoding service either, because place search runs on the project's own OSM data.
