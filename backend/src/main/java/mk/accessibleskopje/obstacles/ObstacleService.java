package mk.accessibleskopje.obstacles;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import mk.accessibleskopje.common.ApiException;
import mk.accessibleskopje.common.RegionService;
import mk.accessibleskopje.obstacles.ObstacleReport.Status;

@Service
public class ObstacleService {

    private static final Logger log = LoggerFactory.getLogger(ObstacleService.class);
    /** Unreviewed reports are considered outdated after this long without confirmation. */
    static final Duration PENDING_MAX_AGE = Duration.ofDays(60);

    /** Allowed moderation transitions. */
    static final Map<Status, Set<Status>> TRANSITIONS = Map.of(
            Status.PENDING, EnumSet.of(Status.VERIFIED, Status.REJECTED, Status.EXPIRED),
            Status.VERIFIED, EnumSet.of(Status.RESOLVED, Status.EXPIRED, Status.REJECTED),
            Status.RESOLVED, EnumSet.of(Status.VERIFIED),
            Status.EXPIRED, EnumSet.of(Status.VERIFIED, Status.PENDING),
            Status.REJECTED, EnumSet.of(Status.PENDING));

    public record CreateReport(double lat, double lon, ObstacleCategory category, ObstacleImpact impact,
                               String description, boolean temporary, Integer durationDays, String language) {
    }

    private final ObstacleReportRepository reports;
    private final ReportStatusChangeRepository history;
    private final PhotoStorage photos;
    private final RegionService regions;
    private final Clock clock;

    public ObstacleService(ObstacleReportRepository reports, ReportStatusChangeRepository history,
                           PhotoStorage photos, RegionService regions) {
        this.reports = reports;
        this.history = history;
        this.photos = photos;
        this.regions = regions;
        this.clock = Clock.systemUTC();
    }

    /** Strip control characters and normalise whitespace. Output is always rendered as text, never HTML. */
    static String sanitize(String text) {
        if (text == null) {
            return null;
        }
        String t = text.replaceAll("[\\p{Cntrl}&&[^\\n]]", " ").replaceAll("[ \\t]+", " ").strip();
        if (t.length() > 1000) {
            t = t.substring(0, 1000);
        }
        return t.isEmpty() ? null : t;
    }

    @Transactional
    public ObstacleReport create(CreateReport req, MultipartFile photo) {
        var region = regions.current();
        if (!region.contains(req.lat(), req.lon())) {
            throw ApiException.unprocessable("LOCATION_OUTSIDE_REGION", "The location is outside the supported area.");
        }
        Instant now = clock.instant();
        Instant expires = null;
        if (req.temporary()) {
            int days = req.durationDays() != null ? req.durationDays()
                    : req.category().defaultTemporaryDays() != null ? req.category().defaultTemporaryDays() : 7;
            expires = now.plus(Duration.ofDays(days));
        }
        String lang = req.language() != null && req.language().matches("mk|sq|en") ? req.language() : null;
        ObstacleReport r = new ObstacleReport(UUID.randomUUID(), region.code(), req.lat(), req.lon(), req.category(),
                req.impact(), sanitize(req.description()), req.temporary(), expires, lang, now);
        if (photo != null && !photo.isEmpty()) {
            r.setPhoto(photos.store(photo), "image/jpeg");
        }
        reports.save(r);
        history.save(new ReportStatusChange(r.getId(), null, Status.PENDING.name(), "public", null, now));
        return r;
    }

    @Transactional(readOnly = true)
    public List<ObstacleReport> inBox(double minLon, double minLat, double maxLon, double maxLat,
                                      boolean includeUnverified) {
        if (maxLon - minLon > 0.5 || maxLat - minLat > 0.5 || maxLon <= minLon || maxLat <= minLat) {
            throw ApiException.badRequest("BBOX_INVALID", "The requested area is invalid or too large.");
        }
        Set<Status> statuses = includeUnverified ? EnumSet.of(Status.VERIFIED, Status.PENDING)
                : EnumSet.of(Status.VERIFIED);
        return reports.findInBox(statuses, minLon, minLat, maxLon, maxLat, clock.instant());
    }

    @Transactional
    public ObstacleReport confirm(UUID id) {
        ObstacleReport r = get(id);
        if (r.getStatus() != Status.VERIFIED && r.getStatus() != Status.PENDING) {
            throw ApiException.unprocessable("REPORT_NOT_ACTIVE", "This report is no longer active.");
        }
        r.confirm(clock.instant());
        return r;
    }

    @Transactional(readOnly = true)
    public ObstacleReport get(UUID id) {
        return reports.findById(id).orElseThrow(() -> ApiException.notFound("REPORT_NOT_FOUND", "Report not found."));
    }

    @Transactional(readOnly = true)
    public Page<ObstacleReport> byStatus(Set<Status> statuses, int page, int size) {
        return reports.findByStatusInOrderByCreatedAtDesc(statuses, PageRequest.of(page, size));
    }

    @Transactional(readOnly = true)
    public List<ReportStatusChange> history(UUID id) {
        return history.findByReportIdOrderByChangedAtAsc(id);
    }

    @Transactional
    public ObstacleReport moderate(UUID id, Status next, String note, Integer extendDays, String moderator) {
        ObstacleReport r = get(id);
        Status from = r.getStatus();
        if (from != next && !TRANSITIONS.getOrDefault(from, Set.of()).contains(next)) {
            throw ApiException.unprocessable("INVALID_TRANSITION", "This status change is not allowed.");
        }
        Instant now = clock.instant();
        if (extendDays != null) {
            r.setExpiresAt(now.plus(Duration.ofDays(extendDays)));
        } else if (next == Status.VERIFIED && r.getExpiresAt() != null && r.getExpiresAt().isBefore(now)) {
            throw ApiException.unprocessable("EXPIRY_IN_PAST", "Set a new expiry before re-verifying a temporary report.");
        }
        r.changeStatus(next, now);
        history.save(new ReportStatusChange(id, from.name(), next.name(), moderator, sanitize(note), now));
        return r;
    }

    /** Hourly: expire temporary obstacles past their expiry and stale unreviewed reports. */
    @Scheduled(fixedDelayString = "PT1H", initialDelayString = "PT1M")
    @Transactional
    public void expireOutdated() {
        Instant now = clock.instant();
        int n = 0;
        for (ObstacleReport r : reports.findExpired(now)) {
            history.save(new ReportStatusChange(r.getId(), r.getStatus().name(), Status.EXPIRED.name(), "system",
                    "Temporary obstacle reached its expiry time", now));
            r.changeStatus(Status.EXPIRED, now);
            n++;
        }
        for (ObstacleReport r : reports.findStalePending(now.minus(PENDING_MAX_AGE))) {
            history.save(new ReportStatusChange(r.getId(), r.getStatus().name(), Status.EXPIRED.name(), "system",
                    "Not reviewed or confirmed for 60 days", now));
            r.changeStatus(Status.EXPIRED, now);
            n++;
        }
        if (n > 0) {
            log.info("expired {} obstacle reports", n);
        }
    }
}
