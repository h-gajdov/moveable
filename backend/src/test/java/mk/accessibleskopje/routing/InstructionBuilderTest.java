package mk.accessibleskopje.routing;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import mk.accessibleskopje.common.Transliteration;
import mk.accessibleskopje.obstacles.ObstacleCategory;
import mk.accessibleskopje.obstacles.ObstacleImpact;

class InstructionBuilderTest {

    static Segment seg(long id, String name, String pathClass, double[]... coords) {
        return seg(id, name, pathClass, false, false, null, coords);
    }

    static Segment seg(long id, String name, String pathClass, boolean stairs, boolean crossing, String crossingType,
                       double[]... coords) {
        List<double[]> c = List.of(coords);
        return new Segment(id, id, false, c, mk.accessibleskopje.common.Geo.length(c), pathClass, null,
                name == null ? Map.of() : Map.of("default", name), null, "SMOOTH", null, null, null, null,
                stairs ? "up" : null, stairs, null, null, null, null, null, null, null, null, null, null, crossing,
                false, crossing ? "W" + id : null, crossingType, null, "SIGNALS".equals(crossingType) ? true : null,
                null, null, null, 0, false, 3, 0.5);
    }

    @Test
    void departTurnAndArrive() {
        var a = seg(1, "Партизанска", "SIDEWALK", new double[]{21.4300, 42.0}, new double[]{21.4310, 42.0});
        var b = seg(2, "Илинденска", "SIDEWALK", new double[]{21.4310, 42.0}, new double[]{21.4310, 41.999});
        var ins = InstructionBuilder.build(List.of(a, b));
        assertThat(ins).extracting(RouteApi.Instruction::type).containsExactly("DEPART", "TURN", "ARRIVE");
        assertThat(ins.get(0).modifier()).isEqualTo("E");
        assertThat(ins.get(1).modifier()).isEqualTo("RIGHT");
        assertThat(ins.get(1).names()).containsEntry("default", "Илинденска");
        assertThat(ins.get(2).startDistanceM()).isBetween(190.0, 196.0);
    }

    @Test
    void sameStreetSegmentsMergeIntoOneInstruction() {
        var a = seg(1, "Македонија", "PEDESTRIAN", new double[]{21.4300, 42.0}, new double[]{21.4305, 42.0});
        var b = seg(2, "Македонија", "PEDESTRIAN", new double[]{21.4305, 42.0}, new double[]{21.4310, 42.0001});
        assertThat(InstructionBuilder.build(List.of(a, b))).extracting(RouteApi.Instruction::type)
                .containsExactly("DEPART", "ARRIVE");
    }

    @Test
    void crossingAndStairsGetTheirOwnSteps() {
        var a = seg(1, null, "SIDEWALK", new double[]{21.4300, 42.0}, new double[]{21.4310, 42.0});
        var c = seg(2, null, "CROSSING", false, true, "SIGNALS", new double[]{21.4310, 42.0}, new double[]{21.4310, 41.9998});
        var s = seg(3, null, "STEPS", true, false, null, new double[]{21.4310, 41.9998}, new double[]{21.4310, 41.9990});
        var ins = InstructionBuilder.build(List.of(a, c, s));
        assertThat(ins).extracting(RouteApi.Instruction::type).containsExactly("DEPART", "CROSS", "STAIRS", "ARRIVE");
        assertThat(ins.get(1).crossing().signals()).isTrue();
        assertThat(ins.get(1).crossing().sound()).as("unknown stays unknown").isNull();
        assertThat(ins.get(2).stairs().direction()).isEqualTo("UP");
    }

    @Test
    void turnModifiers() {
        assertThat(InstructionBuilder.turnModifier(5)).isEqualTo("STRAIGHT");
        assertThat(InstructionBuilder.turnModifier(-35)).isEqualTo("SLIGHT_LEFT");
        assertThat(InstructionBuilder.turnModifier(90)).isEqualTo("RIGHT");
        assertThat(InstructionBuilder.turnModifier(-160)).isEqualTo("SHARP_LEFT");
    }

    @Test
    void distancesAreRoundedForSpeech() {
        assertThat(InstructionBuilder.roundDistance(83)).isEqualTo(85);
        assertThat(InstructionBuilder.roundDistance(123)).isEqualTo(120);
    }

    @Test
    void transliterationMatchesPipeline() {
        assertThat(Transliteration.toLatin("Ѓорче Петров")).isEqualTo("Gjorche Petrov");
        assertThat(Transliteration.normalizeForSearch("Çarshia e Vjetër")).isEqualTo("carshia e vjeter");
        assertThat(Transliteration.normalizeForSearch("Улица Македонија")).isEqualTo("ulica makedonija");
    }

    @Test
    void obstacleRelevanceDependsOnNeeds() {
        var wheel = new RoutingPreferences(true, false, true, null, null, null, null, null, null, null, null, null,
                null, null, null);
        var standard = RoutingPreferences.empty();
        assertThat(ObstacleCategory.HIGH_KERB.effectiveImpact(ObstacleImpact.IMPASSABLE, wheel))
                .isEqualTo(ObstacleImpact.IMPASSABLE);
        assertThat(ObstacleCategory.HIGH_KERB.effectiveImpact(ObstacleImpact.IMPASSABLE, standard))
                .isEqualTo(ObstacleImpact.DIFFICULT);
        assertThat(ObstacleCategory.MISSING_TACTILE_PAVING.effectiveImpact(ObstacleImpact.IMPASSABLE, wheel)).isNull();
        assertThat(ObstacleCategory.CONSTRUCTION.effectiveImpact(ObstacleImpact.IMPASSABLE, standard))
                .isEqualTo(ObstacleImpact.IMPASSABLE);
    }
}
