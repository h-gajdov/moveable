package mk.accessibleskopje.routing;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;

/**
 * User routing needs. Every field is optional in requests; missing fields are
 * filled from the selected profile's defaults (see {@link #mergedOnto}).
 * None of these fields asks for a diagnosis: they describe needs only.
 */
@Schema(description = "Accessibility routing preferences. Null fields fall back to the profile defaults.")
public record RoutingPreferences(
        @Schema(description = "Uses a wheelchair, scooter, stroller or other wheeled aid (enables kerb, barrier and wheelchair=no checks)")
        Boolean wheeled,
        @Schema(description = "Needs non-visual guidance (prefers audible signals, tactile paving, separated paths)")
        Boolean visualGuidance,
        Boolean avoidStairs,
        @DecimalMin("1") @DecimalMax("30") Double maxInclinePct,
        @DecimalMin("0.5") @DecimalMax("5") Double minWidthM,
        @DecimalMin("0") @DecimalMax("20") Double maxKerbHeightCm,
        Boolean avoidRoughSurfaces,
        Boolean preferPedestrianAreas,
        Boolean preferAccessibleCrossings,
        Boolean minimizeTrafficExposure,
        Boolean preferSimpleIntersections,
        Boolean minimizeDistance,
        Boolean preferRestingSpots,
        Boolean preferLitPaths,
        @DecimalMin("0.3") @DecimalMax("2.5") Double walkingSpeedMps) {

    public static RoutingPreferences empty() {
        return new RoutingPreferences(null, null, null, null, null, null, null, null, null, null, null, null, null,
                null, null);
    }

    /** Fields set in {@code this} win; the rest come from {@code base}. */
    public RoutingPreferences mergedOnto(RoutingPreferences base) {
        return new RoutingPreferences(
                or(wheeled, base.wheeled), or(visualGuidance, base.visualGuidance),
                or(avoidStairs, base.avoidStairs), or(maxInclinePct, base.maxInclinePct),
                or(minWidthM, base.minWidthM), or(maxKerbHeightCm, base.maxKerbHeightCm),
                or(avoidRoughSurfaces, base.avoidRoughSurfaces), or(preferPedestrianAreas, base.preferPedestrianAreas),
                or(preferAccessibleCrossings, base.preferAccessibleCrossings),
                or(minimizeTrafficExposure, base.minimizeTrafficExposure),
                or(preferSimpleIntersections, base.preferSimpleIntersections),
                or(minimizeDistance, base.minimizeDistance), or(preferRestingSpots, base.preferRestingSpots),
                or(preferLitPaths, base.preferLitPaths), or(walkingSpeedMps, base.walkingSpeedMps));
    }

    private static <T> T or(T a, T b) {
        return a != null ? a : b;
    }

    public boolean is(Boolean b) {
        return Boolean.TRUE.equals(b);
    }

    public boolean isWheeled() {
        return is(wheeled);
    }

    public boolean isVisualGuidance() {
        return is(visualGuidance);
    }

    public double speed() {
        return walkingSpeedMps == null ? 1.2 : walkingSpeedMps;
    }

    /** Wheeled users get a default kerb limit even if they did not configure one. */
    public double effectiveMaxKerbCm() {
        return maxKerbHeightCm != null ? maxKerbHeightCm : 3.0;
    }
}
