"""Command line entry point.

    python -m pipeline download --region skopje      # fetch Geofabrik country extract
    python -m pipeline extract  --region skopje      # cut the region bbox with osmium
    python -m pipeline import   --region skopje      # build graph, (DEM), write to PostGIS
    python -m pipeline all      --region skopje      # all of the above
"""

from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
import time
import traceback
import urllib.request

import yaml

from . import db, dem
from .graph import read_osm

log = logging.getLogger("pipeline")
DATA_DIR = os.environ.get("DATA_DIR", "/data")


def load_region(code: str) -> dict:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(here, "regions.yml"), encoding="utf-8") as f:
        regions = yaml.safe_load(f)["regions"]
    if code not in regions:
        sys.exit(f"Unknown region '{code}'. Known: {', '.join(regions)}")
    return regions[code]


def cmd_download(code: str, cfg: dict, force: bool = False) -> str:
    raw = os.path.join(DATA_DIR, "raw")
    os.makedirs(raw, exist_ok=True)
    path = os.path.join(raw, cfg["country_extract_file"])
    if os.path.exists(path) and not force and time.time() - os.path.getmtime(path) < 7 * 86400:
        log.info("using cached extract %s (younger than 7 days; --force to refresh)", path)
        return path
    log.info("downloading %s", cfg["country_extract_url"])
    tmp = path + ".part"
    urllib.request.urlretrieve(cfg["country_extract_url"], tmp)
    os.replace(tmp, path)
    return path


def cmd_extract(code: str, cfg: dict) -> str:
    src = os.path.join(DATA_DIR, "raw", cfg["country_extract_file"])
    if not os.path.exists(src):
        sys.exit(f"{src} not found; run 'download' first")
    out = os.path.join(DATA_DIR, f"{code}.osm.pbf")
    bbox = ",".join(str(v) for v in cfg["bbox"])
    log.info("extracting bbox %s -> %s", bbox, out)
    subprocess.run(["osmium", "extract", "-b", bbox, "-s", "complete_ways", "--overwrite",
                    src, "-o", out], check=True)
    return out


def osm_timestamp(path: str) -> str | None:
    try:
        res = subprocess.run(["osmium", "fileinfo", "-g", "header.option.osmosis_replication_timestamp", path],
                             capture_output=True, text=True, check=True)
        return res.stdout.strip() or None
    except Exception:  # noqa: BLE001 - informational only
        return None


def cmd_import(code: str, cfg: dict, use_dem: bool) -> None:
    pbf = os.path.join(DATA_DIR, f"{code}.osm.pbf")
    if not os.path.exists(pbf):
        sys.exit(f"{pbf} not found; run 'extract' first")
    version = osm_timestamp(os.path.join(DATA_DIR, "raw", cfg["country_extract_file"]))
    conn = db.connect()
    run_id = db.start_run(conn, code, "osm", version)
    try:
        graph = read_osm(pbf, tuple(cfg["bbox"]))
        dem_used = False
        if use_dem and cfg.get("dem_tiles"):
            try:
                paths = dem.download_tiles(cfg["dem_tiles"], os.path.join(DATA_DIR, "dem"))
                model = dem.TerrainModel(paths, tuple(cfg["bbox"]))
                n = dem.apply_estimated_slopes(graph.edges, model)
                graph.stats["dem_estimated_edges"] = n
                dem_used = True
            except Exception as ex:  # DEM is optional; the graph is still useful without it
                log.warning("DEM step failed, continuing without estimated slopes: %s", ex)
                graph.stats["dem_error"] = str(ex)[:300]
        stats = db.write_graph(conn, code, graph, version, dem_used)
        stats.update({k: v for k, v in graph.stats.items() if k not in stats})
        db.finish_run(conn, run_id, True, stats)
        log.info("import finished: %s", stats)
    except Exception as ex:
        log.error("import failed: %s", ex)
        db.finish_run(conn, run_id, False, {}, traceback.format_exc())
        raise
    finally:
        conn.close()


def main(argv=None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(prog="pipeline", description="Accessible Skopje data pipeline")
    ap.add_argument("command", choices=["download", "extract", "import", "all"])
    ap.add_argument("--region", default="skopje")
    ap.add_argument("--no-dem", action="store_true", help="skip estimated slopes from Copernicus DEM")
    ap.add_argument("--force", action="store_true", help="re-download even if a recent extract exists")
    args = ap.parse_args(argv)
    cfg = load_region(args.region)
    if args.command in ("download", "all"):
        cmd_download(args.region, cfg, args.force)
    if args.command in ("extract", "all"):
        cmd_extract(args.region, cfg)
    if args.command in ("import", "all"):
        cmd_import(args.region, cfg, not args.no_dem)


if __name__ == "__main__":
    main()
