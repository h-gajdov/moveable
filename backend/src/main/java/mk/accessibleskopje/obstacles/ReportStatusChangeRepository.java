package mk.accessibleskopje.obstacles;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface ReportStatusChangeRepository extends JpaRepository<ReportStatusChange, Long> {
    List<ReportStatusChange> findByReportIdOrderByChangedAtAsc(UUID reportId);
}
