package mk.accessibleskopje.routing;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import mk.accessibleskopje.common.RateLimiter;
import mk.accessibleskopje.config.AppProperties;
import mk.accessibleskopje.routing.RouteApi.RouteRequest;
import mk.accessibleskopje.routing.RouteApi.RouteResponse;

@RestController
@RequestMapping("/api")
@Tag(name = "Routing")
public class RouteController {

    private final RoutingService routing;
    private final ProfileService profiles;
    private final RateLimiter rateLimiter;
    private final AppProperties app;

    public RouteController(RoutingService routing, ProfileService profiles, RateLimiter rateLimiter, AppProperties app) {
        this.routing = routing;
        this.profiles = profiles;
        this.rateLimiter = rateLimiter;
        this.app = app;
    }

    @PostMapping("/routes")
    @Operation(summary = "Calculate accessibility-aware pedestrian routes",
            description = "Returns up to three meaningfully different routes, or an explanation if no route "
                    + "satisfies the hard constraints. Locations are not stored.")
    public RouteResponse route(@Valid @RequestBody RouteRequest request, HttpServletRequest http) {
        var rl = app.rateLimit();
        rateLimiter.check("routes", http.getRemoteAddr(), rl.routesPerWindow(), rl.windowSeconds());
        return routing.route(request);
    }

    @GetMapping("/routing-profiles")
    @Operation(summary = "List routing profiles and the configurable preferences")
    public Map<String, Object> profiles() {
        List<Map<String, Object>> list = profiles.list().stream()
                .map(p -> Map.<String, Object>of("code", p.code(), "defaults", p.defaults())).toList();
        return Map.of("profiles", list, "settings", ProfileService.settingsSchema());
    }
}
