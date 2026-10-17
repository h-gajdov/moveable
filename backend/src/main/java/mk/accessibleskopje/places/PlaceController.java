package mk.accessibleskopje.places;

import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import mk.accessibleskopje.common.Json;
import mk.accessibleskopje.common.RegionService;
import mk.accessibleskopje.common.Transliteration;

/**
 * Self-hosted place search over imported OSM names (streets, POIs, addresses).
 * Search text never leaves this server. Cyrillic and Latin spellings match each other.
 */
@RestController
@RequestMapping("/api/places")
@Validated
@Tag(name = "Places")
public class PlaceController {

    public record PlaceResult(String id, String kind, String category, Map<String, String> names, double lat,
                              double lon) {
    }

    private final JdbcTemplate jdbc;
    private final RegionService regions;

    public PlaceController(JdbcTemplate jdbc, RegionService regions) {
        this.jdbc = jdbc;
        this.regions = regions;
    }

    @GetMapping
    @Operation(summary = "Search streets, places and addresses")
    public List<PlaceResult> search(@RequestParam @Size(min = 2, max = 100) String q,
                                    @RequestParam(defaultValue = "8") @Min(1) @Max(20) int limit,
                                    @RequestParam(required = false) @DecimalMin("-90") @DecimalMax("90") Double nearLat,
                                    @RequestParam(required = false) @DecimalMin("-180") @DecimalMax("180") Double nearLon) {
        String norm = Transliteration.normalizeForSearch(q);
        if (norm.length() < 2) {
            return List.of();
        }
        String like = "%" + norm.replace("\\", "").replace("%", "").replace("_", "") + "%";
        double lat = nearLat != null ? nearLat : regions.current().centerLat();
        double lon = nearLon != null ? nearLon : regions.current().centerLon();
        return jdbc.query("""
                SELECT id, kind, category, names::text AS names, ST_Y(geom) AS lat, ST_X(geom) AS lon,
                       word_similarity(?, search_text) AS sim
                FROM place
                WHERE region_code = ? AND (search_text ILIKE ? OR ? <% search_text)
                ORDER BY (search_text ILIKE ?) DESC, sim DESC, rank DESC,
                         geom <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)
                LIMIT ?""",
                (rs, i) -> new PlaceResult("p" + rs.getLong("id"), rs.getString("kind"), rs.getString("category"),
                        Json.stringMap(rs.getString("names")), rs.getDouble("lat"), rs.getDouble("lon")),
                norm, regions.current().code(), like, norm, norm + "%", lon, lat, limit);
    }

    @GetMapping("/reverse")
    @Operation(summary = "Describe a coordinate: nearest named path or street (within 60 m)")
    public Map<String, Object> reverse(@RequestParam @DecimalMin("-90") @DecimalMax("90") double lat,
                                       @RequestParam @DecimalMin("-180") @DecimalMax("180") double lon) {
        List<Map<String, Object>> rows = jdbc.query("""
                WITH pt AS (SELECT ST_SetSRID(ST_MakePoint(?, ?), 4326) AS g)
                SELECT e.names::text AS names, ST_Distance(e.geom::geography, pt.g::geography) AS d
                FROM routing_edge e, pt
                WHERE e.region_code = ? AND e.names->>'default' IS NOT NULL
                  AND e.geom && ST_Expand(pt.g, 0.001)
                ORDER BY d LIMIT 1""",
                (rs, i) -> Map.<String, Object>of("names", Json.stringMap(rs.getString("names")),
                        "distanceM", Math.round(rs.getDouble("d"))),
                lon, lat, regions.current().code());
        if (rows.isEmpty() || ((Number) rows.get(0).get("distanceM")).doubleValue() > 60) {
            return Map.of("lat", lat, "lon", lon);
        }
        return Map.of("lat", lat, "lon", lon, "street", rows.get(0));
    }
}
