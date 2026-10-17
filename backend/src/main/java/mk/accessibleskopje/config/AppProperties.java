package mk.accessibleskopje.config;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public record AppProperties(
        String region,
        List<String> corsAllowedOrigins,
        Admin admin,
        Uploads uploads,
        RateLimit rateLimit) {

    public record Admin(String bootstrapUsername, String bootstrapPassword) {
    }

    public record Uploads(String dir, long maxBytes, int maxDimensionPx) {
    }

    public record RateLimit(int reportsPerWindow, int confirmationsPerWindow, int routesPerWindow, int windowSeconds) {
    }
}
