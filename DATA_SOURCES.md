# Data sources

Status as investigated on **2026-10-17**.

| Source | URL | Licence | Coverage | Update frequency | Integration status |
|---|---|---|---|---|---|
| OpenStreetMap via Geofabrik | https://download.geofabrik.de/europe/macedonia.html | ODbL 1.0 | All of North Macedonia; we use bbox 21.28–21.62 E, 41.92–42.08 N | Geofabrik builds daily; re-import with `pipeline all --force` | **Integrated** (graph, accessibility tags, benches, toilets, places) |
| Copernicus DEM GLO-30 (AWS Open Data) | https://registry.opendata.aws/copernicus-dem/ | Copernicus DEM licence: free use with attribution | Global, 30 m | Static (2011–2015 acquisition) | **Integrated**, used only for *estimated* slopes |
| City of Skopje GIS portal | https://gisportal.skopje.gov.mk/arcgis/rest/services | No open-data licence published | City | Unknown | **Not integrated / unavailable** |
| Wheelmap | https://wheelmap.org/ | Wheelchair data is OSM's `wheelchair=*` (ODbL); the site and API have their own terms | Global POIs | Continuous | **Covered indirectly** through OSM |
| Project Sidewalk | https://projectsidewalk.org/ | CC BY 4.0 (where deployed) | Selected cities only | Per deployment | **Unavailable**: no Skopje deployment |
| KartaView | https://kartaview.org/ | Imagery CC BY-SA 4.0 | Street imagery | Continuous | **Not integrated**: imagery, not structured attributes. Possible future aid for mappers |
| Community reports (this app) | — | Contributions under ODbL | Skopje | Continuous | **Integrated**: only verified reports affect routing |

## OpenStreetMap (primary)

Profile of the Skopje extract (Oct 2026): ~22 000 walkable ways, which become
**42 961 edges** covering **3 446 km** of walkable network. 99.3 % of nodes are
in one connected component. The extract has 323 stair edges, 2 119 crossing
edges, 368 benches and 14 544 searchable places.

Tags used: `highway`, `footway`, `sidewalk` (+ `:left/:right/:both`, `:surface`,
`:width`, `:smoothness`), `surface`, `smoothness`, `incline`, `width`, `est_width`,
`kerb`, `kerb:height`, `barrier`, `wheelchair`, `tactile_paving`, `crossing`,
`crossing:markings`, `crossing:signals`, `crossing:island`,
`traffic_signals:sound`, `traffic_signals:vibration`, `button_operated`, `lit`,
`step_count`, `handrail*`, `ramp:wheelchair`, `foot`, `access`, `amenity=bench`,
`amenity=toilets`, `name`, `name:mk`, `name:sq`, `name:en`.

**Known limitations**
* Accessibility tags are sparse: width on <1 % of ways, `wheelchair` on 9
  ways, and tactile paving almost unmapped. The average edge completeness is about 0.23.
* Most residential streets do not say whether they have sidewalks. These are
  routed as "sidewalk unknown" and flagged.
* Crossings are mostly mapped as nodes on roads. Where a route walks along a
  road centreline, implicit crossings at junctions are not modelled.
* Pedestrian areas are routed along their outlines, so routes across squares
  are slightly longer than reality.
* Street names: OSM `name` in Skopje is usually Macedonian Cyrillic. Albanian
  and English names fall back to official Macedonian romanisation.

## Copernicus DEM GLO-30

A digital *surface* model, so buildings and trees are included. The pipeline
applies a 5×5 morphological opening and Gaussian smoothing before taking
gradients. Results look plausible (city centre ≈ 1 %, Vodno slopes ≈ 20 %), but
they are **estimates**. They are labelled "estimated", only add penalties and
warnings, and never exclude an edge.

Attribution: © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018,
provided under COPERNICUS by the European Union and ESA; all rights reserved.

## City of Skopje GIS (investigated, not used)

The ArcGIS REST directory is publicly listed. `INFRA/Infra_FS/FeatureServer` and
`INFRA/Soobrakjaj/MapServer` expose schemas for highly relevant layers:
sidewalks (83 `Тротоар`: width, condition, surface), kerbs (82 `Рабник`: height,
type), road damage (79–81), traffic signals (71) and street axes (86).
However, every `returnCountOnly` query, on both the MapServer and the FeatureServer,
returned **0 records** to anonymous users. No licence or terms of use were
found. Following the brief, nothing was ingested. Should the City publish this
data under an open licence, it fits directly into `edge_attribute_provenance`
with `method='MUNICIPAL'` (data source `skopje_gis` already exists).

## Map tiles

The default style is **OpenFreeMap** (`https://tiles.openfreemap.org/styles/liberty`):
free, no API key, OSM-based, attribution shown. For production, self-host tiles
(e.g. a Protomaps/OpenMapTiles extract) and set `VITE_MAP_STYLE_URL` and
`MAP_ORIGINS`. The public OSM tile server is **not** used.

## Licences of software

Backend: Spring Boot, Hibernate, Flyway, springdoc (Apache-2.0); PostgreSQL
(PostgreSQL licence); PostGIS (GPL-2.0); pgRouting (GPL-2.0). Pipeline: osmium-tool
and pyosmium (BSD-2), psycopg (LGPL-3), NumPy/SciPy (BSD), rasterio (BSD-3),
Shapely (BSD-3), pyproj (MIT). Frontend: React, Vite, TanStack Query, i18next,
lucide (MIT/ISC); MapLibre GL JS (BSD-3); Tailwind CSS (MIT); Inter (OFL-1.1);
Playwright (Apache-2.0); axe-core (MPL-2.0).
