package mk.accessibleskopje.obstacles;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "report_status_history")
public class ReportStatusChange {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "report_id")
    private UUID reportId;
    @Column(name = "from_status")
    private String fromStatus;
    @Column(name = "to_status")
    private String toStatus;
    @Column(name = "changed_by")
    private String changedBy;
    private String note;
    @Column(name = "changed_at")
    private Instant changedAt;

    protected ReportStatusChange() {
    }

    public ReportStatusChange(UUID reportId, String fromStatus, String toStatus, String changedBy, String note,
                              Instant changedAt) {
        this.reportId = reportId;
        this.fromStatus = fromStatus;
        this.toStatus = toStatus;
        this.changedBy = changedBy;
        this.note = note;
        this.changedAt = changedAt;
    }

    public Long getId() { return id; }
    public UUID getReportId() { return reportId; }
    public String getFromStatus() { return fromStatus; }
    public String getToStatus() { return toStatus; }
    public String getChangedBy() { return changedBy; }
    public String getNote() { return note; }
    public Instant getChangedAt() { return changedAt; }
}
