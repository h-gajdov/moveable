package mk.accessibleskopje.routing;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import mk.accessibleskopje.common.Geo;
import mk.accessibleskopje.routing.RouteApi.Instruction;
import mk.accessibleskopje.routing.RouteApi.StairsDetails;

/**
 * Builds turn-by-turn instructions purely from route geometry and mapped data.
 * Instructions are structured (type + modifier + facts); the frontend renders
 * them in the user's language and level of detail. Nothing is invented: no
 * landmarks, and crossing features are only mentioned when mapped.
 */
public final class InstructionBuilder {

    static final double TINY_LEG_M = 8.0;
    static final double BEARING_SAMPLE_M = 12.0;

    private InstructionBuilder() {
    }

    enum LegKind { WALK, CROSSING, STAIRS }

    static final class Leg {
        final LegKind kind;
        final List<Segment> segments = new ArrayList<>();
        Crossings.Crossing crossing;

        Leg(LegKind kind) {
            this.kind = kind;
        }

        double length() {
            return segments.stream().mapToDouble(Segment::lengthM).sum();
        }

        List<double[]> coords() {
            List<double[]> out = new ArrayList<>();
            for (Segment s : segments) {
                for (double[] c : s.coords()) {
                    if (out.isEmpty() || Geo.distanceM(out.get(out.size() - 1), c) > 0.01) {
                        out.add(c);
                    }
                }
            }
            return out;
        }

        Segment first() {
            return segments.get(0);
        }
    }

    public static List<Instruction> build(List<Segment> segs) {
        List<Segment> usable = segs.stream().filter(s -> s.coords().size() >= 2).toList();
        if (usable.isEmpty()) {
            return List.of();
        }
        List<Leg> legs = mergeTinyLegs(toLegs(usable));

        List<Instruction> out = new ArrayList<>();
        double cumulative = 0;
        Double prevEndBearing = null;
        for (int i = 0; i < legs.size(); i++) {
            Leg leg = legs.get(i);
            List<double[]> coords = leg.coords();
            if (coords.size() < 2) {
                cumulative += leg.length();
                continue;
            }
            double startBearing = Geo.startBearing(coords, BEARING_SAMPLE_M);
            String type;
            String modifier;
            if (prevEndBearing == null) {
                type = leg.kind == LegKind.WALK ? "DEPART" : leg.kind.name().equals("CROSSING") ? "CROSS" : "STAIRS";
                modifier = Geo.cardinal(startBearing);
                if (!"DEPART".equals(type)) {
                    // Starting directly on a crossing or stairs: still announce the departure direction first.
                    out.add(instruction(out.size(), "DEPART", modifier, 0, cumulative, leg, coords.get(0),
                            startBearing));
                }
            } else {
                modifier = turnModifier(Geo.turnAngle(prevEndBearing, startBearing));
                type = switch (leg.kind) {
                    case CROSSING -> "CROSS";
                    case STAIRS -> "STAIRS";
                    case WALK -> "STRAIGHT".equals(modifier) ? "CONTINUE" : "TURN";
                };
            }
            out.add(instruction(out.size(), type, modifier, leg.length(), cumulative, leg, coords.get(0), startBearing));
            cumulative += leg.length();
            prevEndBearing = Geo.endBearing(coords, BEARING_SAMPLE_M);
        }
        Leg last = legs.get(legs.size() - 1);
        List<double[]> lastCoords = last.coords();
        out.add(new Instruction(out.size(), "ARRIVE", null, 0, Geo.round(cumulative, 1), Map.of(), null,
                lastCoords.get(lastCoords.size() - 1), null, null, null, List.of()));
        return out;
    }

    static String turnModifier(double angle) {
        double a = Math.abs(angle);
        String side = angle > 0 ? "RIGHT" : "LEFT";
        if (a < 25) {
            return "STRAIGHT";
        }
        if (a < 50) {
            return "SLIGHT_" + side;
        }
        if (a < 140) {
            return side;
        }
        return "SHARP_" + side;
    }

    private static List<Leg> toLegs(List<Segment> segs) {
        List<Crossings.Crossing> crossings = Crossings.extract(segs);
        List<Leg> legs = new ArrayList<>();
        Leg current = null;
        int ci = 0;
        for (int i = 0; i < segs.size(); i++) {
            Segment s = segs.get(i);
            Crossings.Crossing cr = ci < crossings.size() ? crossings.get(ci) : null;
            if (cr != null && !cr.viaNode() && i == cr.firstSegment()) {
                current = new Leg(LegKind.CROSSING);
                current.crossing = cr;
                for (int j = cr.firstSegment(); j <= cr.lastSegment(); j++) {
                    current.segments.add(segs.get(j));
                }
                legs.add(current);
                current = null;
                i = cr.lastSegment();
                ci++;
                continue;
            }
            if (cr != null && cr.viaNode() && i == cr.lastSegment()) {
                // Crossing at the node between the previous segment and this one:
                // insert a zero-length crossing leg, then continue walking.
                Leg crossingLeg = new Leg(LegKind.CROSSING);
                crossingLeg.crossing = cr;
                crossingLeg.segments.add(zeroLength(segs.get(cr.firstSegment()), s));
                legs.add(crossingLeg);
                current = null;
                ci++;
            }
            LegKind kind = s.stairs() ? LegKind.STAIRS : LegKind.WALK;
            if (current == null || current.kind != kind || startsNewLeg(current, s)) {
                current = new Leg(kind);
                legs.add(current);
            }
            current.segments.add(s);
        }
        return legs;
    }

    private static Segment zeroLength(Segment before, Segment after) {
        double[] at = before.coords().get(before.coords().size() - 1);
        double[] next = after.coords().size() > 1 ? after.coords().get(1) : at;
        double[] prev = before.coords().size() > 1 ? before.coords().get(before.coords().size() - 2) : at;
        // A tiny two-point line through the junction so bearings stay meaningful.
        return new Segment(before.edgeId(), before.osmWayId(), true, List.of(prev, at, next), 0, "CROSSING",
                null, Map.of(), null, null, null, null, null, null, null, false, null, null, null,
                before.kerbType(), before.kerbHeightCm(), null, null, before.tactilePaving(), null, null, false, true,
                before.crossingRef(), before.crossingType(), before.crossingMarkings(), before.crossingSignals(),
                before.crossingSound(), before.crossingVibration(), before.crossingIsland(), 0, false, 0, 1);
    }

    private static boolean startsNewLeg(Leg current, Segment s) {
        Segment last = current.segments.get(current.segments.size() - 1);
        String a = last.preferredName(), b = s.preferredName();
        if (!Objects.equals(a, b)) {
            return true;
        }
        if (current.kind == LegKind.STAIRS) {
            return last.osmWayId() != s.osmWayId();
        }
        double angle = Math.abs(Geo.turnAngle(Geo.endBearing(last.coords(), BEARING_SAMPLE_M),
                Geo.startBearing(s.coords(), BEARING_SAMPLE_M)));
        // Unnamed paths: break on real turns. Named streets: only on sharp direction changes.
        return a == null ? angle >= 40 : angle >= 70;
    }

    /** Fold short unnamed walking legs (sidewalk stubs, junction offsets) into a neighbour. */
    private static List<Leg> mergeTinyLegs(List<Leg> legs) {
        List<Leg> out = new ArrayList<>();
        for (Leg leg : legs) {
            boolean tiny = leg.kind == LegKind.WALK && leg.length() < TINY_LEG_M;
            if (tiny && !out.isEmpty() && out.get(out.size() - 1).kind == LegKind.WALK) {
                out.get(out.size() - 1).segments.addAll(leg.segments);
            } else {
                out.add(leg);
            }
        }
        // A tiny first leg merges forward.
        if (out.size() > 1 && out.get(0).kind == LegKind.WALK && out.get(0).length() < TINY_LEG_M
                && out.get(1).kind == LegKind.WALK) {
            out.get(1).segments.addAll(0, out.get(0).segments);
            out.remove(0);
        }
        return out;
    }

    private static Instruction instruction(int index, String type, String modifier, double distance, double start,
                                           Leg leg, double[] location, double bearing) {
        Segment first = leg.first();
        Map<String, String> names = leg.kind == LegKind.CROSSING ? Map.of()
                : (first.names() == null ? Map.of() : first.names());
        StairsDetails stairs = null;
        if (leg.kind == LegKind.STAIRS) {
            stairs = new StairsDetails(stairsDirection(leg), sumSteps(leg), first.handrail(), first.rampWheelchair());
        }
        return new Instruction(index, type, modifier, roundDistance(distance), Geo.round(start, 1), names,
                leg.kind == LegKind.CROSSING ? "CROSSING" : first.pathClass(), location, (int) Math.round(bearing),
                leg.crossing == null ? null : leg.crossing.details(), stairs, notes(leg));
    }

    private static String stairsDirection(Leg leg) {
        Segment s = leg.first();
        if (s.inclinePct() != null && "OSM".equals(s.inclineSource()) && s.inclinePct() != 0) {
            return s.inclinePct() > 0 ? "UP" : "DOWN";
        }
        if ("up".equals(s.inclineHint())) {
            return "UP";
        }
        if ("down".equals(s.inclineHint())) {
            return "DOWN";
        }
        return "UNKNOWN";
    }

    private static Integer sumSteps(Leg leg) {
        int sum = 0;
        for (Segment s : leg.segments) {
            if (s.stepCount() == null) {
                return null;
            }
            sum += s.stepCount();
        }
        return sum;
    }

    static double roundDistance(double d) {
        if (d < 100) {
            return Math.round(d / 5.0) * 5.0;
        }
        return Math.round(d / 10.0) * 10.0;
    }

    private static List<String> notes(Leg leg) {
        Set<String> notes = new LinkedHashSet<>();
        double total = Math.max(leg.length(), 1);
        double rough = 0, carriageway = 0, unknownSidewalk = 0, unknownSurface = 0;
        for (Segment s : leg.segments) {
            if (s.rough()) {
                rough += s.lengthM();
            }
            if (s.onCarriageway()) {
                carriageway += s.lengthM();
            }
            if (s.sidewalkUnknown()) {
                unknownSidewalk += s.lengthM();
            }
            if ("UNKNOWN".equals(s.surfaceClass())) {
                unknownSurface += s.lengthM();
            }
            if (s.inclinePct() != null && !s.stairs()) {
                double abs = Math.abs(s.inclinePct());
                if ("OSM".equals(s.inclineSource()) && abs >= 6) {
                    notes.add("STEEP");
                } else if ("DEM".equals(s.inclineSource()) && abs >= 8 && s.lengthM() >= 15) {
                    notes.add("STEEP_ESTIMATED");
                }
            }
            if (s.barrier() != null) {
                notes.add("BARRIER");
            }
            if (s.widthM() != null && !Boolean.TRUE.equals(s.widthEstimated()) && s.widthM() < 1.2) {
                notes.add("NARROW");
            }
            if ("limited".equals(s.wheelchair())) {
                notes.add("WHEELCHAIR_LIMITED");
            }
        }
        if (rough >= 15 || rough / total > 0.3) {
            notes.add("ROUGH_SURFACE");
        }
        if (carriageway >= 10) {
            notes.add("WALK_ON_CARRIAGEWAY");
        } else if (unknownSidewalk >= 30) {
            notes.add("SIDEWALK_UNKNOWN");
        }
        if (unknownSurface / total > 0.5 && leg.kind == LegKind.WALK && leg.length() >= 30) {
            notes.add("SURFACE_UNKNOWN");
        }
        return List.copyOf(notes);
    }
}
