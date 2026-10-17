package mk.accessibleskopje;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

	@Bean
	@ServiceConnection
	PostgreSQLContainer postgresContainer() {
		// Same PostGIS + pgRouting image as production (see docker-compose.yml).
		return new PostgreSQLContainer(DockerImageName.parse("pgrouting/pgrouting:17-3.5-3.8.0")
				.asCompatibleSubstituteFor("postgres"));
	}

}
