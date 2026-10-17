package mk.accessibleskopje.routing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

import mk.accessibleskopje.config.RoutingProperties;
import mk.accessibleskopje.config.RoutingProperties.Weights;
import mk.accessibleskopje.routing.EdgeCostBuilder.Mode;

class EdgeCostBuilderTest {

    static RoutingProperties props() {
        return new RoutingProperties(150, 40, 25, 0.01, 30000, 10, 0.85, new Weights(0.4,
                new RoutingProperties.Surface(0.15, 1.2, 4, 8, 0.25, 1.8),
                new RoutingProperties.Slope(3, 0.12, 0.6, 2.5, 0.4),
                new RoutingProperties.Traffic(0.08, 0.45, 0.6),
                new RoutingProperties.PedestrianPreference(0.25, 0.3),
                new RoutingProperties.Crossing(8, 18, 45, 70, 30, 45, 20, 35, 0.5),
                new RoutingProperties.Uncertainty(0.1, 0.35, 1.4),
                new RoutingProperties.Intersections(12), new RoutingProperties.Lit(0.25),
                new RoutingProperties.Rest(0.12), new RoutingProperties.Stairs(25), 0.6,
                new RoutingProperties.Obstacles(250, 60)));
    }

    static RoutingPreferences wheelchair() {
        return new RoutingPreferences(true, false, true, 8.0, 0.9, 3.0, true, true, true, false, false, false, false,
                false, 1.0);
    }

    @Test
    void standardHasOnlyLegalConstraints() {
        var b = new EdgeCostBuilder(RoutingPreferences.empty(), props(), Mode.RECOMMENDED, Set.of(), Map.of());
        assertThat(b.hardConstraints()).contains("crossing_forbidden").doesNotContain("is_stairs");
    }

    @Test
    void wheelchairExcludesStairsKerbsWidthAndMappedInclineOnly() {
        String sql = new EdgeCostBuilder(wheelchair(), props(), Mode.RECOMMENDED, Set.of(), Map.of()).hardConstraints();
        assertThat(sql).contains("a.is_stairs", "a.kerb_height_cm > 3.0000", "a.width_m < 0.9000",
                "a.incline_source = 'OSM'", "IS DISTINCT FROM 'WHEELCHAIR'");
        // Estimated (DEM) slopes must never be a hard constraint.
        assertThat(sql).doesNotContain("'DEM'");
    }

    @Test
    void hardConstraintsAreNullSafe() {
        String sql = new EdgeCostBuilder(wheelchair(), props(), Mode.RECOMMENDED, Set.of(), Map.of()).hardConstraints();
        // Every exclusion of the form "(cond) IS NOT TRUE" keeps edges with unknown values.
        assertThat(sql).doesNotContain("NOT (");
        assertThat(sql).contains(") IS NOT TRUE");
    }

    @Test
    void baselineIgnoresUserConstraintsAndObstacles() {
        var b = new EdgeCostBuilder(wheelchair(), props(), Mode.BASELINE, Set.of(5L), Map.of(6L, 100.0));
        assertThat(b.hardConstraints()).doesNotContain("is_stairs").doesNotContain("NOT IN");
        assertThat(b.costExpression()).isEqualTo("e.length_m");
        assertThat(b.obstacleJoin()).isEmpty();
    }

    @Test
    void obstaclesBecomeExclusionsAndPenalties() {
        var b = new EdgeCostBuilder(wheelchair(), props(), Mode.RECOMMENDED, Set.of(5L), Map.of(6L, 250.0));
        assertThat(b.hardConstraints()).contains("e.id NOT IN (5)");
        assertThat(b.obstacleJoin()).contains("(6::bigint,250.0000::float8)");
        assertThat(b.costExpression()).contains("COALESCE(o.penalty, 0)");
    }

    @Test
    void minimizeDistanceScalesSoftPenalties() {
        var p = new RoutingPreferences(null, null, null, null, null, null, true, null, null, null, null, true, null,
                null, null);
        String cost = new EdgeCostBuilder(p, props(), Mode.RECOMMENDED, Set.of(), Map.of()).costExpression();
        assertThat(cost).contains("0.4000 * (");
    }

    @Test
    void visualGuidanceRewardsAudibleSignalsAndTactilePaving() {
        var p = new RoutingPreferences(false, true, null, null, null, null, null, null, true, null, null, null, null,
                null, null);
        String cost = new EdgeCostBuilder(p, props(), Mode.RECOMMENDED, Set.of(), Map.of()).costExpression();
        assertThat(cost).contains("a.crossing_sound IS NOT TRUE", "a.tactile_paving IS NOT TRUE");
    }

    @Test
    void regionCodeIsValidated() {
        var b = new EdgeCostBuilder(RoutingPreferences.empty(), props(), Mode.RECOMMENDED, Set.of(), Map.of());
        assertThatThrownBy(() -> b.edgesSql("x'; DROP TABLE routing_edge; --", 0, 0, 1, 1))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void preferencesMergeOntoProfileDefaults() {
        var merged = new RoutingPreferences(null, null, null, 6.0, null, null, null, null, null, null, null, null, null,
                null, null).mergedOnto(wheelchair());
        assertThat(merged.maxInclinePct()).isEqualTo(6.0);
        assertThat(merged.avoidStairs()).isTrue();
        assertThat(merged.isWheeled()).isTrue();
    }
}
