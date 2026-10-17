package mk.accessibleskopje.obstacles;

import mk.accessibleskopje.routing.RoutingPreferences;

/**
 * Report categories and which routing needs each one affects. An obstacle that
 * does not affect the user's needs is ignored for routing (but still shown);
 * an obstacle that partly affects them is downgraded one impact level.
 */
public enum ObstacleCategory {
    MISSING_RAMP(true, false, 0),
    HIGH_KERB(true, false, 1),
    BROKEN_SIDEWALK(true, true, 1),
    STAIRS(true, false, 0),
    BLOCKED_PATH(true, true, 2),
    PARKED_VEHICLES(true, true, 1),
    CONSTRUCTION(true, true, 2),
    MISSING_TACTILE_PAVING(false, true, 0),
    UNSAFE_CROSSING(true, true, 1),
    OTHER(true, true, 2);

    private final boolean affectsWheeled;
    private final boolean affectsVisual;
    /** 0 = not relevant to others, 1 = relevant but less severe, 2 = full impact for everyone. */
    private final int othersLevel;

    ObstacleCategory(boolean affectsWheeled, boolean affectsVisual, int othersLevel) {
        this.affectsWheeled = affectsWheeled;
        this.affectsVisual = affectsVisual;
        this.othersLevel = othersLevel;
    }

    /** Default lifetime in days for temporary reports, or null for permanent categories. */
    public Integer defaultTemporaryDays() {
        return switch (this) {
            case PARKED_VEHICLES -> 1;
            case BLOCKED_PATH -> 7;
            case CONSTRUCTION -> 30;
            default -> null;
        };
    }

    /** Effective impact for these preferences, or null if the obstacle is irrelevant to them. */
    public ObstacleImpact effectiveImpact(ObstacleImpact reported, RoutingPreferences p) {
        boolean full = othersLevel == 2
                || (affectsWheeled && p.isWheeled())
                || (affectsVisual && p.isVisualGuidance())
                || (this == STAIRS && p.is(p.avoidStairs()))
                || (this == BROKEN_SIDEWALK && p.is(p.avoidRoughSurfaces()));
        if (full) {
            return reported;
        }
        boolean partial = othersLevel == 1
                || ((this == MISSING_RAMP || this == HIGH_KERB) && p.is(p.avoidStairs()));
        return partial ? reported.downgrade() : null;
    }
}
