package mk.accessibleskopje.config;

import java.io.IOException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import mk.accessibleskopje.admin.AdminUser;
import mk.accessibleskopje.admin.AdminUserRepository;

/**
 * Public API endpoints need no account. Only {@code /api/admin/**} requires
 * authentication (HTTP Basic over HTTPS, stateless, no cookies — so CSRF does not apply).
 */
@Configuration
public class SecurityConfig {

    private static final Logger log = LoggerFactory.getLogger(SecurityConfig.class);

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                .csrf(c -> c.disable())
                .cors(c -> {
                })
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(a -> a
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/api/admin/**").hasAnyRole("ADMIN", "MODERATOR")
                        .anyRequest().permitAll())
                .httpBasic(b -> b.authenticationEntryPoint(jsonEntryPoint()))
                .exceptionHandling(e -> e.authenticationEntryPoint(jsonEntryPoint()))
                .headers(h -> h
                        .referrerPolicy(r -> r.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER))
                        .frameOptions(f -> f.deny()));
        return http.build();
    }

    /** 401 as JSON without {@code WWW-Authenticate}, so browsers do not show a native login popup. */
    private static AuthenticationEntryPoint jsonEntryPoint() {
        return (request, response, ex) -> {
            response.setStatus(HttpStatus.UNAUTHORIZED.value());
            response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
            try {
                response.getWriter().write("{\"type\":\"urn:accessible-skopje:error:UNAUTHORIZED\","
                        + "\"title\":\"Unauthorized\",\"status\":401,\"code\":\"UNAUTHORIZED\","
                        + "\"detail\":\"Sign in to continue.\"}");
            } catch (IOException ignored) {
                // client went away
            }
        };
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    UserDetailsService userDetailsService(AdminUserRepository users) {
        return username -> users.findByUsername(username)
                .filter(AdminUser::isEnabled)
                .map(u -> User.withUsername(u.getUsername()).password(u.getPasswordHash()).roles(u.getRole()).build())
                .orElseThrow(() -> new UsernameNotFoundException("not found"));
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(AppProperties props) {
        CorsConfiguration c = new CorsConfiguration();
        c.setAllowedOrigins(props.corsAllowedOrigins());
        c.addAllowedMethod("GET");
        c.addAllowedMethod("POST");
        c.addAllowedHeader("Content-Type");
        c.addAllowedHeader("Authorization");
        c.addAllowedHeader("Accept-Language");
        c.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", c);
        return source;
    }

    /** Creates the first administrator from environment variables if none exists. */
    @Bean
    ApplicationRunner bootstrapAdmin(AdminUserRepository users, PasswordEncoder encoder, AppProperties props) {
        return args -> {
            var a = props.admin();
            if (users.count() > 0 || a == null || a.bootstrapUsername() == null || a.bootstrapUsername().isBlank()) {
                return;
            }
            if (a.bootstrapPassword() == null || a.bootstrapPassword().length() < 12) {
                log.warn("ADMIN_PASSWORD missing or shorter than 12 characters; no administrator created");
                return;
            }
            users.save(new AdminUser(a.bootstrapUsername(), encoder.encode(a.bootstrapPassword()), "ADMIN"));
            log.info("created bootstrap administrator '{}'", a.bootstrapUsername());
        };
    }
}
