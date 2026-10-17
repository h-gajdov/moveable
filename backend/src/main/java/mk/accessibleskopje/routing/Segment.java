package mk.accessibleskopje.routing;

import java.util.List;
import java.util.Map;

/**
 * One traversed piece of a route: a full edge or the partial edge at either end,
 * with geometry oriented in the direction of travel. Attribute values are as
 * stored (null = unknown). {@code inclinePct} is signed in travel direction.
 */
public record Segment(
        long edgeId,
        long osmWayId,
        boolean partial,
        List<double[]> coords,
        double lengthM,
        String pathClass,
        String roadClass,
        Map<String, String> names,
        String surface,
        String surfaceClass,
        Double widthM,
        Boolean widthEstimated,
        Double inclinePct,
        String inclineSource,
        String inclineHint,
        boolean stairs,
        Integer stepCount,
        Boolean handrail,
        Boolean rampWheelchair,
        String kerbType,
        Double kerbHeightCm,
        String wheelchair,
        Boolean lit,
        Boolean tactilePaving,
        String barrier,
        String barrierEffect,
        boolean crossing,
        boolean crossingViaNode,
        String crossingRef,
        String crossingType,
        Boolean crossingMarkings,
        Boolean crossingSignals,
        Boolean crossingSound,
        Boolean crossingVibration,
        Boolean crossingIsland,
        int trafficExposure,
        boolean benchNearby,
        int maxNodeDegree,
        double completeness) {

    public boolean anyCrossing() {
        return crossing || crossingViaNode;
    }

    public boolean onCarriageway() {
        return "ROAD_NO_SIDEWALK".equals(pathClass) || "ROAD_SIDEWALK_SEPARATE".equals(pathClass);
    }

    public boolean sidewalkUnknown() {
        return "ROAD_SIDEWALK_UNKNOWN".equals(pathClass) || ("SERVICE".equals(pathClass));
    }

    public boolean rough() {
        return "ROUGH".equals(surfaceClass) || "VERY_ROUGH".equals(surfaceClass) || "IMPASSABLE".equals(surfaceClass);
    }

    public String preferredName() {
        if (names == null) {
            return null;
        }
        return names.getOrDefault("default", names.get("mk"));
    }
}
