package mk.accessibleskopje.common;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HexFormat;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * In-memory sliding-window rate limiter. Client keys (IP addresses) are hashed
 * with a per-process random salt and never persisted, so no personal data is
 * stored for abuse prevention.
 */
@Component
public class RateLimiter {

    private final ConcurrentHashMap<String, Deque<Long>> windows = new ConcurrentHashMap<>();
    private final byte[] salt = new byte[16];
    private final Clock clock;

    public RateLimiter() {
        this(Clock.systemUTC());
    }

    RateLimiter(Clock clock) {
        this.clock = clock;
        new SecureRandom().nextBytes(salt);
    }

    /** Throws 429 if {@code key} already made {@code limit} calls within the window. */
    public void check(String bucket, String clientKey, int limit, int windowSeconds) {
        String key = bucket + ":" + hash(clientKey);
        long now = clock.millis();
        long cutoff = now - windowSeconds * 1000L;
        Deque<Long> q = windows.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (q) {
            while (!q.isEmpty() && q.peekFirst() < cutoff) {
                q.pollFirst();
            }
            if (q.size() >= limit) {
                throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED",
                        "Too many requests. Please wait a few minutes and try again.");
            }
            q.addLast(now);
        }
    }

    @Scheduled(fixedDelay = 300_000)
    void cleanup() {
        long cutoff = clock.millis() - 3_600_000L;
        windows.entrySet().removeIf(e -> {
            synchronized (e.getValue()) {
                return e.getValue().isEmpty() || e.getValue().peekLast() < cutoff;
            }
        });
    }

    private String hash(String value) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(salt);
            return HexFormat.of().formatHex(md.digest(value.getBytes(StandardCharsets.UTF_8)), 0, 12);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
