# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MoveAble: accessibility-aware pedestrian routing for Skopje. Three
deployable parts plus a data import:

- `backend/`: Java 21, Spring Boot **4.0** (Jackson 3 = `tools.jackson.*`, modular starters, Testcontainers 2), Flyway migrations in `src/main/resources/db/migration` (the backend owns the schema).
- `data-pipeline/`: Python 3.12 in Docker (pyosmium, osmium-tool, rasterio). Writes the graph straight into PostGIS tables created by the backend migrations.
- `frontend/`: React 19, Vite 6, Tailwind 4 (tokens in `src/styles/index.css`), i18next (mk/sq/en JSON in `src/i18n/locales`), MapLibre, TanStack Query.

## Commands

```sh
docker compose up -d --build                       # db (host port 5433), backend :8080, frontend nginx :8081
docker compose run --rm pipeline all --region skopje   # download + extract + import (needs backend migrations applied first)
docker compose run --rm pipeline import            # re-import from existing extract
./scripts/dev-backend.sh                           # backend on host against Docker DB (reads .env)
cd frontend && npm run dev                         # :5173, proxies /api to :8080

cd backend && ./mvnw test                          # needs Docker (Testcontainers pgrouting image)
./mvnw test -Dtest=RoutingIntegrationTest#wheelchairRouteAvoidsMappedStairsAndNarrowPath
docker compose run --rm --entrypoint python pipeline -m pytest -q tests
cd frontend && npm test && npm run lint            # vitest; lint = tsc
npx vitest run src/lib/lib.test.ts -t "simple mode"
E2E_BASE_URL=http://localhost:8081 npx playwright test   # needs running stack WITH imported data
```

Maven Central sometimes times out from this machine. Retry `./mvnw` before assuming a build error.

## Architecture essentials (see ARCHITECTURE.md)

- Routing = `EdgeCostBuilder` (SQL for pgRouting) → `RoutingService` (snap, many-to-many `pgr_dijkstra` with partial edges, alternatives, baseline comparison, no-route diagnosis) → `RouteAnalyzer` / `InstructionBuilder` (structured, localised client-side).
- **Hard constraints must be NULL-safe**: always `excludeIf(cond)` → `(cond) IS NOT TRUE`. A bare `NOT (...)` drops edges with unknown attributes (this bug happened once; `hardConstraintsAreNullSafe` guards it).
- When changing a hard constraint, update the matching Java predicate in `RoutingService.diagnose` too.
- DEM (`incline_source='DEM'`) slopes are estimates: soft penalty and warning only, never a hard constraint.
- Edge attributes: NULL = unknown. The pipeline records provenance in `edge_attribute_provenance`.
- Transliteration exists twice (`data-pipeline/pipeline/translit.py`, `backend/.../common/Transliteration.java`); keep them identical.
- Route geometry covers the mapped network only. Never draw straight connector lines as paths.
- Only VERIFIED, unexpired obstacle reports affect routing. PENDING ones are shown and warned about only.

## Conventions

- Every UI string goes in all three locale files (`lib.test.ts` fails if a key is missing). Macedonian is Cyrillic.
- Accessibility is a requirement: keep landmarks/heading order, labelled controls, ≥44 px targets, live-region announcements (`useAnnounce`), and status shown by shape and text, not colour. The Playwright axe suite must stay green.
- Interface settings live in localStorage only, and trip data in memory. Never persist location history.
- API errors: throw `ApiException` with a stable code and add `errors.<CODE>` to the locales.
