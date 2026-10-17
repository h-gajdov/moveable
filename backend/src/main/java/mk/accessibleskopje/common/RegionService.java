package mk.accessibleskopje.common;

import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import mk.accessibleskopje.config.AppProperties;

/** The active region (city). The schema supports several; one is served per deployment. */
@Service
public class RegionService {

    public record Region(String code, Map<String, String> names, double minLon, double minLat, double maxLon,
                         double maxLat, double centerLon, double centerLat, int defaultZoom) {

        public boolean contains(double lat, double lon) {
            return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
        }
    }

    private final JdbcTemplate jdbc;
    private final String code;
    private volatile Region cached;

    public RegionService(JdbcTemplate jdbc, AppProperties props) {
        this.jdbc = jdbc;
        this.code = props.region();
    }

    public Region current() {
        Region r = cached;
        if (r == null) {
            r = jdbc.queryForObject("""
                    SELECT code, names::text AS names, ST_XMin(bbox) AS x0, ST_YMin(bbox) AS y0, ST_XMax(bbox) AS x1,
                           ST_YMax(bbox) AS y1, ST_X(center) AS cx, ST_Y(center) AS cy, default_zoom
                    FROM region WHERE code = ?""",
                    (rs, i) -> new Region(rs.getString("code"), Json.stringMap(rs.getString("names")),
                            rs.getDouble("x0"), rs.getDouble("y0"), rs.getDouble("x1"), rs.getDouble("y1"),
                            rs.getDouble("cx"), rs.getDouble("cy"), rs.getInt("default_zoom")), code);
            cached = r;
        }
        return r;
    }
}
