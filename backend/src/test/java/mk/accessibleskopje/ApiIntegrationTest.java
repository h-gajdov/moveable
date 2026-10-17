package mk.accessibleskopje;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
        "app.routing.min-component-size=1",
        "app.admin.bootstrap-username=moderator1",
        "app.admin.bootstrap-password=correct-horse-battery",
        "app.rate-limit.reports-per-window=3",
        "app.uploads.dir=target/test-uploads"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
@Sql("/fixtures/graph.sql")
class ApiIntegrationTest {

    static final String REPORT = """
            {"lat": 42.0000, "lon": 21.4305, "category": "%s", "impact": "IMPASSABLE",
             "description": "Construction fence <script>alert(1)</script>", "temporary": true}""";

    @Autowired
    MockMvc mvc;
    @Autowired
    JdbcTemplate jdbc;

    @Test
    void healthReportsGraphStatus() throws Exception {
        mvc.perform(get("/api/health")).andExpect(status().isOk())
                .andExpect(jsonPath("$.database").value("UP"))
                .andExpect(jsonPath("$.graphLoaded").value(true));
    }

    @Test
    void profilesListed() throws Exception {
        mvc.perform(get("/api/routing-profiles")).andExpect(status().isOk())
                .andExpect(jsonPath("$.profiles[0].code").value("STANDARD"))
                .andExpect(jsonPath("$.profiles[1].defaults.avoidStairs").value(true))
                .andExpect(jsonPath("$.settings").isArray());
    }

    @Test
    void routeValidationErrorsAreStructured() throws Exception {
        mvc.perform(post("/api/routes").contentType(MediaType.APPLICATION_JSON).content("{\"origin\": {\"lat\": 42}}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors").isArray());
        mvc.perform(post("/api/routes").contentType(MediaType.APPLICATION_JSON).content("not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void routeOutsideRegionGives422WithCode() throws Exception {
        mvc.perform(post("/api/routes").contentType(MediaType.APPLICATION_JSON).content("""
                        {"origin": {"lat": 41.0, "lon": 20.0}, "destination": {"lat": 42.0, "lon": 21.432}}"""))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("ORIGIN_OUTSIDE_REGION"))
                .andExpect(jsonPath("$.trace").doesNotExist());
    }

    @Test
    void unknownProfileRejected() throws Exception {
        mvc.perform(post("/api/routes").contentType(MediaType.APPLICATION_JSON).content("""
                        {"origin": {"lat": 42.0, "lon": 21.43}, "destination": {"lat": 42.0, "lon": 21.432},
                         "profile": "NOPE"}"""))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("UNKNOWN_PROFILE"));
    }

    @Test
    void routeEndpointReturnsRoute() throws Exception {
        mvc.perform(post("/api/routes").contentType(MediaType.APPLICATION_JSON).content("""
                        {"origin": {"lat": 42.0, "lon": 21.43}, "destination": {"lat": 42.0, "lon": 21.432},
                         "profile": "WHEELCHAIR"}"""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.routes[0].summary.stairs").value(0))
                .andExpect(jsonPath("$.routes[0].geometry.type").value("LineString"))
                .andExpect(jsonPath("$.dataNotice.code").value("ROUTE_NOT_GUARANTEED"));
    }

    @Test
    void adminEndpointsRequireAuthentication() throws Exception {
        mvc.perform(get("/api/admin/reports")).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mvc.perform(get("/api/admin/reports").with(httpBasic("moderator1", "wrong-password")))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/reports").with(httpBasic("moderator1", "correct-horse-battery")))
                .andExpect(status().isOk());
    }

    @Test
    void reportLifecycleAndModeration() throws Exception {
        String body = mvc.perform(post("/api/obstacles/reports").contentType(MediaType.APPLICATION_JSON)
                        .content(REPORT.formatted("CONSTRUCTION")))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.status").value("PENDING"))
                .andReturn().getResponse().getContentAsString();
        String id = body.replaceAll(".*\"id\":\"([^\"]+)\".*", "$1");

        // Public listing: unverified reports are flagged and their free text is hidden.
        mvc.perform(get("/api/obstacles").param("bbox", "21.42,41.99,21.44,42.01"))
                .andExpect(jsonPath("$[0].status").value("PENDING"))
                .andExpect(jsonPath("$[0].verified").value(false))
                .andExpect(jsonPath("$[0].description").doesNotExist());

        var admin = httpBasic("moderator1", "correct-horse-battery");
        mvc.perform(post("/api/admin/reports/" + id + "/status").with(admin).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\": \"VERIFIED\", \"note\": \"Checked on site\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("VERIFIED"));
        // Invalid transition VERIFIED -> PENDING
        mvc.perform(post("/api/admin/reports/" + id + "/status").with(admin).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\": \"PENDING\"}"))
                .andExpect(status().isUnprocessableContent()).andExpect(jsonPath("$.code").value("INVALID_TRANSITION"));
        mvc.perform(get("/api/admin/reports/" + id).with(admin))
                .andExpect(jsonPath("$.history.length()").value(2))
                .andExpect(jsonPath("$.history[1].by").value("moderator1"));

        // Stored as plain text (rendered as text by the client, never as HTML).
        String desc = jdbc.queryForObject("SELECT description FROM obstacle_report WHERE id = ?::uuid", String.class, id);
        assertThat(desc).contains("Construction fence");

        // A verified IMPASSABLE construction report now blocks routing along edge 1.
        mvc.perform(post("/api/routes").contentType(MediaType.APPLICATION_JSON).content("""
                        {"origin": {"lat": 42.0, "lon": 21.4300}, "destination": {"lat": 42.0, "lon": 21.4320}}"""))
                .andExpect(jsonPath("$.routes[0].explanation.reasons").value(
                        org.hamcrest.Matchers.hasItem("AVOIDS_REPORTED_OBSTACLES")));
    }

    @Test
    void reportValidation() throws Exception {
        mvc.perform(post("/api/obstacles/reports").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"lat\": 42.0, \"lon\": 21.43, \"category\": \"NOT_A_CATEGORY\", \"impact\": \"MINOR\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/obstacles/reports").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"lat\": 40.0, \"lon\": 20.0, \"category\": \"STAIRS\", \"impact\": \"MINOR\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("LOCATION_OUTSIDE_REGION"));
    }

    @Test
    void photoUploadIsReencodedAndFakeImagesRejected() throws Exception {
        BufferedImage img = new BufferedImage(40, 30, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(img, "png", png);
        var report = new MockMultipartFile("report", "", "application/json",
                REPORT.formatted("BROKEN_SIDEWALK").getBytes());
        mvc.perform(multipart("/api/obstacles/reports").file(report)
                        .file(new MockMultipartFile("photo", "p.png", "image/png", png.toByteArray()))
                        .with(r -> {
                            r.setRemoteAddr("10.0.0.2");
                            return r;
                        }))
                .andExpect(status().isCreated());
        assertThat(jdbc.queryForObject("SELECT photo_path FROM obstacle_report LIMIT 1", String.class)).endsWith(".jpg");

        mvc.perform(multipart("/api/obstacles/reports").file(report)
                        .file(new MockMultipartFile("photo", "evil.jpg", "image/jpeg", "<html>not an image</html>".getBytes()))
                        .with(r -> {
                            r.setRemoteAddr("10.0.0.2");
                            return r;
                        }))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("PHOTO_UNSUPPORTED_TYPE"));
    }

    @Test
    void reportsAreRateLimited() throws Exception {
        for (int i = 0; i < 3; i++) {
            mvc.perform(post("/api/obstacles/reports").contentType(MediaType.APPLICATION_JSON)
                            .content(REPORT.formatted("OTHER")).with(r -> {
                                r.setRemoteAddr("10.0.0.9");
                                return r;
                            }))
                    .andExpect(status().isCreated());
        }
        mvc.perform(post("/api/obstacles/reports").contentType(MediaType.APPLICATION_JSON)
                        .content(REPORT.formatted("OTHER")).with(r -> {
                            r.setRemoteAddr("10.0.0.9");
                            return r;
                        }))
                .andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.code").value("RATE_LIMITED"));
    }

    @Test
    void honeypotReportsAreNotStored() throws Exception {
        mvc.perform(post("/api/obstacles/reports").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"lat\": 42.0, \"lon\": 21.43, \"category\": \"STAIRS\", \"impact\": \"MINOR\", \"website\": \"spam\"}")
                        .with(r -> {
                            r.setRemoteAddr("10.0.0.3");
                            return r;
                        }))
                .andExpect(status().isCreated());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM obstacle_report", Integer.class)).isZero();
    }

    @Test
    void placeSearchMatchesCyrillicAndLatin() throws Exception {
        jdbc.update("DELETE FROM place");
        jdbc.update("""
                INSERT INTO place (region_code, kind, category, names, search_text, rank, geom)
                VALUES ('skopje', 'POI', 'amenity=pharmacy', '{"default": "Аптека Центар"}', 'apteka centar', 20,
                        ST_SetSRID(ST_MakePoint(21.4306, 42.0003), 4326))""");
        mvc.perform(get("/api/places").param("q", "Аптека")).andExpect(jsonPath("$[0].names.default").value("Аптека Центар"));
        mvc.perform(get("/api/places").param("q", "apteka")).andExpect(jsonPath("$[0].kind").value("POI"));
        mvc.perform(get("/api/places").param("q", "x")).andExpect(status().isBadRequest());
    }

    @Test
    void coverageEndpoint() throws Exception {
        mvc.perform(get("/api/coverage").param("bbox", "21.42,41.99,21.44,42.01").param("grid", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.edges").value(7))
                .andExpect(jsonPath("$.grid.type").value("FeatureCollection"));
        mvc.perform(get("/api/coverage").param("bbox", "20,40,22,43")).andExpect(status().isBadRequest());
    }

    @Test
    void mapFeaturesEndpoint() throws Exception {
        mvc.perform(get("/api/map-features").param("bbox", "21.42,41.99,21.44,42.01"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.features[0].properties.kind").value("STAIRS"));
    }
}
