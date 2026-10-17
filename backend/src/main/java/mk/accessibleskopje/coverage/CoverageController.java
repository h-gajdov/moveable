package mk.accessibleskopje.coverage;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import mk.accessibleskopje.common.ApiException;
import mk.accessibleskopje.common.Json;
import mk.accessibleskopje.common.RegionService;

/** How much accessibility information exists for an area — and how much is missing. */
@RestController
@RequestMapping("/api")
@Validated
@Tag(name = "Coverage")
public class CoverageController {

    static final String BBOX = "-?\\d+(\\.\\d+)?(,-?\\d+(\\.\\d+)?){3}";

    private final JdbcTemplate jdbc;
    private final RegionService regions;

    public CoverageController(JdbcTemplate jdbc, RegionService regions) {
        this.jdbc = jdbc;
        this.regions = regions;
    }

    static double[] parseBbox(String bbox, double maxSpanDeg) {
        String[] p = bbox.split(",");
        double[] b = {Double.parseDouble(p[0]), Double.parseDouble(p[1]), Double.parseDouble(p[2]),
                Double.parseDouble(p[3])};
        if (b[2] <= b[0] || b[3] <= b[1] || b[2] - b[0] > maxSpanDeg || b[3] - b[1] > maxSpanDeg) {
            throw ApiException.badRequest("BBOX_INVALID", "The requested area is invalid or too large.");
        }
        return b;
    }

    @GetMapping("/coverage")
    @Operation(summary = "Accessibility data coverage for an area, with an optional grid for map overlays")
    public Map<String, Object> coverage(@RequestParam @Pattern(regexp = BBOX) String bbox,
                                        @RequestParam(defaultValue = "false") boolean grid,
                                        @RequestParam(defaultValue = "400") @Min(150) @Max(2000) int cellM) {
        double[] b = parseBbox(bbox, 0.4);
        String region = regions.current().code();
        Map<String, Object> summary = jdbc.queryForMap("""
                WITH e AS (
                    SELECT e.length_m AS len, e.path_class, a.*
                    FROM routing_edge e JOIN edge_accessibility a ON a.edge_id = e.id
                    WHERE e.region_code = ? AND e.geom && ST_MakeEnvelope(?, ?, ?, ?, 4326))
                SELECT count(*) AS edges,
                       round(coalesce(sum(len), 0)::numeric / 1000, 2) AS network_km,
                       round(coalesce(sum(len * completeness) / nullif(sum(len), 0), 0)::numeric, 3) AS completeness,
                       round(coalesce(100 * sum(len) FILTER (WHERE surface_class <> 'UNKNOWN') / nullif(sum(len), 0), 0)::numeric, 1) AS surface_known_pct,
                       round(coalesce(100 * sum(len) FILTER (WHERE width_m IS NOT NULL) / nullif(sum(len) FILTER (WHERE path_class NOT LIKE 'ROAD%' AND path_class <> 'SERVICE'), 0), 0)::numeric, 1) AS width_known_pct,
                       round(coalesce(100 * sum(len) FILTER (WHERE incline_source = 'OSM' OR is_stairs) / nullif(sum(len), 0), 0)::numeric, 1) AS incline_mapped_pct,
                       round(coalesce(100 * sum(len) FILTER (WHERE incline_source = 'DEM') / nullif(sum(len), 0), 0)::numeric, 1) AS incline_estimated_pct,
                       round(coalesce(100 * sum(len) FILTER (WHERE lit IS NOT NULL) / nullif(sum(len), 0), 0)::numeric, 1) AS lit_known_pct,
                       round(coalesce(100 * sum(len) FILTER (WHERE path_class = 'ROAD_SIDEWALK_UNKNOWN') / nullif(sum(len), 0), 0)::numeric, 1) AS sidewalk_unknown_pct,
                       count(*) FILTER (WHERE is_crossing OR crossing_via_node) AS crossing_segments,
                       count(*) FILTER (WHERE (is_crossing OR crossing_via_node) AND kerb_type IS NOT NULL) AS crossing_segments_kerb_known,
                       count(*) FILTER (WHERE (is_crossing OR crossing_via_node) AND tactile_paving IS NOT NULL) AS crossing_segments_tactile_known,
                       count(*) FILTER (WHERE crossing_signals) AS signalised_crossing_segments,
                       count(*) FILTER (WHERE crossing_signals AND crossing_sound IS NOT NULL) AS signalised_sound_known,
                       count(*) FILTER (WHERE is_stairs) AS stairs_segments
                FROM e""", region, b[0], b[1], b[2], b[3]);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("bbox", b);
        out.put("summary", summary);
        out.put("reports", jdbc.queryForMap("""
                SELECT count(*) FILTER (WHERE status = 'VERIFIED') AS verified,
                       count(*) FILTER (WHERE status = 'PENDING') AS pending
                FROM obstacle_report WHERE geom && ST_MakeEnvelope(?, ?, ?, ?, 4326)
                  AND (expires_at IS NULL OR expires_at > now())""", b[0], b[1], b[2], b[3]));
        if (grid) {
            String fc = jdbc.queryForObject("""
                    WITH env AS (SELECT ST_Transform(ST_MakeEnvelope(?, ?, ?, ?, 4326), 3857) AS g),
                    cells AS (SELECT (ST_SquareGrid(?, env.g)).* FROM env),
                    stats AS (
                        SELECT c.i, c.j, c.geom, sum(e.length_m) AS len,
                               sum(e.length_m * a.completeness) / nullif(sum(e.length_m), 0) AS completeness
                        FROM cells c
                        JOIN routing_edge e ON e.region_code = ?
                             AND ST_Transform(ST_Centroid(e.geom), 3857) && c.geom
                             AND ST_Intersects(ST_Transform(ST_Centroid(e.geom), 3857), c.geom)
                        JOIN edge_accessibility a ON a.edge_id = e.id
                        GROUP BY c.i, c.j, c.geom HAVING sum(e.length_m) > 50)
                    SELECT json_build_object('type', 'FeatureCollection', 'features', coalesce(json_agg(json_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(ST_Transform(geom, 4326), 6)::json,
                        'properties', json_build_object('completeness', round(completeness::numeric, 3),
                                                        'networkM', round(len::numeric))
                    )), '[]'::json))::text FROM stats""", String.class, b[0], b[1], b[2], b[3], (double) cellM, region);
            out.put("grid", Json.objectMap(fc));
        }
        return out;
    }
}
