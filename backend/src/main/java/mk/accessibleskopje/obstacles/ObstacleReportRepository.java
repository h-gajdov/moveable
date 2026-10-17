package mk.accessibleskopje.obstacles;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface ObstacleReportRepository extends JpaRepository<ObstacleReport, UUID> {

    Page<ObstacleReport> findByStatusInOrderByCreatedAtDesc(Collection<ObstacleReport.Status> statuses,
                                                            Pageable pageable);

    @Query("""
            SELECT r FROM ObstacleReport r
            WHERE r.status IN :statuses AND r.lon BETWEEN :minLon AND :maxLon AND r.lat BETWEEN :minLat AND :maxLat
              AND (r.expiresAt IS NULL OR r.expiresAt > :now)
            ORDER BY r.createdAt DESC LIMIT 500""")
    List<ObstacleReport> findInBox(Collection<ObstacleReport.Status> statuses, double minLon, double minLat,
                                   double maxLon, double maxLat, Instant now);

    @Query("""
            SELECT r FROM ObstacleReport r
            WHERE r.status IN (mk.accessibleskopje.obstacles.ObstacleReport.Status.PENDING,
                               mk.accessibleskopje.obstacles.ObstacleReport.Status.VERIFIED)
              AND r.expiresAt IS NOT NULL AND r.expiresAt <= :now""")
    List<ObstacleReport> findExpired(Instant now);

    @Query("""
            SELECT r FROM ObstacleReport r
            WHERE r.status = mk.accessibleskopje.obstacles.ObstacleReport.Status.PENDING
              AND r.lastConfirmedAt < :cutoff""")
    List<ObstacleReport> findStalePending(Instant cutoff);
}
