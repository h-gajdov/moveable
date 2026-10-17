package mk.accessibleskopje.routing;

import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import mk.accessibleskopje.common.ApiException;
import mk.accessibleskopje.common.Json;

/** Routing profiles are stored in {@code route_profile}; weights come from configuration. */
@Service
public class ProfileService {

    public record Profile(String code, int sortOrder, RoutingPreferences defaults) {
    }

    private final JdbcTemplate jdbc;

    public ProfileService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Profile> list() {
        return jdbc.query("SELECT code, sort_order, preferences::text AS p FROM route_profile WHERE enabled ORDER BY sort_order",
                (rs, i) -> new Profile(rs.getString("code"), rs.getInt("sort_order"),
                        Json.read(rs.getString("p"), RoutingPreferences.class)));
    }

    public Profile get(String code) {
        return list().stream().filter(p -> p.code().equals(code)).findFirst()
                .orElseThrow(() -> ApiException.badRequest("UNKNOWN_PROFILE", "Unknown routing profile."));
    }

    /** Description of every configurable preference, for building settings UIs. */
    public static List<Map<String, Object>> settingsSchema() {
        return List.of(
                Map.of("key", "wheeled", "type", "boolean", "hard", true),
                Map.of("key", "visualGuidance", "type", "boolean", "hard", false),
                Map.of("key", "avoidStairs", "type", "boolean", "hard", true),
                Map.of("key", "maxInclinePct", "type", "number", "min", 1, "max", 30, "unit", "%", "hard", true),
                Map.of("key", "minWidthM", "type", "number", "min", 0.5, "max", 5, "unit", "m", "hard", true),
                Map.of("key", "maxKerbHeightCm", "type", "number", "min", 0, "max", 20, "unit", "cm", "hard", true),
                Map.of("key", "avoidRoughSurfaces", "type", "boolean", "hard", false),
                Map.of("key", "preferPedestrianAreas", "type", "boolean", "hard", false),
                Map.of("key", "preferAccessibleCrossings", "type", "boolean", "hard", false),
                Map.of("key", "minimizeTrafficExposure", "type", "boolean", "hard", false),
                Map.of("key", "preferSimpleIntersections", "type", "boolean", "hard", false),
                Map.of("key", "minimizeDistance", "type", "boolean", "hard", false),
                Map.of("key", "preferRestingSpots", "type", "boolean", "hard", false),
                Map.of("key", "preferLitPaths", "type", "boolean", "hard", false),
                Map.of("key", "walkingSpeedMps", "type", "number", "min", 0.3, "max", 2.5, "unit", "m/s", "hard", false));
    }
}
