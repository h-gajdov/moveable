#!/usr/bin/env sh
# Run the backend on the host against the Docker database (reads ../.env).
set -e
cd "$(dirname "$0")/../backend"
set -a; . ../.env; set +a
export DB_HOST=localhost UPLOAD_DIR=${UPLOAD_DIR:-../data-pipeline/data/uploads}
exec ./mvnw -q spring-boot:run
