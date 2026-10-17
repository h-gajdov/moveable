# Deployment notes

* **HTTPS is mandatory**. Admin uses HTTP Basic, and browsers only allow
  geolocation on secure origins. Terminate TLS in front of the `frontend` nginx.
* Do **not** expose the backend (`:8080`) or the database publicly. The nginx
  proxy sets `X-Forwarded-For` from the real client address, which the backend
  uses for rate limiting.
* Set strong `DB_PASSWORD` and `ADMIN_PASSWORD` (≥ 12 chars) in `.env`. Add
  further moderators by inserting into `admin_user` with BCrypt hashes.
* **Map tiles:** OpenFreeMap is free and needs no key. For full control and privacy, self-host
  (e.g. a Protomaps PMTiles extract of North Macedonia served by the frontend
  nginx), then set `VITE_MAP_STYLE_URL` (build arg) and `MAP_ORIGINS` (CSP).
* **Data refresh:** schedule `docker compose run --rm pipeline all --force`
  (e.g. weekly). The import replaces the region's graph in one transaction, and
  routing keeps working on the old graph until it commits.
* **Backups:** the `db-data` volume (reports, moderation history) and the
  `uploads` volume (photos). The graph itself can be rebuilt from OSM.
* **Privacy / GDPR:** no accounts and no location history. Route requests
  contain coordinates and are not logged or stored. Reports store location,
  category, free text and an optional EXIF-stripped photo. Publish a privacy
  notice naming the controller, set a retention period for resolved and
  rejected reports, and handle erasure requests by report id.
* Disable Swagger UI publicly if not wanted: `SPRINGDOC_SWAGGER_UI_ENABLED=false`.
