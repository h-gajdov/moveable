package mk.accessibleskopje.routing;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;

import mk.accessibleskopje.common.Geo;
import mk.accessibleskopje.routing.RouteApi.Coverage;
import mk.accessibleskopje.routing.RouteApi.CrossingDetails;
import mk.accessibleskopje.routing.RouteApi.Indicator;
import mk.accessibleskopje.routing.RouteApi.RouteSummary;
import mk.accessibleskopje.routing.RouteApi.SteepSection;
import mk.accessibleskopje.routing.RouteApi.Suitability;
import mk.accessibleskopje.routing.RouteApi.Warning;

/**
 * Derives what is known — and, just as importantly, what is NOT known — about a
 * route. The suitability level never claims "accessible" or "safe"; the best
 * possible level is {@code NO_KNOWN_ISSUES}, which still depends on data quality.
 */
public final class RouteAnalyzer {

    static final double STEEP_MAPPED_PCT = 6.0;
    static final double STEEP_ESTIMATED_PCT = 8.0;
    static final double NARROW_M = 1.2;

    private RouteAnalyzer() {
    }

    public static RouteSummary summarize(List<Segment> segs, int benches) {
        List<Crossings.Crossing> crossings = Crossings.extract(segs);
        Set<Long> stairWays = new HashSet<>();
        Set<Long> stairWaysWithHandrail = new HashSet<>();
        Set<Long> raisedKerbEdges = new HashSet<>();
        double rough = 0, unknownSurface = 0, carriageway = 0, unknownSidewalk = 0, unlit = 0, unknownLit = 0, narrow = 0;
        Map<String, Double> byClass = new LinkedHashMap<>();
        for (Segment s : segs) {
            byClass.merge(s.pathClass(), s.lengthM(), Double::sum);
            if (s.stairs()) {
                stairWays.add(s.osmWayId());
                if (Boolean.TRUE.equals(s.handrail())) {
                    stairWaysWithHandrail.add(s.osmWayId());
                }
            }
            if (raisedKerb(s)) {
                raisedKerbEdges.add(s.edgeId());
            }
            if (s.rough()) {
                rough += s.lengthM();
            }
            if (s.surfaceClass() == null || "UNKNOWN".equals(s.surfaceClass())) {
                unknownSurface += s.lengthM();
            }
            if (s.onCarriageway()) {
                carriageway += s.lengthM();
            }
            if (s.sidewalkUnknown()) {
                unknownSidewalk += s.lengthM();
            }
            if (Boolean.FALSE.equals(s.lit())) {
                unlit += s.lengthM();
            } else if (s.lit() == null) {
                unknownLit += s.lengthM();
            }
            if (narrow(s)) {
                narrow += s.lengthM();
            }
        }
        int withSignals = 0, withSound = 0, withTactile = 0, unmarked = 0, kerbUnknown = 0;
        for (Crossings.Crossing c : crossings) {
            var d = c.details();
            if (Boolean.TRUE.equals(d.signals())) {
                withSignals++;
            }
            if (Boolean.TRUE.equals(d.sound())) {
                withSound++;
            }
            if (Boolean.TRUE.equals(d.tactilePaving())) {
                withTactile++;
            }
            if ("UNMARKED".equals(d.type()) || "INFORMAL".equals(d.type())) {
                unmarked++;
            }
            if (d.kerb() == null || "yes".equals(d.kerb())) {
                kerbUnknown++;
            }
        }
        byClass.replaceAll((k, v) -> Geo.round(v, 1));
        return new RouteSummary(stairWays.size(), stairWaysWithHandrail.size(), crossings.size(), withSignals,
                withSound, withTactile, unmarked, kerbUnknown, raisedKerbEdges.size(), steepSections(segs),
                Geo.round(rough, 1), Geo.round(unknownSurface, 1), Geo.round(carriageway, 1),
                Geo.round(unknownSidewalk, 1), Geo.round(unlit, 1), Geo.round(unknownLit, 1), Geo.round(narrow, 1),
                benches, byClass);
    }

    static List<SteepSection> steepSections(List<Segment> segs) {
        List<SteepSection> out = new ArrayList<>();
        double len = 0, max = 0;
        boolean mapped = false;
        double[] start = null;
        for (Segment s : segs) {
            boolean steep = !s.stairs() && s.inclinePct() != null && (
                    ("OSM".equals(s.inclineSource()) && Math.abs(s.inclinePct()) >= STEEP_MAPPED_PCT)
                            || ("DEM".equals(s.inclineSource()) && Math.abs(s.inclinePct()) >= STEEP_ESTIMATED_PCT));
            if (steep) {
                if (start == null && !s.coords().isEmpty()) {
                    start = s.coords().get(0);
                }
                len += s.lengthM();
                max = Math.max(max, Math.abs(s.inclinePct()));
                mapped |= "OSM".equals(s.inclineSource());
            } else if (len > 0) {
                addSteep(out, len, max, mapped, start);
                len = 0;
                max = 0;
                mapped = false;
                start = null;
            }
        }
        addSteep(out, len, max, mapped, start);
        return out;
    }

    private static void addSteep(List<SteepSection> out, double len, double max, boolean mapped, double[] start) {
        // Short estimated sections are mostly elevation-model noise.
        if (len >= (mapped ? 5 : 25)) {
            out.add(new SteepSection(Geo.round(len, 1), Geo.round(max, 1), mapped ? "MAPPED" : "ESTIMATED", start));
        }
    }

    public static Coverage coverage(List<Segment> segs, RouteSummary summary) {
        double total = 0, weighted = 0, surface = 0, widthKnown = 0, widthRelevant = 0, mapped = 0, estimated = 0, lit = 0;
        for (Segment s : segs) {
            double l = s.lengthM();
            total += l;
            weighted += s.completeness() * l;
            if (s.surfaceClass() != null && !"UNKNOWN".equals(s.surfaceClass())) {
                surface += l;
            }
            if (!s.pathClass().startsWith("ROAD") && !"SERVICE".equals(s.pathClass())) {
                widthRelevant += l;
                if (s.widthM() != null) {
                    widthKnown += l;
                }
            }
            if (s.stairs() || "OSM".equals(s.inclineSource())) {
                mapped += l;
            } else if ("DEM".equals(s.inclineSource())) {
                estimated += l;
            }
            if (s.lit() != null) {
                lit += l;
            }
        }
        List<Crossings.Crossing> crossings = Crossings.extract(segs);
        long complete = crossings.stream().filter(c -> c.details().type() != null && c.details().kerb() != null
                && c.details().tactilePaving() != null).count();
        double t = Math.max(total, 1e-9);
        double score = Geo.round(weighted / t, 3);
        String level = score >= 0.6 ? "GOOD" : score >= 0.3 ? "PARTIAL" : "LOW";
        return new Coverage(score, level, pct(surface, t), widthRelevant == 0 ? 100 : pct(widthKnown, widthRelevant),
                pct(mapped, t), pct(estimated, t), pct(lit, t),
                crossings.isEmpty() ? 100 : pct(complete, crossings.size()));
    }

    private static double pct(double part, double whole) {
        return Geo.round(100.0 * part / whole, 1);
    }

    public static List<Warning> warnings(List<Segment> segs, RouteSummary s, Coverage c, RoutingPreferences p) {
        List<Warning> w = new ArrayList<>();
        double total = segs.stream().mapToDouble(Segment::lengthM).sum();
        List<Crossings.Crossing> crossings = Crossings.extract(segs);
        if (s.stairs() > 0) {
            w.add(new Warning("STAIRS_ON_ROUTE", p.is(p.avoidStairs()) || p.isWheeled() ? "WARNING" : "INFO",
                    s.stairs(), null, runStarts(segs, Segment::stairs)));
        }
        if (s.raisedKerbs() > 0) {
            w.add(new Warning("RAISED_KERB", p.isWheeled() ? "WARNING" : "INFO", s.raisedKerbs(), null,
                    runStarts(segs, RouteAnalyzer::raisedKerb)));
        }
        for (SteepSection st : s.steepSections()) {
            w.add(new Warning("MAPPED".equals(st.source()) ? "STEEP_SECTION" : "STEEP_SECTION_ESTIMATED",
                    p.maxInclinePct() != null && st.maxPct() > p.maxInclinePct() ? "WARNING" : "CAUTION",
                    null, st.lengthM(), st.location()));
        }
        if (s.carriagewayM() > 0) {
            w.add(new Warning("WALK_ON_CARRIAGEWAY", "WARNING", null, s.carriagewayM(),
                    runStarts(segs, Segment::onCarriageway)));
        }
        if (s.unknownSidewalkM() >= 50) {
            w.add(new Warning("SIDEWALK_UNKNOWN", "CAUTION", null, s.unknownSidewalkM(),
                    runStarts(segs, Segment::sidewalkUnknown)));
        }
        if (s.roughSurfaceM() > 0) {
            w.add(new Warning("ROUGH_SURFACE", p.isWheeled() || p.is(p.avoidRoughSurfaces()) ? "WARNING" : "INFO",
                    null, s.roughSurfaceM(), runStarts(segs, Segment::rough)));
        }
        if (total > 0 && s.unknownSurfaceM() / total > 0.2) {
            // Spread over much of the route, so it gets no flags of its own.
            w.add(new Warning("SURFACE_UNKNOWN", "CAUTION", null, s.unknownSurfaceM(), List.of()));
        }
        int noSignals = s.crossings() - s.crossingsWithSignals();
        if (noSignals > 0) {
            w.add(new Warning("CROSSING_WITHOUT_SIGNALS", p.isVisualGuidance() ? "WARNING" : "INFO", noSignals,
                    null, crossingsWhere(crossings, d -> !Boolean.TRUE.equals(d.signals()))));
        }
        if (p.isVisualGuidance()) {
            var soundUnknown = crossingsWhere(crossings,
                    d -> Boolean.TRUE.equals(d.signals()) && d.sound() == null);
            if (!soundUnknown.isEmpty()) {
                w.add(new Warning("CROSSING_SOUND_UNKNOWN", "CAUTION", soundUnknown.size(), null, soundUnknown));
            }
            int tactileMissing = s.crossings() - s.crossingsWithTactile();
            if (tactileMissing > 0) {
                w.add(new Warning("CROSSING_TACTILE_NOT_MAPPED", "CAUTION", tactileMissing, null,
                        crossingsWhere(crossings, d -> !Boolean.TRUE.equals(d.tactilePaving()))));
            }
        }
        if (p.isWheeled() && s.crossingsKerbUnknown() > 0) {
            w.add(new Warning("CROSSING_KERB_UNKNOWN", "CAUTION", s.crossingsKerbUnknown(), null,
                    crossingsWhere(crossings, d -> d.kerb() == null || "yes".equals(d.kerb()))));
        }
        long barriers = segs.stream().filter(x -> x.barrier() != null).map(Segment::edgeId).distinct().count();
        if (barriers > 0) {
            w.add(new Warning("BARRIER_ON_ROUTE", "CAUTION", (int) barriers, null,
                    runStarts(segs, x -> x.barrier() != null)));
        }
        if (s.narrowM() > 0) {
            w.add(new Warning("NARROW_PATH", p.isWheeled() ? "WARNING" : "INFO", null, s.narrowM(),
                    runStarts(segs, RouteAnalyzer::narrow)));
        }
        if (p.isWheeled() && segs.stream().anyMatch(x -> "limited".equals(x.wheelchair()))) {
            w.add(new Warning("WHEELCHAIR_LIMITED", "CAUTION", null, null,
                    runStarts(segs, x -> "limited".equals(x.wheelchair()))));
        }
        if (s.unlitM() >= 100) {
            w.add(new Warning("UNLIT_SECTION", p.is(p.preferLitPaths()) ? "CAUTION" : "INFO", null, s.unlitM(),
                    runStarts(segs, x -> Boolean.FALSE.equals(x.lit()))));
        }
        if ("LOW".equals(c.level())) {
            w.add(new Warning("LOW_DATA_COVERAGE", "WARNING", null, null, List.of()));
        }
        return w;
    }

    static boolean raisedKerb(Segment s) {
        return "raised".equals(s.kerbType()) || (s.kerbHeightCm() != null && s.kerbHeightCm() > 3);
    }

    static boolean narrow(Segment s) {
        return s.widthM() != null && !Boolean.TRUE.equals(s.widthEstimated()) && s.widthM() < NARROW_M;
    }

    /** Where each stretch of consecutive matching segments begins, in route order. */
    static List<double[]> runStarts(List<Segment> segs, Predicate<Segment> pred) {
        List<double[]> out = new ArrayList<>();
        boolean inRun = false;
        for (Segment x : segs) {
            boolean match = pred.test(x);
            if (match && !inRun && !x.coords().isEmpty()) {
                out.add(x.coords().get(0));
            }
            inRun = match;
        }
        return out;
    }

    private static List<double[]> crossingsWhere(List<Crossings.Crossing> crossings, Predicate<CrossingDetails> pred) {
        return crossings.stream().filter(x -> pred.test(x.details()) && x.location() != null)
                .map(Crossings.Crossing::location).toList();
    }

    public static Suitability suitability(RouteSummary s, Coverage c, RoutingPreferences p) {
        List<Indicator> ind = new ArrayList<>();
        if (p.is(p.avoidStairs()) || p.isWheeled()) {
            ind.add(new Indicator("STEP_FREE", s.stairs() > 0 ? "PROBLEM" : "OK", null));
        }
        if (p.isWheeled()) {
            ind.add(new Indicator("KERBS", s.raisedKerbs() > 0 ? "PROBLEM"
                    : s.crossingsKerbUnknown() > 0 ? "UNKNOWN" : "OK", null));
        }
        if (p.maxInclinePct() != null) {
            boolean estimatedOver = s.steepSections().stream()
                    .anyMatch(x -> x.maxPct() > p.maxInclinePct());
            ind.add(new Indicator("SLOPE", estimatedOver ? "UNKNOWN" : c.mappedInclinePct() >= 50 ? "OK" : "UNKNOWN",
                    estimatedOver ? "ESTIMATED_OVER_LIMIT" : null));
        }
        if (p.minWidthM() != null) {
            ind.add(new Indicator("WIDTH", s.narrowM() > 0 ? "PROBLEM" : c.knownWidthPct() >= 50 ? "OK" : "UNKNOWN",
                    null));
        }
        if (p.is(p.avoidRoughSurfaces()) || p.isWheeled()) {
            ind.add(new Indicator("SURFACE", s.roughSurfaceM() > 0 ? "PROBLEM"
                    : c.knownSurfacePct() >= 80 ? "OK" : "UNKNOWN", null));
        }
        if (p.isVisualGuidance() || p.is(p.preferAccessibleCrossings())) {
            String st;
            if (s.crossings() == 0) {
                st = "OK";
            } else if (s.crossingsWithSignals() < s.crossings()) {
                st = "PROBLEM";
            } else if (p.isVisualGuidance() && s.crossingsWithSound() < s.crossings()) {
                st = "UNKNOWN";
            } else {
                st = "OK";
            }
            ind.add(new Indicator("CROSSINGS", st, null));
        }
        if (p.isVisualGuidance() || p.is(p.minimizeTrafficExposure())) {
            ind.add(new Indicator("TRAFFIC_SEPARATION", s.carriagewayM() > 0 ? "PROBLEM"
                    : s.unknownSidewalkM() >= 50 ? "UNKNOWN" : "OK", null));
        }
        if (p.is(p.preferRestingSpots())) {
            ind.add(new Indicator("RESTING_SPOTS", s.benchesNearRoute() > 0 ? "OK" : "UNKNOWN", null));
        }
        if (p.is(p.preferLitPaths())) {
            ind.add(new Indicator("LIGHTING", s.unlitM() > 0 ? "PROBLEM" : c.knownLitPct() >= 80 ? "OK" : "UNKNOWN",
                    null));
        }
        boolean problem = ind.stream().anyMatch(i -> "PROBLEM".equals(i.status()));
        boolean unknown = ind.stream().anyMatch(i -> "UNKNOWN".equals(i.status())) || "LOW".equals(c.level());
        String level = problem ? "HAS_KNOWN_ISSUES" : unknown ? "PARTLY_UNKNOWN" : "NO_KNOWN_ISSUES";
        return new Suitability(level, ind);
    }
}
