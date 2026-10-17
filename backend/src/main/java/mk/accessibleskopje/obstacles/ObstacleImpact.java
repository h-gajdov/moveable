package mk.accessibleskopje.obstacles;

public enum ObstacleImpact {
    IMPASSABLE, DIFFICULT, MINOR;

    public ObstacleImpact downgrade() {
        return switch (this) {
            case IMPASSABLE -> DIFFICULT;
            case DIFFICULT -> MINOR;
            case MINOR -> null;
        };
    }
}
