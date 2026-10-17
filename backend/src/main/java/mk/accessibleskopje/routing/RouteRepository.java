package mk.accessibleskopje.routing;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import mk.accessibleskopje.common.Geo;
import mk.accessibleskopje.common.Json;

/** All SQL used by routing. pgRouting is called with SQL built by {@link EdgeCostBuilder}. */
@Repository
public class RouteRepository {

    private final JdbcTemplate jdbc;

    public RouteRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** A request point projected onto the nearest usable edge. */
    public record Snap(long edgeId, long source, long target, double lengthM, double fraction, double lat, double lon,
                       double distanceM, Map<String, String> names, long componentId) {
    }

    public Optional<Snap> snap(String region, double lat, double lon, String hardConstraints, double maxDistM,
                               int minComponentSize) {
        double deg = maxDistM / 75_000.0;
        String sql = """
                WITH pt AS (SELECT ST_SetSRID(ST_MakePoint(?, ?), 4326) AS g),
                cand AS (
                    SELECT e.id, e.source, e.target, e.length_m, e.component_id, e.names::text AS names, e.geom,
                           ST_Distance(e.geom::geography, pt.g::geography) AS d
                    FROM routing_edge e JOIN edge_accessibility a ON a.edge_id = e.id, pt
                    WHERE e.region_code = ? AND e.geom && ST_Expand(pt.g, ?) AND e.component_size >= ?
                      AND %s
                    ORDER BY d LIMIT 1)
                SELECT c.*, ST_LineLocatePoint(c.geom, pt.g) AS frac,
                       ST_X(ST_LineInterpolatePoint(c.geom, ST_LineLocatePoint(c.geom, pt.g))) AS x,
                       ST_Y(ST_LineInterpolatePoint(c.geom, ST_LineLocatePoint(c.geom, pt.g))) AS y
                FROM cand c, pt WHERE c.d <= ?
                """.formatted(hardConstraints);
        List<Snap> rows = jdbc.query(sql, (rs, i) -> new Snap(rs.getLong("id"), rs.getLong("source"),
                        rs.getLong("target"), rs.getDouble("length_m"), rs.getDouble("frac"), rs.getDouble("y"),
                        rs.getDouble("x"), rs.getDouble("d"), Json.stringMap(rs.getString("names")),
                        rs.getLong("component_id")),
                lon, lat, region, deg, minComponentSize, maxDistM);
        return rows.stream().findFirst();
    }

    /** Distance to the nearest edge of any kind (used to explain snapping failures). */
    public Optional<Double> nearestAnyEdgeDistance(String region, double lat, double lon, double maxDistM) {
        double deg = maxDistM / 75_000.0;
        List<Double> d = jdbc.query("""
                WITH pt AS (SELECT ST_SetSRID(ST_MakePoint(?, ?), 4326) AS g)
                SELECT ST_Distance(e.geom::geography, pt.g::geography) AS d
                FROM routing_edge e, pt WHERE e.region_code = ? AND e.geom && ST_Expand(pt.g, ?)
                ORDER BY d LIMIT 1""", (rs, i) -> rs.getDouble("d"), lon, lat, region, deg);
        return d.stream().filter(v -> v <= maxDistM).findFirst();
    }

    /** Cost of a single edge under the given cost model (null if the edge is excluded). */
    public Double edgeCost(EdgeCostBuilder b, long edgeId) {
        String sql = "SELECT " + b.costExpression() + " AS cost FROM routing_edge e JOIN edge_accessibility a"
                + " ON a.edge_id = e.id" + b.obstacleJoin() + " WHERE e.id = ? AND " + b.hardConstraints();
        List<Double> r = jdbc.query(sql, (rs, i) -> rs.getDouble("cost"), edgeId);
        return r.isEmpty() ? null : r.get(0);
    }

    public record PathStep(long node, long edge, double aggCost) {
    }

    /** Many-to-many undirected Dijkstra. Key = "start:end". */
    public Map<String, List<PathStep>> dijkstra(String edgesSql, long[] starts, long[] ends) {
        Map<String, List<PathStep>> paths = new LinkedHashMap<>();
        jdbc.query(con -> {
            var ps = con.prepareStatement("""
                    SELECT start_vid, end_vid, path_seq, node, edge, agg_cost
                    FROM pgr_dijkstra(?, ?::bigint[], ?::bigint[], directed => false)
                    ORDER BY start_vid, end_vid, path_seq""");
            ps.setString(1, edgesSql);
            ps.setArray(2, con.createArrayOf("bigint", box(starts)));
            ps.setArray(3, con.createArrayOf("bigint", box(ends)));
            return ps;
        }, (ResultSet rs) -> {
            String key = rs.getLong("start_vid") + ":" + rs.getLong("end_vid");
            paths.computeIfAbsent(key, k -> new ArrayList<>())
                    .add(new PathStep(rs.getLong("node"), rs.getLong("edge"), rs.getDouble("agg_cost")));
        });
        return paths;
    }

    private static Long[] box(long[] v) {
        Long[] out = new Long[v.length];
        for (int i = 0; i < v.length; i++) {
            out[i] = v[i];
        }
        return out;
    }

    /** One piece to fetch: edge plus the fraction range in travel order (f0 > f1 means reversed). */
    public record Piece(long edgeId, double f0, double f1) {
    }

    public List<Segment> fetchSegments(List<Piece> pieces) {
        if (pieces.isEmpty()) {
            return List.of();
        }
        Long[] ids = pieces.stream().map(Piece::edgeId).toArray(Long[]::new);
        Double[] f0 = pieces.stream().map(Piece::f0).toArray(Double[]::new);
        Double[] f1 = pieces.stream().map(Piece::f1).toArray(Double[]::new);
        return jdbc.query(con -> {
            var ps = con.prepareStatement("""
                    SELECT t.ord, t.f0, t.f1, e.id, e.osm_way_id, e.path_class, e.road_class, e.names::text AS names,
                           e.length_m * abs(t.f1 - t.f0) AS seg_len,
                           ST_AsText(CASE WHEN t.f0 <= t.f1 THEN ST_LineSubstring(e.geom, t.f0, t.f1)
                                          ELSE ST_Reverse(ST_LineSubstring(e.geom, t.f1, t.f0)) END) AS wkt,
                           a.*
                    FROM unnest(?::bigint[], ?::float8[], ?::float8[]) WITH ORDINALITY AS t(edge_id, f0, f1, ord)
                    JOIN routing_edge e ON e.id = t.edge_id
                    JOIN edge_accessibility a ON a.edge_id = e.id
                    ORDER BY t.ord""");
            Array a1 = con.createArrayOf("bigint", ids);
            Array a2 = con.createArrayOf("float8", f0);
            Array a3 = con.createArrayOf("float8", f1);
            ps.setArray(1, a1);
            ps.setArray(2, a2);
            ps.setArray(3, a3);
            return ps;
        }, (rs, i) -> toSegment(rs));
    }

    private static Segment toSegment(ResultSet rs) throws SQLException {
        double f0 = rs.getDouble("f0"), f1 = rs.getDouble("f1");
        boolean reversed = f0 > f1;
        boolean partial = Math.abs(Math.abs(f1 - f0) - 1.0) > 1e-9;
        Double incline = getDouble(rs, "incline_pct");
        if (incline != null && reversed) {
            incline = -incline;
        }
        String hint = rs.getString("incline_hint");
        if (reversed && hint != null) {
            hint = switch (hint) {
                case "up" -> "down";
                case "down" -> "up";
                default -> hint;
            };
        }
        String wkt = rs.getString("wkt");
        List<double[]> coords = wkt != null && wkt.startsWith("LINESTRING") ? Geo.parseLineString(wkt) : List.of();
        return new Segment(rs.getLong("id"), rs.getLong("osm_way_id"), partial, coords, rs.getDouble("seg_len"),
                rs.getString("path_class"), rs.getString("road_class"), Json.stringMap(rs.getString("names")),
                rs.getString("surface"), rs.getString("surface_class"), getDouble(rs, "width_m"),
                getBool(rs, "width_estimated"), incline, rs.getString("incline_source"), hint,
                rs.getBoolean("is_stairs"), getInt(rs, "step_count"), getBool(rs, "handrail"),
                getBool(rs, "ramp_wheelchair"), rs.getString("kerb_type"), getDouble(rs, "kerb_height_cm"),
                rs.getString("wheelchair"), getBool(rs, "lit"), getBool(rs, "tactile_paving"), rs.getString("barrier"),
                rs.getString("barrier_effect"), rs.getBoolean("is_crossing"), rs.getBoolean("crossing_via_node"),
                rs.getString("crossing_ref"), rs.getString("crossing_type"), getBool(rs, "crossing_markings"),
                getBool(rs, "crossing_signals"), getBool(rs, "crossing_sound"), getBool(rs, "crossing_vibration"),
                getBool(rs, "crossing_island"), rs.getInt("traffic_exposure"), rs.getBoolean("bench_nearby"),
                rs.getInt("max_node_degree"), rs.getDouble("completeness"));
    }

    static Double getDouble(ResultSet rs, String col) throws SQLException {
        double v = rs.getDouble(col);
        return rs.wasNull() ? null : v;
    }

    static Boolean getBool(ResultSet rs, String col) throws SQLException {
        boolean v = rs.getBoolean(col);
        return rs.wasNull() ? null : v;
    }

    static Integer getInt(ResultSet rs, String col) throws SQLException {
        int v = rs.getInt(col);
        return rs.wasNull() ? null : v;
    }

    public record ObstacleHit(String id, String category, String impact, long edgeId) {
    }

    /** Verified, unexpired obstacles in the envelope with the edges within {@code bufferM} of them. */
    public List<ObstacleHit> activeObstacleEdges(double minLon, double minLat, double maxLon, double maxLat,
                                                 double bufferM) {
        return jdbc.query("""
                SELECT r.id::text AS id, r.category, r.impact, e.id AS edge_id
                FROM obstacle_report r
                JOIN routing_edge e ON e.geom && ST_Expand(r.geom, 0.0005)
                     AND ST_DWithin(e.geom::geography, r.geom::geography, ?)
                WHERE r.status = 'VERIFIED' AND (r.expires_at IS NULL OR r.expires_at > now())
                  AND r.geom && ST_MakeEnvelope(?, ?, ?, ?, 4326)""",
                (rs, i) -> new ObstacleHit(rs.getString("id"), rs.getString("category"), rs.getString("impact"),
                        rs.getLong("edge_id")),
                bufferM, minLon, minLat, maxLon, maxLat);
    }

    public record NearbyReport(String id, String category, String impact, String status, double lat, double lon,
                               double distanceM, Instant lastConfirmedAt) {
    }

    public List<NearbyReport> reportsNearLine(String lineWkt, double maxDistM) {
        return jdbc.query("""
                WITH l AS (SELECT ST_GeomFromText(?, 4326) AS g)
                SELECT r.id::text AS id, r.category, r.impact, r.status, r.lat, r.lon, r.last_confirmed_at,
                       ST_Distance(r.geom::geography, l.g::geography) AS d
                FROM obstacle_report r, l
                WHERE r.status IN ('VERIFIED', 'PENDING') AND (r.expires_at IS NULL OR r.expires_at > now())
                  AND r.geom && ST_Expand(l.g, 0.001) AND ST_DWithin(r.geom::geography, l.g::geography, ?)
                ORDER BY d""",
                (rs, i) -> new NearbyReport(rs.getString("id"), rs.getString("category"), rs.getString("impact"),
                        rs.getString("status"), rs.getDouble("lat"), rs.getDouble("lon"), rs.getDouble("d"),
                        rs.getTimestamp("last_confirmed_at").toInstant()),
                lineWkt, maxDistM);
    }

    public int benchesNearLine(String lineWkt, double maxDistM) {
        Integer n = jdbc.queryForObject("""
                WITH l AS (SELECT ST_GeomFromText(?, 4326) AS g)
                SELECT count(*) FROM accessibility_feature f, l
                WHERE f.feature_type = 'BENCH' AND f.geom && ST_Expand(l.g, 0.001)
                  AND ST_DWithin(f.geom::geography, l.g::geography, ?)""", Integer.class, lineWkt, maxDistM);
        return n == null ? 0 : n;
    }

    public Map<String, Object> osmDataInfo() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT version, retrieved_at FROM data_source WHERE code = 'osm'");
        return rows.isEmpty() ? new HashMap<>() : rows.get(0);
    }
}
