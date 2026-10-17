-- Deterministic routing fixture (inside the Skopje region bbox).
--
--   4 ---e4--- 5 ---e5--- 6
--   |          |          |
--   e3        e7 (narrow) e6
--   |          |          |
--   1 ---e1--- 2 ---e2--- 3          7 ---e8--- 8   (island)
--             (e2 = STAIRS)
--
-- Horizontal edges are ~82.7 m, vertical ~111 m.
DELETE FROM obstacle_report;
DELETE FROM routing_edge;
DELETE FROM routing_node;

INSERT INTO routing_node (id, region_code, geom) VALUES
 (1, 'skopje', ST_SetSRID(ST_MakePoint(21.4300, 42.0000), 4326)),
 (2, 'skopje', ST_SetSRID(ST_MakePoint(21.4310, 42.0000), 4326)),
 (3, 'skopje', ST_SetSRID(ST_MakePoint(21.4320, 42.0000), 4326)),
 (4, 'skopje', ST_SetSRID(ST_MakePoint(21.4300, 42.0010), 4326)),
 (5, 'skopje', ST_SetSRID(ST_MakePoint(21.4310, 42.0010), 4326)),
 (6, 'skopje', ST_SetSRID(ST_MakePoint(21.4320, 42.0010), 4326)),
 (7, 'skopje', ST_SetSRID(ST_MakePoint(21.4500, 42.0000), 4326)),
 (8, 'skopje', ST_SetSRID(ST_MakePoint(21.4510, 42.0000), 4326));

INSERT INTO routing_edge (id, region_code, source, target, osm_way_id, way_segment, geom, length_m, highway, path_class, names, source_id)
SELECT v.id, 'skopje', v.s, v.t, v.way, 0,
       ST_MakeLine(a.geom, b.geom), ST_Length(ST_MakeLine(a.geom, b.geom)::geography),
       v.highway, v.pc, v.names::jsonb, (SELECT id FROM data_source WHERE code = 'osm')
FROM (VALUES
  (1, 1, 2, 101, 'footway', 'FOOTWAY', '{"default": "Тест улица", "latn": "Test ulica", "en": "Test Street"}'),
  (2, 2, 3, 102, 'steps',   'STEPS',   NULL),
  (3, 1, 4, 103, 'footway', 'FOOTWAY', NULL),
  (4, 4, 5, 104, 'footway', 'FOOTWAY', '{"default": "Горна", "en": "Upper Path"}'),
  (5, 5, 6, 105, 'footway', 'FOOTWAY', '{"default": "Горна", "en": "Upper Path"}'),
  (6, 6, 3, 106, 'footway', 'FOOTWAY', NULL),
  (7, 2, 5, 107, 'footway', 'FOOTWAY', NULL),
  (8, 7, 8, 108, 'footway', 'FOOTWAY', NULL)
) AS v(id, s, t, way, highway, pc, names)
JOIN routing_node a ON a.id = v.s
JOIN routing_node b ON b.id = v.t;

-- Every attribute unknown by default (NULL): unknown must never mean "excluded".
INSERT INTO edge_accessibility (edge_id, surface_class, is_stairs, completeness)
SELECT id, 'UNKNOWN', path_class = 'STEPS', 0 FROM routing_edge;

UPDATE edge_accessibility SET surface = 'asphalt', surface_class = 'SMOOTH', lit = true, completeness = 0.8
WHERE edge_id IN (3, 4, 5, 6);
UPDATE edge_accessibility SET width_m = 0.7 WHERE edge_id = 7;

UPDATE routing_node SET component_id = CASE WHEN id IN (7, 8) THEN 7 ELSE 1 END;
UPDATE routing_edge SET component_id = CASE WHEN id = 8 THEN 7 ELSE 1 END,
                        component_size = CASE WHEN id = 8 THEN 2 ELSE 6 END;
SELECT setval('routing_edge_id_seq', 100);
