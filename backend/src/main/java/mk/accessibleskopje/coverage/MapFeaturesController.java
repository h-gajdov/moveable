package mk.accessibleskopje.coverage;

import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Pattern;
import mk.accessibleskopje.common.Json;
import mk.accessibleskopje.common.RegionService;

/** Mapped accessibility features (stairs, crossings, kerbs, barriers, benches, toilets) for map overlays. */
@RestController
@RequestMapping("/api")
@Validated
@Tag(name = "Coverage")
public class MapFeaturesController {

    private final JdbcTemplate jdbc;
    private final RegionService regions;

    public MapFeaturesController(JdbcTemplate jdbc, RegionService regions) {
        this.jdbc = jdbc;
        this.regions = regions;
    }

    @GetMapping("/map-features")
    @Operation(summary = "Mapped accessibility features in a small area as GeoJSON")
    public Map<String, Object> features(@RequestParam @Pattern(regexp = CoverageController.BBOX) String bbox) {
        double[] b = CoverageController.parseBbox(bbox, 0.05);
        String fc = jdbc.queryForObject("""
                WITH env AS (SELECT ST_MakeEnvelope(?, ?, ?, ?, 4326) AS g),
                f AS (
                    SELECT 'STAIRS' AS kind, ST_LineInterpolatePoint(e.geom, 0.5) AS geom,
                           json_build_object('handrail', a.handrail, 'ramp', a.ramp_wheelchair, 'steps', a.step_count) AS props
                    FROM routing_edge e JOIN edge_accessibility a ON a.edge_id = e.id, env
                    WHERE e.region_code = ? AND e.geom && env.g AND a.is_stairs
                    UNION ALL
                    SELECT DISTINCT ON (a.crossing_ref) 'CROSSING', ST_LineInterpolatePoint(e.geom, 0.5),
                           json_build_object('type', a.crossing_type, 'signals', a.crossing_signals,
                                             'sound', a.crossing_sound, 'tactile', a.tactile_paving, 'kerb', a.kerb_type)
                    FROM routing_edge e JOIN edge_accessibility a ON a.edge_id = e.id, env
                    WHERE e.region_code = ? AND e.geom && env.g AND a.is_crossing
                    UNION ALL
                    SELECT CASE WHEN jsonb_exists(n.tags, 'barrier') AND n.tags->>'barrier' <> 'kerb' THEN 'BARRIER' ELSE 'KERB' END,
                           n.geom, json_build_object('barrier', n.tags->>'barrier', 'kerb', n.tags->>'kerb')
                    FROM routing_node n, env
                    WHERE n.region_code = ? AND n.geom && env.g
                      AND (jsonb_exists(n.tags, 'barrier') OR jsonb_exists(n.tags, 'kerb'))
                    UNION ALL
                    SELECT f.feature_type, f.geom, json_build_object('wheelchair', f.tags->>'wheelchair')
                    FROM accessibility_feature f, env
                    WHERE f.region_code = ? AND f.geom && env.g AND f.feature_type IN ('BENCH', 'TOILETS', 'ELEVATOR'))
                SELECT json_build_object('type', 'FeatureCollection', 'features', coalesce(json_agg(json_build_object(
                    'type', 'Feature', 'geometry', ST_AsGeoJSON(geom, 6)::json,
                    'properties', (props::jsonb || jsonb_build_object('kind', kind))
                )), '[]'::json))::text FROM (SELECT * FROM f LIMIT 3000) x""",
                String.class, b[0], b[1], b[2], b[3], regions.current().code(), regions.current().code(),
                regions.current().code(), regions.current().code());
        return Json.objectMap(fc);
    }
}
