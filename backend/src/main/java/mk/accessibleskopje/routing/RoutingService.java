package mk.accessibleskopje.routing;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.StringJoiner;
import java.util.function.Predicate;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import mk.accessibleskopje.common.ApiException;
import mk.accessibleskopje.common.Geo;
import mk.accessibleskopje.common.RegionService;
import mk.accessibleskopje.config.RoutingProperties;
import mk.accessibleskopje.obstacles.ObstacleCategory;
import mk.accessibleskopje.obstacles.ObstacleImpact;
import mk.accessibleskopje.routing.EdgeCostBuilder.Mode;
import mk.accessibleskopje.routing.RouteApi.BlockingFeature;
import mk.accessibleskopje.routing.RouteApi.DataNotice;
import mk.accessibleskopje.routing.RouteApi.Explanation;
import mk.accessibleskopje.routing.RouteApi.LineGeometry;
import mk.accessibleskopje.routing.RouteApi.NearbyObstacle;
import mk.accessibleskopje.routing.RouteApi.NoRoute;
import mk.accessibleskopje.routing.RouteApi.RouteOption;
import mk.accessibleskopje.routing.RouteApi.RouteRequest;
import mk.accessibleskopje.routing.RouteApi.RouteResponse;
import mk.accessibleskopje.routing.RouteApi.RouteSummary;
import mk.accessibleskopje.routing.RouteApi.SnappedPoint;
import mk.accessibleskopje.routing.RouteApi.Warning;
import mk.accessibleskopje.routing.RouteRepository.Piece;
import mk.accessibleskopje.routing.RouteRepository.Snap;

/**
 * Accessibility-aware route calculation on the pgRouting graph.
 *
 * <p>If no route satisfies the user's hard constraints we do NOT silently relax
 * them: we return no route plus a diagnosis of what blocks the way.
 */
@Service
public class RoutingService {

    private static final Logger log = LoggerFactory.getLogger(RoutingService.class);

    private final RouteRepository repo;
    private final ProfileService profiles;
    private final RegionService regions;
    private final RoutingProperties props;
    private final JdbcTemplate jdbc;

    public RoutingService(RouteRepository repo, ProfileService profiles, RegionService regions,
                          RoutingProperties props, JdbcTemplate jdbc) {
        this.repo = repo;
        this.profiles = profiles;
        this.regions = regions;
        this.props = props;
        this.jdbc = jdbc;
    }

    record Envelope(double minLon, double minLat, double maxLon, double maxLat) {
    }

    /** A computed path: ordered pieces plus the snaps it connects. */
    record Path(List<Piece> pieces, double cost) {
    }

    record ObstacleEffects(Set<Long> excluded, Map<Long, Double> penalties, Map<Long, String> edgeToObstacle) {
    }

    public RouteResponse route(RouteRequest req) {
        var region = regions.current();
        double oLat = req.origin().lat(), oLon = req.origin().lon();
        double dLat = req.destination().lat(), dLon = req.destination().lon();
        if (!region.contains(oLat, oLon)) {
            throw ApiException.unprocessable("ORIGIN_OUTSIDE_REGION", "The starting point is outside the supported area.");
        }
        if (!region.contains(dLat, dLon)) {
            throw ApiException.unprocessable("DESTINATION_OUTSIDE_REGION",
                    "The destination is outside the supported area.");
        }
        double crow = Geo.distanceM(oLat, oLon, dLat, dLon);
        if (crow > props.maxRouteDistanceM()) {
            throw ApiException.unprocessable("ROUTE_TOO_LONG", "The two points are too far apart for a walking route.");
        }
        if (crow < 3) {
            throw ApiException.unprocessable("SAME_LOCATION", "The starting point and destination are the same.");
        }

        String profileCode = req.profile() == null ? "STANDARD" : req.profile();
        RoutingPreferences defaults = profiles.get(profileCode).defaults();
        RoutingPreferences prefs = (req.preferences() == null ? RoutingPreferences.empty() : req.preferences())
                .mergedOnto(defaults);

        Envelope env = envelope(oLat, oLon, dLat, dLon);
        ObstacleEffects effects = obstacleEffects(env, prefs);
        EdgeCostBuilder recommended = builder(prefs, Mode.RECOMMENDED, effects);
        EdgeCostBuilder baselineB = builder(prefs, Mode.BASELINE, effects);

        DataNotice notice = dataNotice();
        Optional<Snap> so = repo.snap(region.code(), oLat, oLon, recommended.hardConstraints(),
                props.maxSnapDistanceM(), props.minComponentSize());
        Optional<Snap> sd = repo.snap(region.code(), dLat, dLon, recommended.hardConstraints(),
                props.maxSnapDistanceM(), props.minComponentSize());
        if (so.isEmpty() || sd.isEmpty()) {
            String reason = so.isEmpty() ? snapFailure(region.code(), oLat, oLon, baselineB, "ORIGIN")
                    : snapFailure(region.code(), dLat, dLon, baselineB, "DESTINATION");
            return new RouteResponse(profileCode, prefs, so.map(s -> snapped(s, oLat, oLon)).orElse(null),
                    sd.map(s -> snapped(s, dLat, dLon)).orElse(null), List.of(),
                    new NoRoute(reason, List.of(), null), notice);
        }
        Snap o = so.get(), d = sd.get();
        SnappedPoint origin = snapped(o, oLat, oLon), destination = snapped(d, dLat, dLon);

        Path best = computePath(recommended, o, d, env);
        if (best == null) {
            return new RouteResponse(profileCode, prefs, origin, destination, List.of(),
                    diagnose(prefs, effects, baselineB, o, d, env), notice);
        }

        List<Mode> modes = Boolean.FALSE.equals(req.alternatives()) ? List.of(Mode.RECOMMENDED)
                : List.of(Mode.RECOMMENDED, Mode.SHORTEST_SUITABLE, Mode.BEST_COVERAGE);
        Path baseline = computePath(baselineB, o, d, env);
        List<Segment> baselineSegs = baseline == null ? null : repo.fetchSegments(baseline.pieces());
        RouteSummary baselineSummary = baselineSegs == null ? null : RouteAnalyzer.summarize(baselineSegs, 0);

        List<Built> built = new ArrayList<>();
        for (Mode mode : modes) {
            Path path = mode == Mode.RECOMMENDED ? best : computePath(builder(prefs, mode, effects), o, d, env);
            if (path == null) {
                continue;
            }
            List<Segment> segs = repo.fetchSegments(path.pieces());
            Built existing = built.stream().filter(b -> overlap(b.segments, segs) >= props.alternativesOverlapThreshold())
                    .findFirst().orElse(null);
            if (existing != null) {
                existing.kinds.add(mode.name());
                continue;
            }
            built.add(new Built(new ArrayList<>(List.of(mode.name())), segs));
        }

        List<RouteOption> options = new ArrayList<>();
        for (int i = 0; i < built.size(); i++) {
            options.add(toOption("r" + (i + 1), built.get(i), prefs, origin, destination, baselineSegs,
                    baselineSummary, effects));
        }
        return new RouteResponse(profileCode, prefs, origin, destination, options, null, notice);
    }

    private record Built(List<String> kinds, List<Segment> segments) {
    }

    private EdgeCostBuilder builder(RoutingPreferences p, Mode mode, ObstacleEffects fx) {
        return new EdgeCostBuilder(p, props, mode, fx.excluded(), fx.penalties());
    }

    private Envelope envelope(double oLat, double oLon, double dLat, double dLon) {
        double margin = Math.max(props.searchMarginDeg(),
                0.35 * Math.max(Math.abs(oLat - dLat), Math.abs(oLon - dLon)));
        return new Envelope(Math.min(oLon, dLon) - margin * 1.35, Math.min(oLat, dLat) - margin,
                Math.max(oLon, dLon) + margin * 1.35, Math.max(oLat, dLat) + margin);
    }

    private Envelope regionEnvelope() {
        var r = regions.current();
        return new Envelope(r.minLon(), r.minLat(), r.maxLon(), r.maxLat());
    }

    ObstacleEffects obstacleEffects(Envelope env, RoutingPreferences prefs) {
        Set<Long> excluded = new HashSet<>();
        Map<Long, Double> penalties = new HashMap<>();
        Map<Long, String> edgeToObstacle = new HashMap<>();
        var w = props.weights().obstacles();
        for (var hit : repo.activeObstacleEdges(env.minLon(), env.minLat(), env.maxLon(), env.maxLat(),
                props.obstacleBufferM())) {
            ObstacleCategory cat;
            ObstacleImpact reported;
            try {
                cat = ObstacleCategory.valueOf(hit.category());
                reported = ObstacleImpact.valueOf(hit.impact());
            } catch (IllegalArgumentException e) {
                continue;
            }
            ObstacleImpact eff = cat.effectiveImpact(reported, prefs);
            if (eff == null) {
                continue;
            }
            edgeToObstacle.put(hit.edgeId(), hit.id());
            switch (eff) {
                case IMPASSABLE -> excluded.add(hit.edgeId());
                case DIFFICULT -> penalties.merge(hit.edgeId(), w.difficult(), Math::max);
                case MINOR -> penalties.merge(hit.edgeId(), w.minor(), Math::max);
            }
        }
        return new ObstacleEffects(excluded, penalties, edgeToObstacle);
    }

    /** Shortest path under {@code b} between two snapped points; tries the local envelope, then the region. */
    Path computePath(EdgeCostBuilder b, Snap o, Snap d, Envelope env) {
        Path p = computePathIn(b, o, d, env);
        if (p == null) {
            p = computePathIn(b, o, d, regionEnvelope());
        }
        return p;
    }

    private Path computePathIn(EdgeCostBuilder b, Snap o, Snap d, Envelope env) {
        Double co = repo.edgeCost(b, o.edgeId());
        Double cd = repo.edgeCost(b, d.edgeId());
        if (co == null || cd == null) {
            return null;
        }
        if (o.edgeId() == d.edgeId()) {
            return new Path(List.of(new Piece(o.edgeId(), o.fraction(), d.fraction())),
                    Math.abs(o.fraction() - d.fraction()) * co);
        }
        long[] starts = {o.source(), o.target()};
        long[] ends = {d.source(), d.target()};
        String sql = b.edgesSql(regions.current().code(), env.minLon(), env.minLat(), env.maxLon(), env.maxLat());
        Map<String, List<RouteRepository.PathStep>> paths = repo.dijkstra(sql, starts, ends);

        double bestCost = Double.POSITIVE_INFINITY;
        long bestS = -1, bestT = -1;
        for (long s : starts) {
            for (long t : ends) {
                double startCost = (s == o.source() ? o.fraction() : 1 - o.fraction()) * co;
                double endCost = (t == d.source() ? d.fraction() : 1 - d.fraction()) * cd;
                double mid;
                if (s == t) {
                    mid = 0;
                } else {
                    var steps = paths.get(s + ":" + t);
                    if (steps == null || steps.isEmpty()) {
                        continue;
                    }
                    mid = steps.get(steps.size() - 1).aggCost();
                }
                double total = startCost + mid + endCost;
                if (total < bestCost) {
                    bestCost = total;
                    bestS = s;
                    bestT = t;
                }
            }
        }
        if (bestS < 0) {
            return null;
        }
        List<Piece> pieces = new ArrayList<>();
        pieces.add(new Piece(o.edgeId(), o.fraction(), bestS == o.source() ? 0 : 1));
        if (bestS != bestT) {
            var steps = paths.get(bestS + ":" + bestT);
            List<Long> edgeIds = steps.stream().map(RouteRepository.PathStep::edge).filter(e -> e > 0).toList();
            Map<Long, Long> sources = edgeSources(edgeIds);
            for (var st : steps) {
                if (st.edge() <= 0) {
                    continue;
                }
                boolean forward = sources.get(st.edge()) == st.node();
                pieces.add(new Piece(st.edge(), forward ? 0 : 1, forward ? 1 : 0));
            }
        }
        pieces.add(new Piece(d.edgeId(), bestT == d.source() ? 0 : 1, d.fraction()));
        pieces.removeIf(pc -> Math.abs(pc.f1() - pc.f0()) < 1e-9);
        return new Path(pieces, bestCost);
    }

    private Map<Long, Long> edgeSources(List<Long> ids) {
        Map<Long, Long> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        jdbc.query(con -> {
            var ps = con.prepareStatement("SELECT id, source FROM routing_edge WHERE id = ANY(?)");
            ps.setArray(1, con.createArrayOf("bigint", ids.toArray()));
            return ps;
        }, rs -> {
            out.put(rs.getLong("id"), rs.getLong("source"));
        });
        return out;
    }

    private static double overlap(List<Segment> a, List<Segment> b) {
        Map<Long, Double> la = new HashMap<>();
        a.forEach(s -> la.merge(s.edgeId(), s.lengthM(), Double::sum));
        double shared = 0;
        for (Segment s : b) {
            Double x = la.get(s.edgeId());
            if (x != null) {
                shared += Math.min(x, s.lengthM());
            }
        }
        double min = Math.min(a.stream().mapToDouble(Segment::lengthM).sum(),
                b.stream().mapToDouble(Segment::lengthM).sum());
        return min <= 0 ? 1 : shared / min;
    }

    private SnappedPoint snapped(Snap s, double lat, double lon) {
        return new SnappedPoint(Geo.round(s.lat(), 6), Geo.round(s.lon(), 6), lat, lon, Geo.round(s.distanceM(), 1),
                s.names());
    }

    private String snapFailure(String region, double lat, double lon, EdgeCostBuilder baseline, String which) {
        var any = repo.snap(region, lat, lon, baseline.hardConstraints(), props.maxSnapDistanceM(),
                props.minComponentSize());
        return any.isPresent() ? "NO_SUITABLE_PATH_NEAR_" + which : which + "_TOO_FAR_FROM_NETWORK";
    }

    private NoRoute diagnose(RoutingPreferences p, ObstacleEffects fx, EdgeCostBuilder baselineB, Snap o, Snap d,
                             Envelope env) {
        Path base = computePath(baselineB, o, d, env);
        if (base == null) {
            return new NoRoute("NOT_CONNECTED", List.of(), null);
        }
        List<Segment> segs = repo.fetchSegments(base.pieces());
        double len = segs.stream().mapToDouble(Segment::lengthM).sum();
        Map<String, Predicate<Segment>> rules = new LinkedHashMap<>();
        rules.put("STAIRS", s -> (p.is(p.avoidStairs()) || p.isWheeled()) && s.stairs()
                && !Boolean.TRUE.equals(s.rampWheelchair()));
        rules.put("HIGH_KERB", s -> p.isWheeled() && ((s.kerbHeightCm() != null && s.kerbHeightCm() > p.effectiveMaxKerbCm())
                || (s.kerbHeightCm() == null && "raised".equals(s.kerbType()) && p.effectiveMaxKerbCm() < 10)));
        rules.put("BARRIER", s -> p.isWheeled() && "WHEELCHAIR".equals(s.barrierEffect()));
        rules.put("NOT_WHEELCHAIR_ACCESSIBLE", s -> p.isWheeled() && "no".equals(s.wheelchair()));
        rules.put("IMPASSABLE_SURFACE", s -> p.isWheeled() && "IMPASSABLE".equals(s.surfaceClass()));
        rules.put("TOO_NARROW", s -> p.minWidthM() != null && s.widthM() != null
                && !Boolean.TRUE.equals(s.widthEstimated()) && s.widthM() < p.minWidthM());
        rules.put("TOO_STEEP", s -> p.maxInclinePct() != null && "OSM".equals(s.inclineSource())
                && s.inclinePct() != null && Math.abs(s.inclinePct()) > p.maxInclinePct());
        rules.put("REPORTED_OBSTACLE", s -> fx.excluded().contains(s.edgeId()));

        List<BlockingFeature> blocking = new ArrayList<>();
        rules.forEach((type, rule) -> {
            List<double[]> locs = segs.stream().filter(rule).filter(s -> !s.coords().isEmpty())
                    .map(s -> s.coords().get(0)).toList();
            if (!locs.isEmpty()) {
                blocking.add(new BlockingFeature(type, locs.size(), locs.subList(0, Math.min(5, locs.size()))));
            }
        });
        return new NoRoute("CONSTRAINTS_UNSATISFIABLE", blocking, Geo.round(len, 0));
    }

    private RouteOption toOption(String id, Built b, RoutingPreferences prefs, SnappedPoint origin,
                                 SnappedPoint destination, List<Segment> baselineSegs, RouteSummary baselineSummary,
                                 ObstacleEffects fx) {
        List<Segment> segs = b.segments();
        // Geometry covers only the mapped pedestrian network. The gap between a requested
        // point and the network is reported as snap distance, never drawn as a path.
        List<double[]> line = new ArrayList<>();
        for (Segment s : segs) {
            for (double[] c : s.coords()) {
                if (line.isEmpty() || Geo.distanceM(line.get(line.size() - 1), c) > 0.05) {
                    line.add(c);
                }
            }
        }
        if (line.size() == 1) {
            line.add(line.get(0));
        }
        double distance = segs.stream().mapToDouble(Segment::lengthM).sum();

        String wkt = toWkt(line);
        int benches = repo.benchesNearLine(wkt, 20);
        RouteSummary summary = RouteAnalyzer.summarize(segs, benches);
        var coverage = RouteAnalyzer.coverage(segs, summary);
        List<Warning> warnings = new ArrayList<>(RouteAnalyzer.warnings(segs, summary, coverage, prefs));
        if (origin.snapDistanceM() > props.snapWarningDistanceM()) {
            warnings.add(0, new Warning("ORIGIN_FAR_FROM_PATH", "CAUTION", null, origin.snapDistanceM(),
                    new double[]{origin.lon(), origin.lat()}));
        }
        if (destination.snapDistanceM() > props.snapWarningDistanceM()) {
            warnings.add(0, new Warning("DESTINATION_FAR_FROM_PATH", "CAUTION", null, destination.snapDistanceM(),
                    new double[]{destination.lon(), destination.lat()}));
        }

        Set<Long> routeEdges = new HashSet<>();
        segs.forEach(s -> routeEdges.add(s.edgeId()));
        List<NearbyObstacle> obstacles = repo.reportsNearLine(wkt, 20).stream()
                .map(r -> new NearbyObstacle(r.id(), r.category(), r.impact(), r.status(), r.lat(), r.lon(),
                        Geo.round(r.distanceM(), 1), r.lastConfirmedAt(),
                        "VERIFIED".equals(r.status()) && fx.edgeToObstacle().entrySet().stream()
                                .anyMatch(e -> e.getValue().equals(r.id()) && routeEdges.contains(e.getKey()))))
                .toList();
        long pending = obstacles.stream().filter(x -> "PENDING".equals(x.status())).count();
        if (pending > 0) {
            warnings.add(new Warning("UNVERIFIED_REPORTS_NEARBY", "CAUTION", (int) pending, null, null));
        }
        long verified = obstacles.stream().filter(x -> "VERIFIED".equals(x.status())).count();
        if (verified > 0) {
            warnings.add(new Warning("VERIFIED_OBSTACLE_NEARBY", "WARNING", (int) verified, null, null));
        }

        Explanation explanation = explain(b.kinds(), prefs, segs, summary, coverage, baselineSegs, baselineSummary,
                distance, fx);
        List<RouteApi.Instruction> instructions = InstructionBuilder.build(segs);
        return new RouteOption(id, b.kinds(), Geo.round(distance, 1), Math.round(distance / prefs.speed()),
                new LineGeometry("LineString", line), instructions, summary, coverage,
                RouteAnalyzer.suitability(summary, coverage, prefs), warnings, obstacles, explanation);
    }

    private Explanation explain(List<String> kinds, RoutingPreferences p, List<Segment> segs, RouteSummary s,
                                RouteApi.Coverage c, List<Segment> baseSegs, RouteSummary base, double distance,
                                ObstacleEffects fx) {
        List<String> reasons = new ArrayList<>();
        if (p.is(p.avoidStairs()) || p.isWheeled()) {
            reasons.add("REQUIREMENT_NO_STAIRS");
        }
        if (p.isWheeled()) {
            reasons.add("REQUIREMENT_MAX_KERB");
        }
        if (p.minWidthM() != null) {
            reasons.add("REQUIREMENT_MIN_WIDTH");
        }
        if (p.maxInclinePct() != null) {
            reasons.add("REQUIREMENT_MAX_INCLINE");
        }
        if (kinds.contains("SHORTEST_SUITABLE")) {
            reasons.add("SHORTEST_MEETING_REQUIREMENTS");
        }
        if (kinds.contains("BEST_COVERAGE") && !kinds.contains("RECOMMENDED")) {
            reasons.add("PREFERS_WELL_MAPPED_PATHS");
        }
        Map<String, Number> avoided = new LinkedHashMap<>();
        Double extra = null;
        if (base != null) {
            double baseLen = baseSegs.stream().mapToDouble(Segment::lengthM).sum();
            double segLen = segs.stream().mapToDouble(Segment::lengthM).sum();
            extra = Geo.round(Math.max(0, segLen - baseLen), 0);
            if (extra <= Math.max(10, baseLen * 0.02)) {
                reasons.add("SAME_AS_SHORTEST_WALK");
            }
            putIfPositive(avoided, "stairs", base.stairs() - s.stairs());
            putIfPositive(avoided, "raisedKerbs", base.raisedKerbs() - s.raisedKerbs());
            putIfPositive(avoided, "steepSections", base.steepSections().size() - s.steepSections().size());
            putIfPositive(avoided, "roughSurfaceM", Math.round(base.roughSurfaceM() - s.roughSurfaceM()));
            putIfPositive(avoided, "carriagewayM", Math.round(base.carriagewayM() - s.carriagewayM()));
            putIfPositive(avoided, "crossingsWithoutSignals",
                    (base.crossings() - base.crossingsWithSignals()) - (s.crossings() - s.crossingsWithSignals()));
            if (avoided.containsKey("stairs")) {
                reasons.add("AVOIDS_STAIRS");
            }
            if (avoided.containsKey("raisedKerbs")) {
                reasons.add("AVOIDS_RAISED_KERBS");
            }
            if (avoided.containsKey("steepSections")) {
                reasons.add("AVOIDS_STEEP_SECTIONS");
            }
            if (avoided.getOrDefault("roughSurfaceM", 0).doubleValue() >= 20) {
                reasons.add("AVOIDS_ROUGH_SURFACES");
            }
            if (avoided.getOrDefault("carriagewayM", 0).doubleValue() >= 20) {
                reasons.add("LESS_TRAFFIC_EXPOSURE");
            }
            if (avoided.containsKey("crossingsWithoutSignals")) {
                reasons.add("MORE_SIGNALISED_CROSSINGS");
            }
            var baseCov = RouteAnalyzer.coverage(baseSegs, base);
            if (c.score() - baseCov.score() >= 0.05) {
                reasons.add("BETTER_MAPPED");
            }
            Set<Long> affected = fx.edgeToObstacle().keySet();
            boolean baseHits = baseSegs.stream().anyMatch(x -> affected.contains(x.edgeId()));
            boolean routeHits = segs.stream().anyMatch(x -> affected.contains(x.edgeId()));
            if (baseHits && !routeHits) {
                reasons.add("AVOIDS_REPORTED_OBSTACLES");
            }
        }
        return new Explanation(reasons, extra, avoided);
    }

    private static void putIfPositive(Map<String, Number> m, String key, long v) {
        if (v > 0) {
            m.put(key, v);
        }
    }

    private DataNotice dataNotice() {
        Map<String, Object> info = repo.osmDataInfo();
        Instant ts = null;
        Object v = info.get("version");
        if (v instanceof String s && !s.isBlank()) {
            try {
                ts = OffsetDateTime.parse(s).toInstant();
            } catch (DateTimeParseException e) {
                log.debug("unparseable OSM timestamp {}", s);
            }
        }
        if (ts == null && info.get("retrieved_at") instanceof java.sql.Timestamp t) {
            ts = t.toInstant();
        }
        return new DataNotice("ROUTE_NOT_GUARANTEED", ts, List.of("OpenStreetMap", "Copernicus DEM (estimated slopes)",
                "Accessible Skopje community reports (verified only)"));
    }

    static String toWkt(List<double[]> line) {
        StringJoiner j = new StringJoiner(",", "LINESTRING(", ")");
        for (double[] c : line) {
            j.add(c[0] + " " + c[1]);
        }
        return j.toString();
    }
}
