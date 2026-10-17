import math

import pytest

from pipeline import tags as T
from pipeline.translit import normalize_for_search, to_latin


@pytest.mark.parametrize("tags,expected", [
    ({"highway": "steps"}, T.STEPS),
    ({"highway": "footway", "footway": "crossing"}, T.CROSSING),
    ({"highway": "footway", "footway": "sidewalk"}, T.SIDEWALK),
    ({"highway": "footway"}, T.FOOTWAY),
    ({"highway": "pedestrian"}, T.PEDESTRIAN),
    ({"highway": "residential"}, T.ROAD_SIDEWALK_UNKNOWN),
    ({"highway": "secondary", "sidewalk": "both"}, T.ROAD_WITH_SIDEWALK),
    ({"highway": "secondary", "sidewalk:right": "yes", "sidewalk:left": "no"}, T.ROAD_WITH_SIDEWALK),
    ({"highway": "tertiary", "sidewalk": "separate"}, T.ROAD_SIDEWALK_SEPARATE),
    ({"highway": "tertiary", "sidewalk": "no"}, T.ROAD_NO_SIDEWALK),
    ({"highway": "cycleway", "foot": "designated"}, T.SHARED_PATH),
])
def test_classify_walkable(tags, expected):
    assert T.classify_way(tags).path_class == expected


@pytest.mark.parametrize("tags", [
    {"highway": "motorway"},
    {"highway": "trunk"},
    {"highway": "service", "access": "private"},
    {"highway": "footway", "foot": "no"},
    {"highway": "primary", "foot": "use_sidepath"},
    {"highway": "construction"},
    {"highway": "cycleway"},
    {"highway": "corridor"},
    {"building": "yes"},
])
def test_classify_not_walkable(tags):
    assert T.classify_way(tags) is None


def test_private_road_with_explicit_foot_access_is_walkable():
    assert T.classify_way({"highway": "service", "access": "private", "foot": "yes"}) is not None


def test_trunk_with_foot_yes_is_walkable():
    assert T.classify_way({"highway": "trunk", "foot": "yes"}).road_class == "MAJOR"


@pytest.mark.parametrize("raw,expected", [
    ("1.5", 1.5), ("1,5", 1.5), ("1.5 m", 1.5), ("150 cm", 1.5), ("3'", 0.91),
    ("abc", None), (None, None), ("-1", None), ("500", None),
])
def test_parse_width(raw, expected):
    assert T.parse_width_m(raw) == expected


@pytest.mark.parametrize("raw,pct,hint", [
    ("12%", 12.0, None), ("-6%", -6.0, None), ("0%", 0.0, None),
    ("up", None, "up"), ("down", None, "down"), ("yes", None, "incline"), ("steep", None, "steep"),
    (None, None, None), ("up_10%", 10.0, None),
])
def test_parse_incline(raw, pct, hint):
    assert T.parse_incline(raw) == (pct, hint)


def test_parse_incline_degrees():
    pct, _ = T.parse_incline("-45°")
    assert math.isclose(pct, -100.0, abs_tol=0.1)


@pytest.mark.parametrize("raw,cm", [("3 cm", 3.0), ("0.03", 3.0), ("12", 12.0), ("30 mm", 3.0), (None, None)])
def test_kerb_height(raw, cm):
    assert T.parse_kerb_height_cm(raw) == cm


def test_surface_class_prefers_smoothness():
    assert T.surface_class("asphalt", "bad") == "ROUGH"
    assert T.surface_class("asphalt", None) == "SMOOTH"
    assert T.surface_class("sett", None) == "ROUGH"
    assert T.surface_class(None, None) == "UNKNOWN"


def test_missing_tags_are_unknown_not_accessible():
    """A missing tag must never be interpreted as accessible."""
    assert T.surface_class(None, None) == "UNKNOWN"
    assert T.parse_width_m(None) is None
    assert T.kerb_type({}) is None
    assert T.wheelchair_value(None) is None
    assert T.lit_value(None) is None


def test_crossing_info_signals_and_sound():
    ci = T.crossing_info({"highway": "crossing", "crossing": "traffic_signals",
                          "traffic_signals:sound": "yes", "tactile_paving": "no"})
    assert ci.crossing_type == "SIGNALS"
    assert ci.signals is True
    assert ci.sound is True
    assert ci.tactile_paving is False


def test_crossing_info_new_scheme():
    ci = T.crossing_info({"highway": "crossing", "crossing:markings": "zebra"})
    assert ci.crossing_type == "MARKED"
    assert ci.markings is True
    assert ci.sound is None  # unknown, not "no"


def test_traffic_exposure_ordering():
    sep = T.classify_way({"highway": "footway"})
    sidewalk_road = T.classify_way({"highway": "primary", "sidewalk": "both"})
    no_sidewalk = T.classify_way({"highway": "primary", "sidewalk": "no"})
    assert T.traffic_exposure(sep) < T.traffic_exposure(sidewalk_road) < T.traffic_exposure(no_sidewalk)


def test_barriers():
    assert T.barrier_effect({"barrier": "turnstile"}) == "WHEELCHAIR"
    assert T.barrier_effect({"barrier": "gate", "access": "private"}) == "ALL"
    assert T.barrier_effect({"barrier": "bollard"}) == "MINOR"
    assert T.barrier_effect({"barrier": "kerb"}) is None


def test_transliteration():
    assert to_latin("Македонија") == "Makedonija"
    assert to_latin("Ѓорче Петров") == "Gjorche Petrov"
    assert to_latin("Џамија Мустафа Паша") == "Dzhamija Mustafa Pasha"
    assert normalize_for_search("Улица Македонија") == normalize_for_search("ulica makedonija")
    assert normalize_for_search("Çarshia e Vjetër") == "carshia e vjeter"
