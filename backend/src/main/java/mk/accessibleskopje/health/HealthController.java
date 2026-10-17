package mk.accessibleskopje.health;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import mk.accessibleskopje.common.RegionService;
import mk.accessibleskopje.obstacles.ObstacleCategory;
import mk.accessibleskopje.obstacles.ObstacleImpact;

@RestController
@RequestMapping("/api")
@Tag(name = "System")
public class HealthController {

    private static final Logger log = LoggerFactory.getLogger(HealthController.class);

    private final JdbcTemplate jdbc;
    private final RegionService regions;

    public HealthController(JdbcTemplate jdbc, RegionService regions) {
        this.jdbc = jdbc;
        this.regions = regions;
    }

    @GetMapping("/health")
    @Operation(summary = "Service health: database and routing graph status")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> out = new LinkedHashMap<>();
        try {
            Long edges = jdbc.queryForObject("SELECT count(*) FROM routing_edge WHERE region_code = ?", Long.class,
                    regions.current().code());
            List<Map<String, Object>> last = jdbc.queryForList("""
                    SELECT finished_at, source_version FROM ingestion_run
                    WHERE status = 'SUCCEEDED' ORDER BY finished_at DESC LIMIT 1""");
            boolean graph = edges != null && edges > 0;
            out.put("status", graph ? "UP" : "DEGRADED");
            out.put("database", "UP");
            out.put("graphLoaded", graph);
            out.put("graphEdges", edges);
            if (!last.isEmpty()) {
                out.put("lastImport", String.valueOf(last.get(0).get("finished_at")));
                out.put("osmDataTimestamp", last.get(0).get("source_version"));
            }
            return ResponseEntity.ok(out);
        } catch (RuntimeException e) {
            log.warn("health check failed: {}", e.getMessage());
            out.put("status", "DOWN");
            out.put("database", "DOWN");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(out);
        }
    }

    @GetMapping("/config")
    @Operation(summary = "Public client configuration: region, report categories, attribution")
    public Map<String, Object> config() {
        var r = regions.current();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("region", Map.of("code", r.code(), "names", r.names(),
                "bbox", new double[]{r.minLon(), r.minLat(), r.maxLon(), r.maxLat()},
                "center", new double[]{r.centerLon(), r.centerLat()}, "zoom", r.defaultZoom()));
        out.put("obstacleCategories", List.of(ObstacleCategory.values()));
        out.put("obstacleImpacts", List.of(ObstacleImpact.values()));
        out.put("attribution", List.of(
                Map.of("name", "OpenStreetMap contributors", "url", "https://www.openstreetmap.org/copyright",
                        "license", "ODbL 1.0"),
                Map.of("name", "Copernicus DEM GLO-30 (ESA, DLR, Airbus)",
                        "url", "https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model",
                        "license", "Copernicus DEM licence")));
        return out;
    }
}
