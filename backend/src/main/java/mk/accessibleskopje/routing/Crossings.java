package mk.accessibleskopje.routing;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

import mk.accessibleskopje.routing.RouteApi.CrossingDetails;

/**
 * Finds the street crossings a route actually makes.
 *
 * <ul>
 *   <li>Mapped crossing ways ({@code footway=crossing}): consecutive segments with the
 *       same crossing reference form one crossing.</li>
 *   <li>Crossings mapped only as a node on the road: the route crosses there only if it
 *       arrives on one pedestrian segment tagged with that node and leaves on another.
 *       Walking along the road past the node is not a crossing.</li>
 * </ul>
 */
final class Crossings {

    private Crossings() {
    }

    record Crossing(String ref, int firstSegment, int lastSegment, boolean viaNode, CrossingDetails details,
                    double[] location) {
    }

    static List<Crossing> extract(List<Segment> segs) {
        List<Crossing> out = new ArrayList<>();
        int i = 0;
        while (i < segs.size()) {
            Segment s = segs.get(i);
            if (s.crossing()) {
                int j = i;
                while (j + 1 < segs.size() && segs.get(j + 1).crossing()
                        && Objects.equals(segs.get(j + 1).crossingRef(), s.crossingRef())) {
                    j++;
                }
                out.add(new Crossing(s.crossingRef(), i, j, false, details(segs.subList(i, j + 1)),
                        s.coords().isEmpty() ? null : s.coords().get(0)));
                i = j + 1;
                continue;
            }
            if (s.crossingViaNode() && !s.crossing() && i + 1 < segs.size()) {
                Segment n = segs.get(i + 1);
                if (n.crossingViaNode() && !n.crossing() && Objects.equals(n.crossingRef(), s.crossingRef())) {
                    double[] at = s.coords().isEmpty() ? null : s.coords().get(s.coords().size() - 1);
                    out.add(new Crossing(s.crossingRef(), i, i + 1, true, details(List.of(s, n)), at));
                    i += 2;
                    continue;
                }
            }
            i++;
        }
        return out;
    }

    static int kerbSeverity(String kerb) {
        if (kerb == null) {
            return -1;
        }
        return switch (kerb) {
            case "flush" -> 0;
            case "lowered", "rolled" -> 1;
            case "yes" -> 2;
            case "raised" -> 3;
            default -> -1;
        };
    }

    private static CrossingDetails details(List<Segment> parts) {
        String type = null, kerb = null;
        Boolean signals = null, sound = null, vibration = null, tactile = null, island = null;
        Double kerbH = null;
        for (Segment p : parts) {
            type = type != null ? type : p.crossingType();
            signals = signals != null ? signals : p.crossingSignals();
            sound = sound != null ? sound : p.crossingSound();
            vibration = vibration != null ? vibration : p.crossingVibration();
            tactile = tactile != null ? tactile : p.tactilePaving();
            island = island != null ? island : p.crossingIsland();
            if (kerbSeverity(p.kerbType()) > kerbSeverity(kerb)) {
                kerb = p.kerbType();
            }
            if (p.kerbHeightCm() != null && (kerbH == null || p.kerbHeightCm() > kerbH)) {
                kerbH = p.kerbHeightCm();
            }
        }
        return new CrossingDetails(type, signals, sound, vibration, tactile, island, kerb, kerbH);
    }
}
