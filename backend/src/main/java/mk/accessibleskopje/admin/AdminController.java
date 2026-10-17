package mk.accessibleskopje.admin;

import java.io.IOException;
import java.nio.file.Files;
import java.security.Principal;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import mk.accessibleskopje.common.ApiException;
import mk.accessibleskopje.common.Json;
import mk.accessibleskopje.obstacles.ObstacleReport;
import mk.accessibleskopje.obstacles.ObstacleReport.Status;
import mk.accessibleskopje.obstacles.ObstacleService;
import mk.accessibleskopje.obstacles.PhotoStorage;

@RestController
@RequestMapping("/api/admin")
@Validated
@Tag(name = "Administration")
@SecurityRequirement(name = "basicAuth")
public class AdminController {

    public record AdminReport(String id, String category, String impact, String status, double lat, double lon,
                              String description, boolean hasPhoto, boolean temporary, Instant expiresAt,
                              Instant createdAt, Instant updatedAt, Instant lastConfirmedAt, int confirmations,
                              String language) {
        static AdminReport of(ObstacleReport r) {
            return new AdminReport(r.getId().toString(), r.getCategory().name(), r.getImpact().name(),
                    r.getStatus().name(), r.getLat(), r.getLon(), r.getDescription(), r.getPhotoPath() != null,
                    r.isTemporary(), r.getExpiresAt(), r.getCreatedAt(), r.getUpdatedAt(), r.getLastConfirmedAt(),
                    r.getConfirmationCount(), r.getLanguage());
        }
    }

    public record StatusChange(@NotNull Status status, @Size(max = 1000) String note,
                               @Min(1) @Max(365) Integer extendDays) {
    }

    private final ObstacleService obstacles;
    private final PhotoStorage photos;
    private final JdbcTemplate jdbc;

    public AdminController(ObstacleService obstacles, PhotoStorage photos, JdbcTemplate jdbc) {
        this.obstacles = obstacles;
        this.photos = photos;
        this.jdbc = jdbc;
    }

    @GetMapping("/me")
    public Map<String, Object> me(Authentication auth) {
        return Map.of("username", auth.getName(),
                "roles", auth.getAuthorities().stream().map(a -> a.getAuthority().replace("ROLE_", "")).toList());
    }

    @GetMapping("/reports")
    @Operation(summary = "Reports for review, newest first")
    public Map<String, Object> reports(@RequestParam(defaultValue = "PENDING") List<Status> status,
                                       @RequestParam(defaultValue = "0") @Min(0) int page,
                                       @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        Set<Status> statuses = status.isEmpty() ? EnumSet.of(Status.PENDING) : EnumSet.copyOf(status);
        var p = obstacles.byStatus(statuses, page, size);
        return Map.of("items", p.getContent().stream().map(AdminReport::of).toList(),
                "page", p.getNumber(), "totalItems", p.getTotalElements(), "totalPages", p.getTotalPages());
    }

    @GetMapping("/reports/{id}")
    public Map<String, Object> report(@PathVariable UUID id) {
        return Map.of("report", AdminReport.of(obstacles.get(id)), "history", obstacles.history(id).stream()
                .map(h -> Map.of("from", h.getFromStatus() == null ? "" : h.getFromStatus(), "to", h.getToStatus(),
                        "by", h.getChangedBy(), "note", h.getNote() == null ? "" : h.getNote(),
                        "at", h.getChangedAt().toString()))
                .toList());
    }

    @PostMapping("/reports/{id}/status")
    @Operation(summary = "Verify, reject, resolve or expire a report")
    public AdminReport changeStatus(@PathVariable UUID id, @Valid @RequestBody StatusChange change, Principal who) {
        return AdminReport.of(obstacles.moderate(id, change.status(), change.note(), change.extendDays(),
                who.getName()));
    }

    @GetMapping("/reports/{id}/photo")
    public ResponseEntity<Resource> photo(@PathVariable UUID id) throws IOException {
        ObstacleReport r = obstacles.get(id);
        if (r.getPhotoPath() == null) {
            throw ApiException.notFound("PHOTO_NOT_FOUND", "Photo not found.");
        }
        var path = photos.resolve(r.getPhotoPath());
        return ResponseEntity.ok().contentType(MediaType.IMAGE_JPEG).contentLength(Files.size(path))
                .header("X-Content-Type-Options", "nosniff").body(new FileSystemResource(path));
    }

    @GetMapping("/ingestion-runs")
    @Operation(summary = "Recent data imports")
    public List<Map<String, Object>> ingestionRuns() {
        return jdbc.query("""
                SELECT id, region_code, source_code, started_at, finished_at, status, source_version, stats::text AS stats
                FROM ingestion_run ORDER BY started_at DESC LIMIT 20""",
                (rs, i) -> {
                    var m = new java.util.LinkedHashMap<String, Object>();
                    m.put("id", rs.getLong("id"));
                    m.put("region", rs.getString("region_code"));
                    m.put("source", rs.getString("source_code"));
                    m.put("startedAt", rs.getTimestamp("started_at").toInstant().toString());
                    var fin = rs.getTimestamp("finished_at");
                    m.put("finishedAt", fin == null ? null : fin.toInstant().toString());
                    m.put("status", rs.getString("status"));
                    m.put("sourceVersion", rs.getString("source_version"));
                    m.put("stats", Json.objectMap(rs.getString("stats")));
                    return m;
                });
    }
}
