import os

import pytest

from pipeline.graph import read_osm
from pipeline.graph import is_disabled_parking, _Reader


@pytest.mark.parametrize("tags, expected", [
    ({"amenity": "parking_space", "parking_space": "disabled"}, True),
    ({"amenity": "parking", "capacity:disabled": "2"}, True),
    ({"amenity": "parking", "capacity:disabled": "yes"}, True),
    ({"amenity": "parking", "capacity:disabled": "0"}, False),
    ({"amenity": "parking", "capacity:disabled": "unknown"}, False),
    ({"amenity": "parking", "wheelchair": "yes"}, False),
    ({"amenity": "parking_space", "parking_space": "disabled", "access": "private"}, False),
    ({"amenity": "cafe", "capacity:disabled": "2"}, False),
])
def test_disabled_parking_requires_explicit_evidence(tags, expected):
    assert is_disabled_parking(tags) is expected


def test_unnamed_disabled_parking_is_imported_inside_region():
    reader = _Reader((21, 41, 22, 42))
    tags = {"amenity": "parking_space", "parking_space": "disabled"}
    reader._maybe_place("N", 1, tags, 21.4, 41.9)
    reader._maybe_place("W", 2, tags, 21.5, 41.9)
    reader._maybe_place("N", 3, tags, 23, 43)
    assert len(reader.places) == 2
    assert all(p.category == "parking=disabled" and p.names == {} for p in reader.places)

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "mini.osm")


@pytest.fixture(scope="module")
def graph():
    return read_osm(FIXTURE)


def edge(graph, way_id, segment=0):
    return next(e for e in graph.edges if e.osm_way_id == way_id and e.segment == segment)


def test_excludes_private_and_motorway(graph):
    way_ids = {e.osm_way_id for e in graph.edges}
    assert 105 not in way_ids  # access=private
    assert 106 not in way_ids  # motorway


def test_ways_split_at_shared_nodes(graph):
    # Sidewalk 100 is split at node 2 (shared with the steps).
    segs = [e for e in graph.edges if e.osm_way_id == 100]
    assert [(e.source, e.target) for e in segs] == [(1, 2), (2, 3)]


def test_crossing_way_split_at_crossing_node_and_gets_node_attributes(graph):
    segs = [e for e in graph.edges if e.osm_way_id == 101]
    assert [(e.source, e.target) for e in segs] == [(3, 4), (4, 5)]
    for e in segs:
        ci = e.attrs["crossing"]
        assert ci.crossing_type == "SIGNALS"
        assert ci.sound is True
        assert e.attrs["tactile_paving"] is True


def test_kerb_attached_to_crossing_not_sidewalk(graph):
    assert edge(graph, 101, 0).attrs["kerb_type"] == "raised"
    assert edge(graph, 101, 1).attrs["kerb_type"] == "lowered"
    # The sidewalk ending at the raised-kerb node is not itself a kerb.
    assert edge(graph, 100, 1).attrs["kerb_type"] is None


def test_steps_flagged(graph):
    steps = edge(graph, 104)
    assert steps.attrs["is_stairs"] is True
    assert steps.attrs["incline_hint"] == "up"


def test_sidewalk_attributes_and_names(graph):
    e = edge(graph, 100)
    assert e.attrs["surface_class"] == "INTERMEDIATE"
    assert e.attrs["width_m"] == 2.5
    assert e.names["default"] == "Македонија"
    assert e.names["sq"] == "Maqedonia"
    assert e.names["latn"] == "Makedonija"


def test_unknown_values_stay_unknown(graph):
    road = edge(graph, 107)
    assert road.wc.path_class == "ROAD_SIDEWALK_UNKNOWN"
    assert road.attrs["surface_class"] == "UNKNOWN"
    assert road.attrs["lit"] is None
    assert road.attrs["completeness"] == 0.0


def test_lengths_are_metric(graph):
    # 0.001 deg of longitude at 42N is ~82.7 m
    assert 80 < edge(graph, 100, 0).length_m < 85


def test_bench_and_places(graph):
    assert len(graph.benches) == 1
    names = [p.names.get("default") for p in graph.places]
    assert "Аптека Центар" in names
    assert any(p.kind == "STREET" and p.names.get("default") == "Македонија" for p in graph.places)
