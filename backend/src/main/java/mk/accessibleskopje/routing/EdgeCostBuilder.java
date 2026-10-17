package mk.accessibleskopje.routing;

import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.StringJoiner;

import mk.accessibleskopje.config.RoutingProperties;
import mk.accessibleskopje.config.RoutingProperties.Weights;

/**
 * Translates routing preferences into SQL for pgRouting's edge query.
 *
 * <p><b>Hard constraints</b> become {@code WHERE} conditions: the edge does not
 * exist for this user. <b>Soft constraints</b> become cost terms. Only values
 * built from validated numbers and enum-like constants are concatenated into
 * the SQL; no user-supplied text ever reaches it.
 *
 * <p>Missing data is never treated as accessible: hard constraints only exclude
 * edges whose data proves them unsuitable, while unknown values add an
 * uncertainty penalty and are reported to the user.
 */
public final class EdgeCostBuilder {

    public enum Mode {
        /** The profile's full cost model. */
        RECOMMENDED,
        /** Shortest distance that still satisfies all hard constraints. */
        SHORTEST_SUITABLE,
        /** Recommended cost with a much stronger preference for well-mapped edges. */
        BEST_COVERAGE,
        /** Plain walking network (only legal/safety constraints); used for comparison and diagnosis. */
        BASELINE
    }

    static final String ROAD_CLASSES = "'ROAD_WITH_SIDEWALK','ROAD_SIDEWALK_SEPARATE','ROAD_NO_SIDEWALK',"
            + "'ROAD_SIDEWALK_UNKNOWN','SERVICE'";

    private final RoutingPreferences p;
    private final Weights w;
    private final Mode mode;
    private final Set<Long> excludedEdges;
    private final Map<Long, Double> edgePenalties;

    public EdgeCostBuilder(RoutingPreferences prefs, RoutingProperties props, Mode mode,
                           Set<Long> excludedEdges, Map<Long, Double> edgePenalties) {
        this.p = prefs;
        this.w = props.weights();
        this.mode = mode;
        this.excludedEdges = mode == Mode.BASELINE ? Set.of() : excludedEdges;
        this.edgePenalties = mode == Mode.BASELINE || mode == Mode.SHORTEST_SUITABLE ? Map.of() : edgePenalties;
    }

    static String num(double v) {
        if (!Double.isFinite(v)) {
            throw new IllegalArgumentException("non-finite weight");
        }
        return String.format(Locale.ROOT, "%.4f", v);
    }

    /** Conditions that remove edges from the graph (alias {@code e} = routing_edge, {@code a} = edge_accessibility). */
    public String hardConstraints() {
        StringJoiner sql = new StringJoiner(" AND ");
        // Always: legally/physically impossible passages.
        sql.add("a.crossing_forbidden = false");
        sql.add("a.barrier_effect IS DISTINCT FROM 'ALL'");
        if (mode == Mode.BASELINE) {
            return sql.toString();
        }
        if (p.is(p.avoidStairs()) || p.isWheeled()) {
            // Stairs with a documented wheelchair ramp remain usable.
            sql.add(excludeIf("a.is_stairs AND a.ramp_wheelchair IS NOT TRUE"));
        }
        if (p.isWheeled()) {
            double kerb = p.effectiveMaxKerbCm();
            sql.add("a.barrier_effect IS DISTINCT FROM 'WHEELCHAIR'");
            sql.add("a.wheelchair IS DISTINCT FROM 'no'");
            sql.add("a.surface_class <> 'IMPASSABLE'");
            sql.add(excludeIf("a.kerb_height_cm > " + num(kerb)));
            if (kerb < 10) {
                // kerb=raised without a measured height: documented as too high for most wheel users.
                sql.add(excludeIf("a.kerb_height_cm IS NULL AND a.kerb_type = 'raised'"));
            }
        }
        if (p.minWidthM() != null) {
            sql.add(excludeIf("a.width_estimated IS NOT TRUE AND a.width_m < " + num(p.minWidthM())));
        }
        if (p.maxInclinePct() != null) {
            // Only mapped (OSM) inclines are reliable enough to exclude an edge.
            sql.add(excludeIf("a.incline_source = 'OSM' AND abs(a.incline_pct) > " + num(p.maxInclinePct())));
        }
        if (!excludedEdges.isEmpty()) {
            StringJoiner ids = new StringJoiner(",");
            excludedEdges.forEach(id -> ids.add(Long.toString(id)));
            sql.add("e.id NOT IN (" + ids + ")");
        }
        return sql.toString();
    }

    /**
     * Exclude an edge only when the condition is provably TRUE. SQL comparisons with
     * unknown (NULL) values yield NULL, and a bare {@code NOT (...)} would then drop
     * the edge, wrongly treating "unknown" as "unsuitable".
     */
    static String excludeIf(String condition) {
        return "(" + condition + ") IS NOT TRUE";
    }

    /** Optional join that adds obstacle penalties (alias {@code o}). */
    public String obstacleJoin() {
        if (edgePenalties.isEmpty()) {
            return "";
        }
        StringJoiner values = new StringJoiner(",");
        edgePenalties.forEach((id, pen) -> values.add("(" + id + "::bigint," + num(pen) + "::float8)"));
        return " LEFT JOIN (VALUES " + values + ") o(edge_id, penalty) ON o.edge_id = e.id";
    }

    public String costExpression() {
        if (mode == Mode.SHORTEST_SUITABLE || mode == Mode.BASELINE) {
            return "e.length_m";
        }
        double scale = p.is(p.minimizeDistance()) ? w.minimizeDistanceScale() : 1.0;
        String factors = String.join(" + ",
                surfaceTerm(), slopeTerm(), trafficTerm(), pedestrianTerm(), uncertaintyTerm(),
                litTerm(), restTerm(), limitedTerm());
        String fixed = String.join(" + ", crossingTerm(), intersectionTerm(), stairsTerm());
        String obstacles = edgePenalties.isEmpty() ? "0" : "COALESCE(o.penalty, 0)";
        return "(e.length_m * (1 + " + num(scale) + " * (" + factors + ")) + " + num(scale) + " * (" + fixed
                + ") + " + obstacles + ")";
    }

    /** Full edge SQL for pgRouting, limited to an envelope. */
    public String edgesSql(String regionCode, double minLon, double minLat, double maxLon, double maxLat) {
        if (!regionCode.matches("[a-z_]{1,40}")) {
            throw new IllegalArgumentException("invalid region code");
        }
        return "SELECT e.id, e.source, e.target, " + costExpression() + " AS cost"
                + " FROM routing_edge e JOIN edge_accessibility a ON a.edge_id = e.id" + obstacleJoin()
                + " WHERE e.region_code = '" + regionCode + "'"
                + " AND e.geom && ST_MakeEnvelope(" + num(minLon) + "," + num(minLat) + "," + num(maxLon) + ","
                + num(maxLat) + ", 4326)"
                + " AND " + hardConstraints();
    }

    // -- soft terms (dimensionless multipliers of length) ---------------------------------

    private String surfaceTerm() {
        var s = w.surface();
        if (p.is(p.avoidRoughSurfaces()) || p.isWheeled()) {
            double m = p.isWheeled() ? s.wheeledMultiplier() : 1.0;
            return "(CASE a.surface_class WHEN 'INTERMEDIATE' THEN " + num(s.intermediate() * m)
                    + " WHEN 'ROUGH' THEN " + num(s.rough() * m)
                    + " WHEN 'VERY_ROUGH' THEN " + num(s.veryRough() * m)
                    + " WHEN 'IMPASSABLE' THEN " + num(s.impassable() * m)
                    + " WHEN 'UNKNOWN' THEN " + num(s.unknown() * m) + " ELSE 0 END)";
        }
        return "(CASE a.surface_class WHEN 'VERY_ROUGH' THEN " + num(s.rough() * 0.4)
                + " WHEN 'IMPASSABLE' THEN " + num(s.veryRough() * 0.5) + " ELSE 0 END)";
    }

    private String slopeTerm() {
        var s = w.slope();
        boolean limited = p.maxInclinePct() != null;
        double perPct = limited ? s.perPct() : s.perPct() * 0.25;
        double comfortable = limited ? Math.min(s.comfortablePct(), p.maxInclinePct()) : 6.0;
        String base = "(CASE WHEN a.incline_pct IS NULL THEN 0 ELSE GREATEST(0, abs(a.incline_pct) - "
                + num(comfortable) + ") * " + num(perPct)
                + " * (CASE WHEN a.incline_source = 'DEM' THEN " + num(s.estimatedWeight()) + " ELSE 1 END) END)";
        if (!limited) {
            return base;
        }
        return "(" + base
                + " + (CASE WHEN a.incline_source = 'DEM' AND abs(a.incline_pct) > " + num(p.maxInclinePct())
                + " THEN " + num(s.overLimitEstimated()) + " ELSE 0 END)"
                + " + (CASE WHEN a.incline_hint IS NOT NULL AND a.incline_source IS DISTINCT FROM 'OSM' THEN "
                + num(s.hintPenalty()) + " ELSE 0 END))";
    }

    private String trafficTerm() {
        var t = w.traffic();
        boolean minimize = p.is(p.minimizeTrafficExposure()) || p.isVisualGuidance();
        double perLevel = minimize ? t.minimizePerExposureLevel() : t.perExposureLevel();
        return "(a.traffic_exposure * " + num(perLevel)
                + " + (CASE WHEN e.path_class = 'ROAD_SIDEWALK_SEPARATE' THEN "
                + num(t.carriagewayWithSeparateSidewalk()) + " ELSE 0 END))";
    }

    private String pedestrianTerm() {
        if (!p.is(p.preferPedestrianAreas())) {
            return "0";
        }
        var pp = w.pedestrianPreference();
        return "(CASE WHEN e.path_class IN (" + ROAD_CLASSES + ") THEN " + num(pp.roadPenalty())
                + " WHEN e.path_class = 'TRACK' THEN " + num(pp.trackPenalty()) + " ELSE 0 END)";
    }

    private boolean hasAccessibilityNeeds() {
        return p.isWheeled() || p.isVisualGuidance() || p.is(p.avoidStairs()) || p.maxInclinePct() != null
                || p.minWidthM() != null || p.is(p.avoidRoughSurfaces());
    }

    private String uncertaintyTerm() {
        var u = w.uncertainty();
        double weight = mode == Mode.BEST_COVERAGE ? u.coverageAlternative()
                : hasAccessibilityNeeds() ? u.profile() : u.base();
        return "((1 - a.completeness) * " + num(weight) + ")";
    }

    private String litTerm() {
        return p.is(p.preferLitPaths())
                ? "(CASE WHEN a.lit IS TRUE THEN 0 ELSE " + num(w.lit().unlitOrUnknown()) + " END)" : "0";
    }

    private String restTerm() {
        return p.is(p.preferRestingSpots())
                ? "(CASE WHEN a.bench_nearby THEN 0 ELSE " + num(w.rest().noBench()) + " END)" : "0";
    }

    private String limitedTerm() {
        return p.isWheeled()
                ? "(CASE WHEN a.wheelchair = 'limited' THEN " + num(w.wheelchairLimited()) + " ELSE 0 END)" : "0";
    }

    // -- fixed terms (metre equivalents) ------------------------------------------------

    private String crossingTerm() {
        var c = w.crossing();
        StringBuilder sb = new StringBuilder("(CASE WHEN a.is_crossing OR a.crossing_via_node THEN ((CASE a.crossing_type")
                .append(" WHEN 'SIGNALS' THEN ").append(num(c.signals()))
                .append(" WHEN 'MARKED' THEN ").append(num(c.marked()))
                .append(" WHEN 'UNMARKED' THEN ").append(num(c.unmarked()))
                .append(" WHEN 'INFORMAL' THEN ").append(num(c.informal()))
                .append(" ELSE ").append(num(c.unknown())).append(" END)");
        if (p.isVisualGuidance() && p.is(p.preferAccessibleCrossings())) {
            sb.append(" + (CASE WHEN a.crossing_signals IS TRUE AND a.crossing_sound IS NOT TRUE THEN ")
                    .append(num(c.accessibleMissingSound())).append(" ELSE 0 END)")
                    .append(" + (CASE WHEN a.crossing_signals IS NOT TRUE THEN ")
                    .append(num(c.accessibleMissingSound())).append(" ELSE 0 END)")
                    .append(" + (CASE WHEN a.tactile_paving IS NOT TRUE THEN ")
                    .append(num(c.accessibleMissingTactile())).append(" ELSE 0 END)");
        } else if (p.is(p.preferAccessibleCrossings())) {
            sb.append(" + (CASE WHEN a.crossing_signals IS NOT TRUE THEN ")
                    .append(num(c.marked())).append(" ELSE 0 END)");
        }
        if (p.isWheeled()) {
            sb.append(" + (CASE WHEN a.kerb_type IS NULL OR a.kerb_type = 'yes' THEN ")
                    .append(num(c.wheeledUnknownKerb())).append(" ELSE 0 END)");
        }
        sb.append(") * (CASE WHEN a.is_crossing THEN 1 ELSE ").append(num(c.viaNodeShare()))
                .append(" END) ELSE 0 END)");
        return sb.toString();
    }

    private String intersectionTerm() {
        if (!p.is(p.preferSimpleIntersections())) {
            return "0";
        }
        return "(GREATEST(0, a.max_node_degree - 3) * " + num(w.intersections().perExtraBranch()) + ")";
    }

    private String stairsTerm() {
        return "(CASE WHEN a.is_stairs THEN " + num(w.stairs().penalty()) + " ELSE 0 END)";
    }
}
