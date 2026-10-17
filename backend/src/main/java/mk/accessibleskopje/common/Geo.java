package mk.accessibleskopje.common;

import java.util.ArrayList;
import java.util.List;

/** Small spherical-geometry helpers. Coordinates are {lon, lat} arrays. */
public final class Geo {

    private static final double R = 6_371_008.8;

    private Geo() {
    }

    public static double distanceM(double lat1, double lon1, double lat2, double lon2) {
        double p1 = Math.toRadians(lat1), p2 = Math.toRadians(lat2);
        double dp = p2 - p1, dl = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    public static double distanceM(double[] a, double[] b) {
        return distanceM(a[1], a[0], b[1], b[0]);
    }

    /** Initial bearing in degrees [0, 360) from a to b. */
    public static double bearing(double[] a, double[] b) {
        double p1 = Math.toRadians(a[1]), p2 = Math.toRadians(b[1]);
        double dl = Math.toRadians(b[0] - a[0]);
        double y = Math.sin(dl) * Math.cos(p2);
        double x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
        return (Math.toDegrees(Math.atan2(y, x)) + 360) % 360;
    }

    /** Signed turn angle in (-180, 180]; positive = right turn. */
    public static double turnAngle(double bearingIn, double bearingOut) {
        double d = (bearingOut - bearingIn + 540) % 360 - 180;
        return d == -180 ? 180 : d;
    }

    public static double length(List<double[]> line) {
        double sum = 0;
        for (int i = 1; i < line.size(); i++) {
            sum += distanceM(line.get(i - 1), line.get(i));
        }
        return sum;
    }

    /** Bearing of the first {@code metres} of a polyline (robust to tiny first segments). */
    public static double startBearing(List<double[]> line, double metres) {
        double acc = 0;
        double[] start = line.get(0);
        for (int i = 1; i < line.size(); i++) {
            acc += distanceM(line.get(i - 1), line.get(i));
            if (acc >= metres || i == line.size() - 1) {
                return bearing(start, line.get(i));
            }
        }
        return 0;
    }

    /** Bearing of the last {@code metres} of a polyline. */
    public static double endBearing(List<double[]> line, double metres) {
        double acc = 0;
        double[] end = line.get(line.size() - 1);
        for (int i = line.size() - 2; i >= 0; i--) {
            acc += distanceM(line.get(i), line.get(i + 1));
            if (acc >= metres || i == 0) {
                return bearing(line.get(i), end);
            }
        }
        return 0;
    }

    /** Parse {@code LINESTRING(x y, x y, ...)} WKT as produced by ST_AsText. */
    public static List<double[]> parseLineString(String wkt) {
        int open = wkt.indexOf('(');
        int close = wkt.lastIndexOf(')');
        String body = wkt.substring(open + 1, close);
        List<double[]> out = new ArrayList<>();
        for (String pair : body.split(",")) {
            String[] xy = pair.trim().split("\\s+");
            out.add(new double[]{Double.parseDouble(xy[0]), Double.parseDouble(xy[1])});
        }
        return out;
    }

    public static String cardinal(double bearing) {
        String[] dirs = {"N", "NE", "E", "SE", "S", "SW", "W", "NW"};
        return dirs[(int) Math.round(bearing / 45.0) % 8];
    }

    public static double round(double v, int decimals) {
        double f = Math.pow(10, decimals);
        return Math.round(v * f) / f;
    }
}
