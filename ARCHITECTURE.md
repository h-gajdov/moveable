# Architecture

```
            ┌──────────── Browser (React PWA) ────────────┐
            │ planner · navigation · reports · settings   │
            │ MapLibre (optional) ── tiles from MAP style │
            └───────────────┬─────────────────────────────┘
                            │ /api (same origin via nginx)
┌───────────────────────────▼──────────────────────────────┐
│ Spring Boot backend                                       │
│  routing/  EdgeCostBuilder → pgr_dijkstra → Analyzer      │
│  places/   self-hosted search (pg_trgm, translit)         │
│  obstacles/ reports, photos (re-encoded), moderation      │
│  coverage/ coverage grid, map-feature overlays            │
└───────────────────────────┬──────────────────────────────┘
                            │ JDBC / JPA
┌───────────────────────────▼──────────────────────────────┐
│ PostgreSQL 17 + PostGIS 3.5 + pgRouting 3.8               │
│ routing_node / routing_edge / edge_accessibility /        │
│ edge_attribute_provenance / place / obstacle_report …     │
└───────────────────────────▲──────────────────────────────┘
                            │ COPY (full refresh per region)
┌───────────────────────────┴──────────────────────────────┐
│ data-pipeline (Python): Geofabrik PBF → osmium extract →  │
│ pyosmium graph build → Copernicus DEM slopes → PostGIS    │
└──────────────────────────────────────────────────────────┘
```

## Pedestrian graph (data-pipeline)

* `tags.classify_way` decides whether a way is walkable. It respects `foot=*`,
  `access=*`, motorways/trunks, construction, indoor corridors and cycleways
  without foot access, and gives the way a **path class** (SIDEWALK, CROSSING,
  STEPS, ROAD_WITH_SIDEWALK, ROAD_SIDEWALK_UNKNOWN, ROAD_SIDEWALK_SEPARATE, …).
* Ways are split at shared nodes and at crossing, kerb and barrier nodes. Node
  ids are OSM node ids, and edges keep `osm_way_id` for traceability.
* Node features are attached to edges with explicit rules. A kerb belongs to
  the crossing that steps down from it, not to the sidewalk passing it. A
  barrier blocks every edge through its node. A crossing mapped only as a node
  on a road applies to the footways that meet the road there.
* Each attribute is stored in `edge_accessibility` (NULL = unknown) **and**
  in `edge_attribute_provenance` (source, method, OSM reference). So municipal
  data or user reports can be added later without overwriting OSM values.
* `completeness` (0–1) measures how many of the attributes relevant to an
  edge are known. It drives the uncertainty penalty and the coverage figures.
* Slopes: OSM `incline` when present (`incline_source='OSM'`). Otherwise an
  estimate from Copernicus GLO-30 (`'DEM'`): morphological opening removes
  buildings from the surface model, then the result is smoothed and its
  gradient taken along the edge. Estimates are **only** soft penalties and warnings.
* Post-processing computes node degree, connected components
  (`pgr_connectedComponents`), component sizes and bench proximity.

## Routing (backend `routing/`)

1. **Preferences.** The request's preferences are merged onto the profile
   defaults stored in `route_profile`. Weights live in `application.yml`
   (`app.routing.weights`).
2. **Obstacles.** Verified, unexpired reports near the search area are mapped to
   edges within 10 m. `ObstacleCategory.effectiveImpact` decides per user: impassable
   → edge excluded, difficult/minor → penalty, irrelevant to these needs → ignored.
3. **SQL generation.** `EdgeCostBuilder` builds the pgRouting edge query.
   Hard constraints become `(... ) IS NOT TRUE` exclusions, so NULL/unknown never
   excludes an edge. Soft preferences become cost terms:
   `cost = length·(1 + Σ multipliers) + Σ fixed penalties`. Only numbers from
   validated config or preferences are interpolated, never user text.
4. **Snapping.** Each point snaps to the nearest edge that is allowed under the
   hard constraints, lies in a component with at least `min-component-size`
   nodes, and is within 150 m. The snap distance is reported, and a warning is
   given above 40 m.
5. **Shortest path.** `pgr_dijkstra` (undirected, many-to-many) runs between both
   endpoints of the two snapped edges. The partial edge costs are added and the
   best combination is kept. The search runs inside a padded envelope, falling
   back to the whole region.
6. **Alternatives.** RECOMMENDED, SHORTEST_SUITABLE (length only, same hard
   constraints) and BEST_COVERAGE (stronger uncertainty penalty). An
   alternative that overlaps an earlier one by ≥ 85 % is merged into it, so no
   artificial alternatives are shown.
7. **Analysis.** `RouteAnalyzer` produces the summary, coverage, warnings and
   suitability indicators (OK / PROBLEM / UNKNOWN per need). The best level is
   "no known issues in the mapped data". A BASELINE route (only legal
   constraints) is computed for the "why this route" comparison.
8. **No route.** The baseline path is checked against each hard constraint in
   Java, and the response lists the blocking features (stairs, kerbs, …) with
   their locations. Disconnected networks and points too far from any path
   are reported separately.
9. **Instructions.** `InstructionBuilder` groups segments into legs by name, path
   class and bearing. Crossings and stairs get their own steps. The result is
   structured data (type, modifier, names, crossing facts, notes), localised by
   the client.

## Frontend

* `LocationInput` is an ARIA 1.2 combobox over `/api/places` (Cyrillic and
  Latin both match through transliteration), plus typed coordinates, device
  location and keyboard map picking. The map is never required.
* `RouteResults` / `RouteLine` present the route as text first: summary,
  needs indicators, warnings, explanation and coverage. The steps form an
  ordered list drawn as a transit-line diagram.
* `NavigatePage` supports manual steps (Next/Previous/Repeat) or GPS following.
  GPS fixes worse than 30 m never move steps or trigger turn announcements.
  Off-route detection needs 3 consecutive fixes beyond `max(30 m, 1.5 × accuracy)`.
  It offers rerouting, never forces it, and stopping is instant.
* Output channels: on-screen text, live regions for screen readers, optional
  Web Speech, and optional vibration patterns (step, crossing, warning, arrive).
* Settings: theme (system/light/dark/high contrast), text size up to 200 %,
  wide spacing, reduced motion, map on/off, simple instructions, speech and
  vibration. They live in `localStorage` only. Trip data stays in memory.

## Multi-city

`region` table and `data-pipeline/regions.yml`. To add a city, add a regions
entry (bbox, Geofabrik extract, DEM tiles) and a `region` row in a new Flyway
migration, then run the pipeline with `--region <code>`. One deployment serves
one region (`app.region`).

## Security & privacy

* No accounts for routing. Admin uses HTTP Basic (stateless, BCrypt hashes)
  and must be served over HTTPS in production. Failed logins are throttled.
* Rate limits on routes, reports and confirmations are kept in memory with
  salted IP hashes, which are never persisted.
* Photos are checked by magic bytes, guarded against decompression bombs, and
  re-encoded to JPEG. This strips EXIF/GPS. Photos are public only after verification.
* Errors are RFC 9457 problem responses with stable codes and no internals.
* nginx sets a CSP, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`
  and a Permissions-Policy.
