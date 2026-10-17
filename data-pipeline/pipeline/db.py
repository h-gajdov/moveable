"""Write the pedestrian graph into PostGIS and run post-processing SQL."""

from __future__ import annotations

import json
import logging
import os
from decimal import Decimal
from typing import Optional

import psycopg

from .graph import Graph

log = logging.getLogger(__name__)


def connect() -> psycopg.Connection:
    dsn = os.environ.get("DATABASE_URL") or (
        f"host={os.environ.get('DB_HOST', 'localhost')} "
        f"port={os.environ.get('DB_PORT', '5432')} "
        f"dbname={os.environ.get('DB_NAME', 'accessible_skopje')} "
        f"user={os.environ.get('DB_USER', 'accessible')} "
        f"password={os.environ.get('DB_PASSWORD', '')}"
    )
    return psycopg.connect(dsn)


def _b(v: Optional[bool]):
    return None if v is None else bool(v)


def start_run(conn, region: str, source: str, version: Optional[str]) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO ingestion_run (region_code, source_code, status, source_version) "
            "VALUES (%s, %s, 'RUNNING', %s) RETURNING id", (region, source, version))
        run_id = cur.fetchone()[0]
    conn.commit()
    return run_id


def finish_run(conn, run_id: int, ok: bool, stats: dict, message: str = "") -> None:
    conn.rollback()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE ingestion_run SET finished_at = now(), status = %s, stats = %s, message = %s "
            "WHERE id = %s", ("SUCCEEDED" if ok else "FAILED", json.dumps(stats), message[:2000], run_id))
    conn.commit()


def write_graph(conn: psycopg.Connection, region: str, g: Graph, source_version: Optional[str],
                dem_used: bool) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT code, id FROM data_source")
        src = dict(cur.fetchall())
        osm_id, dem_id, derived_id = src["osm"], src["copernicus_dem"], src["derived"]

        log.info("removing previous graph for region %s", region)
        cur.execute("DELETE FROM routing_edge WHERE region_code = %s", (region,))
        cur.execute("DELETE FROM routing_node WHERE region_code = %s", (region,))
        cur.execute("DELETE FROM accessibility_feature WHERE region_code = %s", (region,))
        cur.execute("DELETE FROM place WHERE region_code = %s", (region,))
        cur.execute("SELECT COALESCE(max(id), 0) FROM routing_edge")
        base_id = cur.fetchone()[0]

        log.info("writing %d nodes", len(g.nodes))
        with cur.copy("COPY routing_node (id, region_code, geom, tags) FROM STDIN") as cp:
            for nid, (lon, lat) in g.nodes.items():
                tags = g.node_tags.get(nid)
                cp.write_row((nid, region, f"SRID=4326;POINT({lon} {lat})",
                              json.dumps(tags, ensure_ascii=False) if tags else None))

        log.info("writing %d edges", len(g.edges))
        with cur.copy("COPY routing_edge (id, region_code, source, target, osm_way_id, way_segment, geom, "
                      "length_m, highway, path_class, road_class, sidewalk, names, source_id) FROM STDIN") as cp:
            for i, e in enumerate(g.edges, start=1):
                wkt = "LINESTRING(" + ",".join(f"{x} {y}" for x, y in e.coords) + ")"
                cp.write_row((base_id + i, region, e.source, e.target, e.osm_way_id, e.segment,
                              f"SRID=4326;{wkt}", e.length_m, e.wc.highway, e.wc.path_class,
                              e.wc.road_class, e.wc.sidewalk,
                              json.dumps(e.names, ensure_ascii=False) if e.names else None, osm_id))

        with cur.copy("COPY edge_accessibility (edge_id, surface, smoothness, surface_class, width_m, "
                      "width_estimated, incline_pct, incline_source, incline_hint, is_stairs, step_count, "
                      "handrail, ramp_wheelchair, kerb_type, kerb_height_cm, wheelchair, lit, tactile_paving, "
                      "barrier, barrier_effect, is_crossing, crossing_via_node, crossing_ref, crossing_type, "
                      "crossing_markings, crossing_signals, crossing_sound, crossing_vibration, crossing_island, "
                      "crossing_forbidden, traffic_exposure, carriageway_surface, completeness) FROM STDIN") as cp:
            for i, e in enumerate(g.edges, start=1):
                a = e.attrs
                ci = a.get("crossing")
                cp.write_row((
                    base_id + i, a.get("surface"), a.get("smoothness"), a["surface_class"], a.get("width_m"),
                    _b(a.get("width_estimated")), a.get("incline_pct"), a.get("incline_source"),
                    a.get("incline_hint"), bool(a.get("is_stairs")), a.get("step_count"),
                    _b(a.get("handrail")), _b(a.get("ramp_wheelchair")), a.get("kerb_type"),
                    a.get("kerb_height_cm"), a.get("wheelchair"), _b(a.get("lit")), _b(a.get("tactile_paving")),
                    a.get("barrier"), a.get("barrier_effect"), e.wc.path_class == "CROSSING",
                    bool(a.get("crossing_via_node")), a.get("crossing_ref"),
                    ci.crossing_type if ci else None, _b(ci.markings) if ci else None,
                    _b(ci.signals) if ci else None, _b(ci.sound) if ci else None,
                    _b(ci.vibration) if ci else None, _b(ci.island) if ci else None,
                    bool(a.get("crossing_forbidden")), a["traffic_exposure"], a.get("carriageway_surface"),
                    a["completeness"]))

        with cur.copy("COPY edge_attribute_provenance (edge_id, attribute, value, source_id, method, source_ref) "
                      "FROM STDIN") as cp:
            for i, e in enumerate(g.edges, start=1):
                seen = set()
                for attr, value, method, ref in e.provenance:
                    sid = dem_id if method == "DERIVED_DEM" else (derived_id if method == "INFERRED" else osm_id)
                    if (attr, sid) in seen:
                        continue
                    seen.add((attr, sid))
                    cp.write_row((base_id + i, attr, value, sid, method,
                                  ref if ref.startswith("node/") or ref == "copernicus-glo30"
                                  else f"way/{e.osm_way_id}:{ref}"))

        with cur.copy("COPY accessibility_feature (region_code, feature_type, osm_type, osm_id, geom, tags, "
                      "source_id) FROM STDIN") as cp:
            for f in g.benches:
                cp.write_row((region, "BENCH", "N", f.osm_id, f"SRID=4326;POINT({f.lon} {f.lat})",
                              json.dumps(f.tags, ensure_ascii=False), osm_id))
            for f in g.features:
                t = f.tags
                ftype = ("TOILETS" if t.get("amenity") == "toilets" else
                         "ELEVATOR" if t.get("highway") == "elevator" else "WHEELCHAIR_INFO")
                cp.write_row((region, ftype, "N", f.osm_id, f"SRID=4326;POINT({f.lon} {f.lat})",
                              json.dumps(t, ensure_ascii=False), osm_id))

        with cur.copy("COPY place (region_code, osm_type, osm_id, kind, category, names, search_text, rank, geom) "
                      "FROM STDIN") as cp:
            for p in g.places:
                cp.write_row((region, p.osm_type, p.osm_id or None, p.kind, p.category,
                              json.dumps(p.names, ensure_ascii=False), p.search_text, p.rank,
                              f"SRID=4326;POINT({p.lon} {p.lat})"))

        log.info("post-processing (degrees, connectivity, benches)")
        for stmt in (s.strip() for s in POST_PROCESS_SQL.split(";")):
            if stmt and not all(line.startswith("--") for line in stmt.splitlines()):
                cur.execute(stmt, {"region": region} if "%(region)s" in stmt else None)
        cur.execute("SELECT setval('routing_edge_id_seq', GREATEST((SELECT max(id) FROM routing_edge), 1))")
        cur.execute(STATS_SQL, {"region": region})
        row = cur.fetchone()
        stats = dict(zip([d.name for d in cur.description], row))
        cur.execute("UPDATE data_source SET retrieved_at = now(), version = %s WHERE code = 'osm'",
                    (source_version,))
        if dem_used:
            cur.execute("UPDATE data_source SET retrieved_at = now() WHERE code = 'copernicus_dem'")
    conn.commit()
    return {k: float(v) if isinstance(v, Decimal) else v for k, v in stats.items()}


POST_PROCESS_SQL = """
-- Node degree
UPDATE routing_node n SET degree = d.deg
FROM (
    SELECT node, count(*) AS deg FROM (
        SELECT source AS node FROM routing_edge WHERE region_code = %(region)s
        UNION ALL
        SELECT target FROM routing_edge WHERE region_code = %(region)s) x
    GROUP BY node) d
WHERE n.id = d.node;

-- Connected components of the full pedestrian graph (used to detect islands).
UPDATE routing_node n SET component_id = c.component
FROM pgr_connectedComponents(
    format('SELECT id, source, target, length_m AS cost, length_m AS reverse_cost FROM routing_edge WHERE region_code = %%L', %(region)s::text)
) c
WHERE n.id = c.node;

UPDATE routing_edge e SET component_id = n.component_id
FROM routing_node n WHERE e.source = n.id AND e.region_code = %(region)s;

UPDATE routing_edge e SET component_size = c.n
FROM (SELECT component_id, count(*) AS n FROM routing_node WHERE region_code = %(region)s GROUP BY component_id) c
WHERE e.component_id = c.component_id AND e.region_code = %(region)s;

UPDATE edge_accessibility a SET max_node_degree = GREATEST(s.degree, t.degree)
FROM routing_edge e
JOIN routing_node s ON s.id = e.source
JOIN routing_node t ON t.id = e.target
WHERE a.edge_id = e.id AND e.region_code = %(region)s;

-- A bench within 25 m of the segment counts as a resting opportunity.
UPDATE edge_accessibility a SET bench_nearby = true
FROM routing_edge e
WHERE a.edge_id = e.id AND e.region_code = %(region)s
  AND EXISTS (
    SELECT 1 FROM accessibility_feature f
    WHERE f.feature_type = 'BENCH' AND f.region_code = %(region)s
      AND ST_DWithin(f.geom::geography, e.geom::geography, 25));

ANALYZE routing_node;
ANALYZE routing_edge;
ANALYZE edge_accessibility;
"""

STATS_SQL = """
WITH comp AS (
    SELECT component_id, count(*) AS n FROM routing_node
    WHERE region_code = %(region)s GROUP BY component_id)
SELECT
    (SELECT count(*) FROM routing_edge WHERE region_code = %(region)s) AS edges,
    (SELECT count(*) FROM routing_node WHERE region_code = %(region)s) AS nodes,
    (SELECT round(sum(length_m)::numeric / 1000, 1) FROM routing_edge WHERE region_code = %(region)s) AS edge_km,
    (SELECT count(*) FROM comp) AS components,
    (SELECT max(n) FROM comp) AS largest_component_nodes,
    (SELECT count(*) FROM edge_accessibility a JOIN routing_edge e ON e.id = a.edge_id
       WHERE e.region_code = %(region)s AND a.is_stairs) AS stairs_edges,
    (SELECT count(*) FROM edge_accessibility a JOIN routing_edge e ON e.id = a.edge_id
       WHERE e.region_code = %(region)s AND (a.is_crossing OR a.crossing_via_node)) AS crossing_edges,
    (SELECT count(*) FROM place WHERE region_code = %(region)s) AS places,
    (SELECT count(*) FROM accessibility_feature WHERE region_code = %(region)s AND feature_type = 'BENCH') AS benches,
    (SELECT round(avg(completeness)::numeric, 3) FROM edge_accessibility a JOIN routing_edge e ON e.id = a.edge_id
       WHERE e.region_code = %(region)s) AS avg_completeness
"""
