package mk.accessibleskopje.obstacles;

import java.io.IOException;
import java.nio.file.Files;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import mk.accessibleskopje.common.ApiException;
import mk.accessibleskopje.common.RateLimiter;
import mk.accessibleskopje.config.AppProperties;
import mk.accessibleskopje.obstacles.ObstacleReport.Status;

@RestController
@RequestMapping("/api/obstacles")
@Validated
@Tag(name = "Obstacles")
public class ObstacleController {

    public record ReportRequest(
            @NotNull @DecimalMin("-90") @DecimalMax("90") Double lat,
            @NotNull @DecimalMin("-180") @DecimalMax("180") Double lon,
            @NotNull ObstacleCategory category,
            @NotNull ObstacleImpact impact,
            @Size(max = 1000) String description,
            Boolean temporary,
            @Min(1) @Max(90) Integer durationDays,
            @Pattern(regexp = "mk|sq|en") String language,
            /** Honeypot: must stay empty. Bots fill every field. */
            @Size(max = 200) String website) {
    }

    public record ReportCreated(String id, String status) {
    }

    /** Public view: unverified reports never expose free text or photos. */
    public record ObstacleView(String id, String category, String impact, String status, boolean verified,
                               double lat, double lon, String description, boolean hasPhoto, boolean temporary,
                               Instant expiresAt, Instant createdAt, Instant lastConfirmedAt, int confirmations) {

        static ObstacleView of(ObstacleReport r) {
            boolean verified = r.getStatus() == Status.VERIFIED;
            return new ObstacleView(r.getId().toString(), r.getCategory().name(), r.getImpact().name(),
                    r.getStatus().name(), verified, r.getLat(), r.getLon(), verified ? r.getDescription() : null,
                    verified && r.getPhotoPath() != null, r.isTemporary(), r.getExpiresAt(), r.getCreatedAt(),
                    r.getLastConfirmedAt(), r.getConfirmationCount());
        }
    }

    private final ObstacleService service;
    private final PhotoStorage photos;
    private final RateLimiter rateLimiter;
    private final AppProperties app;

    public ObstacleController(ObstacleService service, PhotoStorage photos, RateLimiter rateLimiter,
                              AppProperties app) {
        this.service = service;
        this.photos = photos;
        this.rateLimiter = rateLimiter;
        this.app = app;
    }

    @GetMapping
    @Operation(summary = "Known obstacles in a bounding box (verified, plus clearly-flagged unverified reports)")
    public List<ObstacleView> list(@RequestParam @Pattern(regexp = "-?\\d+(\\.\\d+)?(,-?\\d+(\\.\\d+)?){3}") String bbox,
                                   @RequestParam(defaultValue = "true") boolean includeUnverified) {
        String[] p = bbox.split(",");
        return service.inBox(Double.parseDouble(p[0]), Double.parseDouble(p[1]), Double.parseDouble(p[2]),
                Double.parseDouble(p[3]), includeUnverified).stream().map(ObstacleView::of).toList();
    }

    @PostMapping(path = "/reports", consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Submit an obstacle report (JSON, without photo)")
    public ReportCreated reportJson(@Valid @RequestBody ReportRequest req, HttpServletRequest http) {
        return create(req, null, http);
    }

    @PostMapping(path = "/reports", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Submit an obstacle report with an optional photo (multipart: 'report' JSON + 'photo')")
    public ReportCreated reportMultipart(@Valid @RequestPart("report") ReportRequest req,
                                         @RequestPart(name = "photo", required = false) MultipartFile photo,
                                         HttpServletRequest http) {
        return create(req, photo, http);
    }

    private ReportCreated create(ReportRequest req, MultipartFile photo, HttpServletRequest http) {
        var rl = app.rateLimit();
        rateLimiter.check("reports", http.getRemoteAddr(), rl.reportsPerWindow(), rl.windowSeconds());
        if (req.website() != null && !req.website().isBlank()) {
            // Honeypot triggered: respond as if accepted, store nothing.
            return new ReportCreated(UUID.randomUUID().toString(), Status.PENDING.name());
        }
        ObstacleReport r = service.create(new ObstacleService.CreateReport(req.lat(), req.lon(), req.category(),
                req.impact(), req.description(), Boolean.TRUE.equals(req.temporary()), req.durationDays(),
                req.language()), photo);
        return new ReportCreated(r.getId().toString(), r.getStatus().name());
    }

    @PostMapping("/{id}/confirm")
    @Operation(summary = "Confirm that an obstacle is still present")
    public ObstacleView confirm(@PathVariable UUID id, HttpServletRequest http) {
        var rl = app.rateLimit();
        rateLimiter.check("confirm:" + id, http.getRemoteAddr(), 1, 86_400);
        rateLimiter.check("confirm", http.getRemoteAddr(), rl.confirmationsPerWindow(), rl.windowSeconds());
        return ObstacleView.of(service.confirm(id));
    }

    @GetMapping("/{id}/photo")
    @Operation(summary = "Photo of a verified report")
    public ResponseEntity<Resource> photo(@PathVariable UUID id) throws IOException {
        ObstacleReport r = service.get(id);
        if (r.getStatus() != Status.VERIFIED || r.getPhotoPath() == null) {
            throw ApiException.notFound("PHOTO_NOT_FOUND", "Photo not found.");
        }
        var path = photos.resolve(r.getPhotoPath());
        return ResponseEntity.ok().contentType(MediaType.IMAGE_JPEG).contentLength(Files.size(path))
                .cacheControl(CacheControl.noCache()).header("X-Content-Type-Options", "nosniff")
                .body(new FileSystemResource(path));
    }
}
