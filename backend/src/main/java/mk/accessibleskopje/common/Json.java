package mk.accessibleskopje.common;

import java.util.LinkedHashMap;
import java.util.Map;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** Minimal JSON helpers for jsonb columns. */
public final class Json {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final TypeReference<LinkedHashMap<String, String>> STRING_MAP = new TypeReference<>() {
    };
    private static final TypeReference<LinkedHashMap<String, Object>> OBJECT_MAP = new TypeReference<>() {
    };

    private Json() {
    }

    public static Map<String, String> stringMap(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        return MAPPER.readValue(json, STRING_MAP);
    }

    public static Map<String, Object> objectMap(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        return MAPPER.readValue(json, OBJECT_MAP);
    }

    public static <T> T read(String json, Class<T> type) {
        return MAPPER.readValue(json, type);
    }

    public static String write(Object value) {
        return MAPPER.writeValueAsString(value);
    }
}
