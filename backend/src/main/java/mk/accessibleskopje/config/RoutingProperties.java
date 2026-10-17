package mk.accessibleskopje.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Routing weights and limits, bound from {@code app.routing} in application.yml. */
@ConfigurationProperties(prefix = "app.routing")
public record RoutingProperties(
        double maxSnapDistanceM,
        double snapWarningDistanceM,
        int minComponentSize,
        double searchMarginDeg,
        double maxRouteDistanceM,
        double obstacleBufferM,
        double alternativesOverlapThreshold,
        Weights weights) {

    public record Weights(
            double minimizeDistanceScale,
            Surface surface,
            Slope slope,
            Traffic traffic,
            PedestrianPreference pedestrianPreference,
            Crossing crossing,
            Uncertainty uncertainty,
            Intersections intersections,
            Lit lit,
            Rest rest,
            Stairs stairs,
            double wheelchairLimited,
            Obstacles obstacles) {
    }

    public record Surface(double intermediate, double rough, double veryRough, double impassable, double unknown,
                          double wheeledMultiplier) {
    }

    public record Slope(double comfortablePct, double perPct, double estimatedWeight, double overLimitEstimated,
                        double hintPenalty) {
    }

    public record Traffic(double perExposureLevel, double minimizePerExposureLevel,
                          double carriagewayWithSeparateSidewalk) {
    }

    public record PedestrianPreference(double roadPenalty, double trackPenalty) {
    }

    public record Crossing(double signals, double marked, double unmarked, double informal, double unknown,
                           double accessibleMissingSound, double accessibleMissingTactile, double wheeledUnknownKerb,
                           double viaNodeShare) {
    }

    public record Uncertainty(double base, double profile, double coverageAlternative) {
    }

    public record Intersections(double perExtraBranch) {
    }

    public record Lit(double unlitOrUnknown) {
    }

    public record Rest(double noBench) {
    }

    public record Stairs(double penalty) {
    }

    public record Obstacles(double difficult, double minor) {
    }
}
