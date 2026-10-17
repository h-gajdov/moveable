# Accessible Skopje

An open-source pedestrian navigation platform that finds walking routes in Skopje
**to fit a person's accessibility needs**, rather than just the shortest path.
It also says honestly what the map data does and does not know.

- Routes are computed with **pgRouting** on a pedestrian graph built from
  **OpenStreetMap**, with accessibility attributes (stairs, kerbs, surface,
  width, slope, crossings, lighting, benches).
- **Requirements** (e.g. "no stairs", "kerbs ≤ 3 cm", "slope ≤ 8 %") remove
  edges from the graph. **Preferences** add penalties. If nothing satisfies the
  requirements, the app explains what blocks the way and never quietly loosens them.
- **Missing data is never treated as accessible.** Every route reports what is
  unknown, how well it is mapped, and why it was chosen.
- Fully usable **without the map**, by keyboard and with screen readers, in
  **Macedonian, Albanian and English**. Targets WCAG 2.2 AA.
- Community **obstacle reports** with moderation; only moderator-verified
  reports change routes.

> ⚠️ Routes are based on community map data and can be wrong. They are never a
> guarantee that a way is accessible or safe. See [ACCESSIBILITY.md](ACCESSIBILITY.md)
> and the in-app Help page.

## Repository layout

| Path | What it is |
|---|---|
| `backend/` | Java 21 / Spring Boot 4 REST API: routing, places, obstacles, moderation. Flyway migrations live in `backend/src/main/resources/db/migration`. |
| `data-pipeline/` | Python OSM import: Geofabrik download → osmium extract → pyosmium graph build → (Copernicus DEM slopes) → PostGIS. |
| `frontend/` | React 19 + TypeScript + Vite, MapLibre GL, Tailwind 4, i18next, TanStack Query, PWA. |
| `docs/` | API, testing (incl. manual assistive-technology procedures), deployment. |
| `scripts/` | Developer helpers. |
| `docker-compose.yml` | PostGIS + pgRouting, backend, frontend (nginx), pipeline (tools profile). |

See [ARCHITECTURE.md](ARCHITECTURE.md), [DATA_SOURCES.md](DATA_SOURCES.md),
[ACCESSIBILITY.md](ACCESSIBILITY.md), [docs/API.md](docs/API.md),
[docs/TESTING.md](docs/TESTING.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Quick start (clean machine)

Requirements: Docker with Compose v2, about 4 GB RAM free, and about 1 GB disk for data.

```sh
cp .env.example .env            # then change DB_PASSWORD and ADMIN_PASSWORD (12+ chars)

# 1. Database, backend (runs Flyway migrations on start) and frontend
docker compose up -d --build

# 2. Import Skopje: download the Geofabrik extract, cut the Skopje bbox,
#    build the pedestrian graph, estimate slopes, load PostGIS (~2–3 min)
docker compose run --rm pipeline all --region skopje

# 3. Open the app
open http://localhost:8081       # API docs: http://localhost:8080/api/docs
```

`docker compose run --rm pipeline import` re-imports from the existing extract.
Add `--force` to `all` to download a fresh extract, and `--no-dem` to skip
estimated slopes. Re-importing replaces the graph. Obstacle reports are stored
by coordinates, so they survive re-imports.

The database is exposed on host port **5433** (`DB_PORT`) to avoid clashing
with a local PostgreSQL.

## Development

```sh
docker compose up -d db                     # database only
./scripts/dev-backend.sh                    # backend on :8080 against the Docker DB (reads .env)
cd frontend && npm install && npm run dev   # Vite on :5173, proxies /api to :8080
```

Data import during development: `docker compose run --rm pipeline all`.

The moderation UI is at `/admin`. Sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`
from `.env`. That account is created on first start if no administrator exists.

## Tests

| Suite | Command | Needs |
|---|---|---|
| Pipeline (tag parsing, graph building) | `docker compose run --rm --entrypoint python pipeline -m pytest -q tests` | Docker |
| Backend (unit + routing/API integration on real PostGIS/pgRouting via Testcontainers) | `cd backend && ./mvnw test` | Docker, JDK 21 |
| Frontend unit (Vitest + Testing Library) | `cd frontend && npm test` | Node 20+ |
| End-to-end + axe-core accessibility (Playwright) | `cd frontend && npx playwright install chromium && E2E_BASE_URL=http://localhost:8081 npm run test:e2e` | running stack with imported data |

Run a single backend test: `./mvnw test -Dtest=RoutingIntegrationTest#wheelchairRouteAvoidsMappedStairsAndNarrowPath`.
Run a single frontend test: `npx vitest run src/lib/lib.test.ts -t "simple mode"`.
Run a single e2e test: `npx playwright test -g "keyboard-only"`.

Automated checks do not replace testing with disabled people. See
[docs/TESTING.md](docs/TESTING.md) for the manual NVDA / VoiceOver / TalkBack / keyboard procedures.

## Licences

Code: AGPL-3.0-or-later (see `LICENSE`). Map data: © OpenStreetMap contributors,
ODbL 1.0. Attribution is shown on the map and on the Help screen. The derived
database is ODbL. Estimated slopes come from Copernicus DEM GLO-30. Full details
are in [DATA_SOURCES.md](DATA_SOURCES.md).
