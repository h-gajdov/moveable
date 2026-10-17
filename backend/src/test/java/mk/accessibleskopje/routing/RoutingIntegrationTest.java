package mk.accessibleskopje.routing;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.jdbc.Sql;

import mk.accessibleskopje.TestcontainersConfiguration;
import mk.accessibleskopje.common.ApiException;
import mk.accessibleskopje.routing.RouteApi.LatLon;
import mk.accessibleskopje.routing.RouteApi.RouteOption;
import mk.accessibleskopje.routing.RouteApi.RouteRequest;
import mk.accessibleskopje.routing.RouteApi.RouteResponse;

/**
 * Routing behaviour against a real PostGIS + pgRouting database with the
 * deterministic fixture graph in {@code fixtures/graph.sql}.
 */
@SpringBootTest(properties = {"app.routing.min-component-size=1", "app.rate-limit.routes-per-window=100000"})
@Import(TestcontainersConfiguration.class)
@Sql("/fixtures/graph.sql")
class RoutingIntegrationTest {

    static final LatLon N1 = new LatLon(42.0000, 21.4300);
    static final LatLon N2 = new LatLon(42.0000, 21.4310);
    static final LatLon N3 = new LatLon(42.0000, 21.4320);
    static final LatLon N5 = new LatLon(42.0010, 21.4310);
    static final LatLon N7 = new LatLon(42.0000, 21.4500);

    @Autowired
    RoutingService routing;
    @Autowired
    JdbcTemplate jdbc;

    RouteResponse route(String profile, RoutingPreferences prefs, LatLon from, LatLon to) {
        return routing.route(new RouteRequest(from, to, profile, prefs, true));
    }

    static RoutingPreferences prefs() {
        return RoutingPreferences.empty();
    }

    static boolean passesThrough(RouteOption r, double lon, double lat) {
        return r.geometry().coordinates().stream()
                .anyMatch(c -> Math.abs(c[0] - lon) < 1e-7 && Math.abs(c[1] - lat) < 1e-7);
    }

    static RouteOption recommended(RouteResponse r) {
        assertThat(r.noRoute()).as("expected a route").isNull();
        return r.routes().stream().filter(o -> o.kinds().contains("RECOMMENDED")).findFirst().orElseThrow();
    }

    @Test
    void standardProfileTakesShortestPathIncludingStairs() {
        RouteOption r = recommended(route("STANDARD", null, N1, N3));
        assertThat(r.distanceM()).isBetween(160.0, 170.0);
        assertThat(r.summary().stairs()).isEqualTo(1);
        assertThat(r.warnings()).anyMatch(w -> w.code().equals("STAIRS_ON_ROUTE"));
        // One map flag per flight, the first doubling as the warning's location.
        var stairs = r.warnings().stream().filter(w -> w.code().equals("STAIRS_ON_ROUTE")).findFirst().orElseThrow();
        assertThat(stairs.locations()).hasSize(1);
        assertThat(stairs.location()).isEqualTo(stairs.locations().get(0));
    }

    @Test
    void wheelchairRouteAvoidsMappedStairsAndNarrowPath() {
        RouteOption r = recommended(route("WHEELCHAIR", null, N1, N3));
        assertThat(r.summary().stairs()).isZero();
        // Narrow edge 2-5 (0.7 m < 0.9 m) must not be used: route goes 1-4-5-6-3.
        assertThat(passesThrough(r, 21.4300, 42.0010)).isTrue();
        assertThat(passesThrough(r, 21.4310, 42.0000)).isFalse();
        assertThat(r.explanation().reasons()).contains("AVOIDS_STAIRS", "REQUIREMENT_NO_STAIRS");
        assertThat(r.explanation().extraDistanceM()).isGreaterThan(200);
    }

    @Test
    void narrowPathExcludedOnlyWhenWidthLimitApplies() {
        // Node 2 -> node 5: direct edge 7 is 111 m but only 0.7 m wide.
        var stepFreeOnly = new RoutingPreferences(null, null, true, null, null, null, null, null, null, null, null,
                null, null, null, null);
        RouteOption custom = recommended(route("CUSTOM", stepFreeOnly, N2, N5));
        assertThat(custom.distanceM()).isBetween(108.0, 114.0);

        RouteOption wheelchair = recommended(route("WHEELCHAIR", null, N2, N5));
        assertThat(wheelchair.distanceM()).isGreaterThan(250);
        assertThat(wheelchair.warnings()).noneMatch(w -> w.code().equals("NARROW_PATH"));
    }

    @Test
    void missingAccessibilityDataDoesNotExcludeEdges() {
        // Edges 1, 2 and 7 have every attribute unknown (NULL). A wheelchair route
        // between nodes 1 and 2 must still use edge 1 — unknown is not "unsuitable"...
        RouteOption r = recommended(route("WHEELCHAIR", null, N1, new LatLon(42.0000, 21.4310)));
        assertThat(r.distanceM()).isBetween(80.0, 85.0);
        // ...but it must be reported as unknown, never as verified.
        assertThat(r.coverage().level()).isEqualTo("LOW");
        assertThat(r.suitability().level()).isNotEqualTo("NO_KNOWN_ISSUES");
        assertThat(r.warnings()).anyMatch(w -> w.code().equals("SURFACE_UNKNOWN"));
        assertThat(r.warnings()).anyMatch(w -> w.code().equals("LOW_DATA_COVERAGE"));
    }

    @Test
    void mappedSlopeAboveLimitIsExcludedForWheelchair() {
        jdbc.update("UPDATE edge_accessibility SET incline_pct = 12, incline_source = 'OSM' WHERE edge_id = 4");
        RouteResponse r = route("WHEELCHAIR", null, N1, N3);
        // Only remaining step-free paths use edge 4 (steep) or edge 7 (narrow): no route.
        assertThat(r.routes()).isEmpty();
        assertThat(r.noRoute().reason()).isEqualTo("CONSTRAINTS_UNSATISFIABLE");
        assertThat(r.noRoute().blockingFeatures()).anyMatch(b -> b.type().equals("STAIRS"));
    }

    @Test
    void estimatedSlopeIsNeverAHardConstraint() {
        jdbc.update("UPDATE edge_accessibility SET incline_pct = 12, incline_source = 'DEM' WHERE edge_id IN (4, 5)");
        RouteOption r = recommended(route("WHEELCHAIR", null, N1, N3));
        assertThat(r.summary().stairs()).isZero();
        assertThat(r.warnings()).anyMatch(w -> w.code().equals("STEEP_SECTION_ESTIMATED"));
    }

    @Test
    void widthLimitIsConfigurable() {
        var p = new RoutingPreferences(true, null, true, null, 0.6, null, null, null, null, null, null, null, null,
                null, null);
        RouteOption r = recommended(route("WHEELCHAIR", p, N2, N5));
        // With a 0.6 m minimum the 0.7 m path is allowed — and flagged as narrow.
        assertThat(r.distanceM()).isBetween(108.0, 114.0);
        assertThat(r.warnings()).anyMatch(w -> w.code().equals("NARROW_PATH") && !w.locations().isEmpty());
    }

    @Test
    void roughSurfaceIsPenalisedNotExcluded() {
        jdbc.update("UPDATE edge_accessibility SET surface_class = 'VERY_ROUGH', surface = 'sand' WHERE edge_id = 1");
        var avoidRough = new RoutingPreferences(null, null, null, null, null, null, true, null, null, null, null, null,
                null, null, null);
        RouteOption avoid = recommended(route("CUSTOM", avoidRough, N1, N3));
        assertThat(passesThrough(avoid, 21.4300, 42.0010)).as("detours via node 4").isTrue();

        RouteOption standard = recommended(route("STANDARD", null, N1, N3));
        assertThat(standard.distanceM()).isBetween(160.0, 170.0);
        assertThat(standard.warnings()).anyMatch(w -> w.code().equals("ROUGH_SURFACE"));
    }

    @Test
    void raisedKerbExcludedForWheelchair() {
        jdbc.update("UPDATE edge_accessibility SET kerb_type = 'raised' WHERE edge_id = 3");
        jdbc.update("UPDATE edge_accessibility SET width_m = NULL WHERE edge_id = 7");
        RouteOption r = recommended(route("WHEELCHAIR", null, N1, N3));
        assertThat(passesThrough(r, 21.4300, 42.0010)).isFalse();
        assertThat(r.summary().raisedKerbs()).isZero();
    }

    @Test
    void disconnectedComponentsGiveExplicitNoRoute() {
        RouteResponse r = route("STANDARD", null, N1, N7);
        assertThat(r.routes()).isEmpty();
        assertThat(r.noRoute().reason()).isEqualTo("NOT_CONNECTED");
    }

    @Test
    void pointFarFromNetworkIsRejectedNotSnappedSilently() {
        RouteResponse r = route("STANDARD", null, new LatLon(42.0100, 21.4300), N3);
        assertThat(r.routes()).isEmpty();
        assertThat(r.noRoute().reason()).isEqualTo("ORIGIN_TOO_FAR_FROM_NETWORK");
    }

    @Test
    void snapDistanceIsReportedAndWarnedWhenLarge() {
        RouteResponse r = route("STANDARD", null, new LatLon(41.99955, 21.4305), N3);
        assertThat(r.origin().snapDistanceM()).isBetween(45.0, 55.0);
        assertThat(recommended(r).warnings()).anyMatch(w -> w.code().equals("ORIGIN_FAR_FROM_PATH"));
    }

    @Test
    void verifiedBlockingObstacleIsAvoidedPendingIsOnlyWarned() {
        insertReport("BLOCKED_PATH", "IMPASSABLE", "VERIFIED", 42.0000, 21.43035);
        RouteOption r = recommended(route("STANDARD", null, N1, N3));
        assertThat(passesThrough(r, 21.4300, 42.0010)).isTrue();
        assertThat(r.explanation().reasons()).contains("AVOIDS_REPORTED_OBSTACLES");

        jdbc.update("DELETE FROM obstacle_report");
        insertReport("BLOCKED_PATH", "IMPASSABLE", "PENDING", 42.0000, 21.43035);
        RouteOption pending = recommended(route("STANDARD", null, N1, N3));
        assertThat(pending.distanceM()).isBetween(160.0, 170.0);
        assertThat(pending.warnings()).anyMatch(w -> w.code().equals("UNVERIFIED_REPORTS_NEARBY"));
        assertThat(pending.obstacles()).allMatch(o -> !o.affectsRouting());
    }

    @Test
    void obstacleIrrelevantToProfileIsIgnoredForRouting() {
        // Missing tactile paving does not change a standard pedestrian's route.
        insertReport("MISSING_TACTILE_PAVING", "IMPASSABLE", "VERIFIED", 42.0000, 21.43035);
        RouteOption r = recommended(route("STANDARD", null, N1, N3));
        assertThat(r.distanceM()).isBetween(160.0, 170.0);
    }

    @Test
    void sameEdgeRouteUsesPartialGeometry() {
        RouteOption r = recommended(route("STANDARD", null, new LatLon(42.0000, 21.4302), new LatLon(42.0000, 21.4308)));
        assertThat(r.distanceM()).isBetween(45.0, 55.0);
        assertThat(r.instructions().get(0).type()).isEqualTo("DEPART");
        assertThat(r.instructions().get(r.instructions().size() - 1).type()).isEqualTo("ARRIVE");
    }

    @Test
    void instructionsUseRealNamesAndTurns() {
        RouteOption r = recommended(route("WHEELCHAIR", null, N1, N3));
        List<String> types = r.instructions().stream().map(RouteApi.Instruction::type).toList();
        assertThat(types.get(0)).isEqualTo("DEPART");
        assertThat(types).contains("TURN");
        assertThat(r.instructions()).anyMatch(i -> "Upper Path".equals(i.names().get("en")));
        assertThat(r.instructions()).anyMatch(i -> "RIGHT".equals(i.modifier()));
    }

    @Test
    void alternativesAreDeduplicated() {
        RouteResponse r = route("STANDARD", null, N1, N3);
        // The only sensible route; identical alternatives must be merged, not repeated.
        assertThat(r.routes()).hasSize(1);
        assertThat(r.routes().get(0).kinds()).contains("RECOMMENDED", "SHORTEST_SUITABLE");
    }

    @Test
    void outsideRegionIsRejected() {
        org.junit.jupiter.api.Assertions.assertThrows(ApiException.class,
                () -> route("STANDARD", null, new LatLon(41.0, 20.0), N3));
    }

    void insertReport(String category, String impact, String status, double lat, double lon) {
        jdbc.update("""
                INSERT INTO obstacle_report (id, region_code, lat, lon, category, impact, status)
                VALUES (gen_random_uuid(), 'skopje', ?, ?, ?, ?, ?)""", lat, lon, category, impact, status);
    }
}
