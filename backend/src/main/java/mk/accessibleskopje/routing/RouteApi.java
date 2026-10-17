package mk.accessibleskopje.routing;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** Request/response records of the routing API. */
public final class RouteApi {

    private RouteApi() {
    }

    public record LatLon(
            @NotNull @DecimalMin("-90") @DecimalMax("90") Double lat,
            @NotNull @DecimalMin("-180") @DecimalMax("180") Double lon) {
    }

    @Schema(description = "Route calculation request")
    public record RouteRequest(
            @NotNull @Valid LatLon origin,
            @NotNull @Valid LatLon destination,
            @Schema(example = "WHEELCHAIR") @Pattern(regexp = "[A-Z_]{1,40}") String profile,
            @Valid RoutingPreferences preferences,
            @Schema(description = "Return alternative routes when they differ meaningfully") Boolean alternatives) {
    }

    public record SnappedPoint(double lat, double lon, double requestedLat, double requestedLon,
                               double snapDistanceM, Map<String, String> streetNames) {
    }

    public record RouteResponse(
            String profile,
            RoutingPreferences preferences,
            SnappedPoint origin,
            SnappedPoint destination,
            List<RouteOption> routes,
            NoRoute noRoute,
            DataNotice dataNotice) {
    }

    public record DataNotice(String code, Instant osmDataTimestamp, List<String> sources) {
    }

    public record NoRoute(String reason, List<BlockingFeature> blockingFeatures, Double shortestUnconstrainedM) {
    }

    public record BlockingFeature(String type, int count, List<double[]> locations) {
    }

    public record LineGeometry(String type, List<double[]> coordinates) {
    }

    public record RouteOption(
            String id,
            List<String> kinds,
            double distanceM,
            double durationS,
            LineGeometry geometry,
            List<Instruction> instructions,
            RouteSummary summary,
            Coverage coverage,
            Suitability suitability,
            List<Warning> warnings,
            List<NearbyObstacle> obstacles,
            Explanation explanation) {
    }

    public record Instruction(
            int index,
            String type,
            String modifier,
            double distanceM,
            double startDistanceM,
            Map<String, String> names,
            String pathClass,
            double[] location,
            Integer bearing,
            CrossingDetails crossing,
            StairsDetails stairs,
            List<String> notes) {
    }

    public record CrossingDetails(String type, Boolean signals, Boolean sound, Boolean vibration,
                                  Boolean tactilePaving, Boolean island, String kerb, Double kerbHeightCm) {
    }

    public record StairsDetails(String direction, Integer stepCount, Boolean handrail, Boolean ramp) {
    }

    public record RouteSummary(
            int stairs,
            int stairsWithHandrail,
            int crossings,
            int crossingsWithSignals,
            int crossingsWithSound,
            int crossingsWithTactile,
            int crossingsUnmarked,
            int crossingsKerbUnknown,
            int raisedKerbs,
            List<SteepSection> steepSections,
            double roughSurfaceM,
            double unknownSurfaceM,
            double carriagewayM,
            double unknownSidewalkM,
            double unlitM,
            double unknownLitM,
            double narrowM,
            int benchesNearRoute,
            Map<String, Double> pathClassM) {
    }

    public record SteepSection(double lengthM, double maxPct, String source, double[] location) {
    }

    public record Coverage(double score, String level, double knownSurfacePct, double knownWidthPct,
                           double mappedInclinePct, double estimatedInclinePct, double knownLitPct,
                           double crossingsCompletePct) {
    }

    public record Suitability(String level, List<Indicator> indicators) {
    }

    /** status: OK (supported by mapped data), PROBLEM (mapped issue), UNKNOWN (data missing). */
    public record Indicator(String need, String status, String detail) {
    }

    public record Warning(String code, String severity, Integer count, Double lengthM, double[] location) {
    }

    public record NearbyObstacle(String id, String category, String impact, String status, double lat, double lon,
                                 double distanceM, Instant lastConfirmedAt, boolean affectsRouting) {
    }

    public record Explanation(List<String> reasons, Double extraDistanceM, Map<String, Number> avoidedComparedToShortest) {
    }
}
