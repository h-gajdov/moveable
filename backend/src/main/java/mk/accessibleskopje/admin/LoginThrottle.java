package mk.accessibleskopje.admin;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.context.event.EventListener;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.event.AuthenticationFailureBadCredentialsEvent;
import org.springframework.security.web.authentication.WebAuthenticationDetails;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/** Blocks admin authentication from an address after repeated failed logins (in memory only). */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class LoginThrottle extends OncePerRequestFilter {

    static final int MAX_FAILURES = 10;
    static final Duration WINDOW = Duration.ofMinutes(15);

    private record Failures(int count, Instant since) {
    }

    private final ConcurrentHashMap<String, Failures> failures = new ConcurrentHashMap<>();

    @EventListener
    public void onFailure(AuthenticationFailureBadCredentialsEvent event) {
        if (event.getAuthentication().getDetails() instanceof WebAuthenticationDetails d && d.getRemoteAddress() != null) {
            Instant now = Instant.now();
            failures.compute(d.getRemoteAddress(), (k, f) -> f == null || f.since().plus(WINDOW).isBefore(now)
                    ? new Failures(1, now) : new Failures(f.count() + 1, f.since()));
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/admin");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        Failures f = failures.get(req.getRemoteAddr());
        if (f != null && f.count() >= MAX_FAILURES && f.since().plus(WINDOW).isAfter(Instant.now())) {
            res.setStatus(429);
            res.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
            res.getWriter().write("{\"status\":429,\"code\":\"RATE_LIMITED\",\"detail\":\"Too many failed sign-in attempts. Try again later.\"}");
            return;
        }
        chain.doFilter(req, res);
    }
}
