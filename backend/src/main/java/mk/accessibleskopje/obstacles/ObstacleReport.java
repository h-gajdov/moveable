package mk.accessibleskopje.obstacles;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

@Entity
@Table(name = "obstacle_report")
public class ObstacleReport {

    public enum Status { PENDING, VERIFIED, REJECTED, RESOLVED, EXPIRED }

    @Id
    private UUID id;
    @Column(name = "region_code", nullable = false)
    private String regionCode;
    private double lat;
    private double lon;
    @Enumerated(EnumType.STRING)
    private ObstacleCategory category;
    @Enumerated(EnumType.STRING)
    private ObstacleImpact impact;
    private String description;
    @Column(name = "is_temporary")
    private boolean temporary;
    @Column(name = "expires_at")
    private Instant expiresAt;
    @Enumerated(EnumType.STRING)
    private Status status;
    @Column(name = "photo_path")
    private String photoPath;
    @Column(name = "photo_content_type")
    private String photoContentType;
    private String language;
    @Column(name = "confirmation_count")
    private int confirmationCount;
    @Column(name = "created_at")
    private Instant createdAt;
    @Column(name = "updated_at")
    private Instant updatedAt;
    @Column(name = "last_confirmed_at")
    private Instant lastConfirmedAt;
    @Version
    private long version;

    protected ObstacleReport() {
    }

    public ObstacleReport(UUID id, String regionCode, double lat, double lon, ObstacleCategory category,
                          ObstacleImpact impact, String description, boolean temporary, Instant expiresAt,
                          String language, Instant now) {
        this.id = id;
        this.regionCode = regionCode;
        this.lat = lat;
        this.lon = lon;
        this.category = category;
        this.impact = impact;
        this.description = description;
        this.temporary = temporary;
        this.expiresAt = expiresAt;
        this.language = language;
        this.status = Status.PENDING;
        this.createdAt = now;
        this.updatedAt = now;
        this.lastConfirmedAt = now;
    }

    public UUID getId() { return id; }
    public String getRegionCode() { return regionCode; }
    public double getLat() { return lat; }
    public double getLon() { return lon; }
    public ObstacleCategory getCategory() { return category; }
    public ObstacleImpact getImpact() { return impact; }
    public String getDescription() { return description; }
    public boolean isTemporary() { return temporary; }
    public Instant getExpiresAt() { return expiresAt; }
    public Status getStatus() { return status; }
    public String getPhotoPath() { return photoPath; }
    public String getPhotoContentType() { return photoContentType; }
    public String getLanguage() { return language; }
    public int getConfirmationCount() { return confirmationCount; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public Instant getLastConfirmedAt() { return lastConfirmedAt; }

    public void setPhoto(String path, String contentType) {
        this.photoPath = path;
        this.photoContentType = contentType;
    }

    public void changeStatus(Status next, Instant now) {
        this.status = next;
        this.updatedAt = now;
        if (next == Status.VERIFIED) {
            this.lastConfirmedAt = now;
        }
    }

    public void setExpiresAt(Instant expiresAt) {
        this.expiresAt = expiresAt;
    }

    public void confirm(Instant now) {
        this.confirmationCount++;
        this.lastConfirmedAt = now;
        this.updatedAt = now;
    }
}
