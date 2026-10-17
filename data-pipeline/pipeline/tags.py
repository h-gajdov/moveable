"""Interpretation of OpenStreetMap tags for pedestrian accessibility routing.

Every function here is pure and deterministic so it can be unit-tested against
known tag combinations. The guiding rule: **a missing tag means "unknown", never
"accessible"**. Functions return ``None`` for unknown values instead of guessing.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Mapping, Optional

Tags = Mapping[str, str]

# ---------------------------------------------------------------------------
# Way classification
# ---------------------------------------------------------------------------

MINOR_ROADS = {"residential", "unclassified", "road", "living_street", "service"}
MAJOR_ROADS = {
    "tertiary", "tertiary_link", "secondary", "secondary_link",
    "primary", "primary_link", "trunk", "trunk_link",
}
MOTOR_ONLY = {"motorway", "motorway_link", "trunk", "trunk_link"}
NEVER_WALKABLE = {
    "construction", "proposed", "abandoned", "razed", "disused", "raceway",
    "bus_guideway", "escape", "elevator", "corridor", "busway",
}
FOOT_ALLOWED = {"yes", "designated", "permissive", "official"}
FOOT_FORBIDDEN = {"no", "use_sidepath", "private"}
ACCESS_FORBIDDEN = {
    "no", "private", "customers", "permit", "military", "agricultural",
    "forestry", "delivery", "emergency",
}

# Path classes (stored in routing_edge.path_class)
STEPS = "STEPS"
CROSSING = "CROSSING"
SIDEWALK = "SIDEWALK"
FOOTWAY = "FOOTWAY"
PEDESTRIAN = "PEDESTRIAN"
PATH = "PATH"
SHARED_PATH = "SHARED_PATH"
TRACK = "TRACK"
LIVING_STREET = "LIVING_STREET"
SERVICE = "SERVICE"
ROAD_WITH_SIDEWALK = "ROAD_WITH_SIDEWALK"
ROAD_SIDEWALK_SEPARATE = "ROAD_SIDEWALK_SEPARATE"
ROAD_NO_SIDEWALK = "ROAD_NO_SIDEWALK"
ROAD_SIDEWALK_UNKNOWN = "ROAD_SIDEWALK_UNKNOWN"

ROAD_CLASSES = {
    ROAD_WITH_SIDEWALK, ROAD_SIDEWALK_SEPARATE, ROAD_NO_SIDEWALK,
    ROAD_SIDEWALK_UNKNOWN, LIVING_STREET, SERVICE,
}


@dataclass(frozen=True)
class WayClass:
    path_class: str
    highway: str
    road_class: Optional[str]  # MINOR / MAJOR for carriageways, else None
    sidewalk: Optional[str]    # YES / NO / SEPARATE / None(unknown); roads only


def sidewalk_state(tags: Tags) -> Optional[str]:
    """Summarise the many sidewalk tagging schemes into YES / SEPARATE / NO / None."""
    values = []
    main = tags.get("sidewalk")
    if main is not None:
        if main in ("both", "left", "right", "yes"):
            values.append("yes")
        elif main in ("no", "none"):
            values.append("no")
        elif main == "separate":
            values.append("separate")
    for key in ("sidewalk:both", "sidewalk:left", "sidewalk:right"):
        v = tags.get(key)
        if v is None:
            continue
        if v in ("yes", "official", "designated"):
            values.append("yes")
        elif v in ("no", "none"):
            values.append("no")
        elif v == "separate":
            values.append("separate")
    if not values:
        return None
    if "yes" in values:
        return "YES"
    if "separate" in values:
        return "SEPARATE"
    return "NO"


def classify_way(tags: Tags) -> Optional[WayClass]:
    """Return the pedestrian classification of a way, or ``None`` if a pedestrian
    must not be routed along it (vehicle-only, private, under construction...)."""
    highway = tags.get("highway")
    if not highway or highway in NEVER_WALKABLE:
        return None
    if tags.get("indoor") == "yes":
        return None

    foot = tags.get("foot")
    access = tags.get("access")
    foot_ok = foot in FOOT_ALLOWED
    if foot in FOOT_FORBIDDEN:
        return None
    if access in ACCESS_FORBIDDEN and not foot_ok:
        return None
    if highway in MOTOR_ONLY and not foot_ok:
        return None
    if highway in ("bridleway",) and not foot_ok:
        return None
    # In North Macedonia a cycleway is not a pedestrian facility unless signed so.
    if highway == "cycleway" and not foot_ok:
        return None
    if tags.get("area") == "yes" and highway not in ("pedestrian", "footway"):
        return None  # e.g. parking-lot areas tagged as highway=service

    footway = tags.get("footway")
    if highway == "steps":
        return WayClass(STEPS, highway, None, None)
    if highway in ("footway", "path", "pedestrian", "cycleway") and (
        footway == "crossing" or tags.get("path") == "crossing"
    ):
        return WayClass(CROSSING, highway, None, None)
    if highway == "footway":
        return WayClass(SIDEWALK if footway == "sidewalk" else FOOTWAY, highway, None, None)
    if highway == "pedestrian":
        return WayClass(PEDESTRIAN, highway, None, None)
    if highway == "path":
        return WayClass(PATH, highway, None, None)
    if highway == "cycleway":
        return WayClass(SHARED_PATH, highway, None, None)
    if highway == "track":
        return WayClass(TRACK, highway, None, None)
    if highway == "living_street":
        return WayClass(LIVING_STREET, highway, "MINOR", sidewalk_state(tags))
    if highway == "service":
        return WayClass(SERVICE, highway, "MINOR", sidewalk_state(tags))
    if highway in MINOR_ROADS or highway in MAJOR_ROADS:
        road_class = "MAJOR" if highway in MAJOR_ROADS else "MINOR"
        state = sidewalk_state(tags)
        cls = {
            "YES": ROAD_WITH_SIDEWALK,
            "SEPARATE": ROAD_SIDEWALK_SEPARATE,
            "NO": ROAD_NO_SIDEWALK,
            None: ROAD_SIDEWALK_UNKNOWN,
        }[state]
        return WayClass(cls, highway, road_class, state)
    return None


def traffic_exposure(wc: WayClass, crossing_signals: Optional[bool] = None) -> int:
    """Vehicle-traffic exposure on a 0 (none) .. 4 (walking on a major road) scale."""
    pc = wc.path_class
    if pc in (FOOTWAY, PATH, PEDESTRIAN, STEPS, TRACK, SHARED_PATH):
        return 0
    if pc == SIDEWALK:
        return 1
    if pc == CROSSING:
        return 1 if crossing_signals else 2
    if pc == LIVING_STREET:
        return 1
    if pc == SERVICE:
        return 2 if wc.sidewalk != "YES" else 1
    major = wc.road_class == "MAJOR"
    if pc == ROAD_WITH_SIDEWALK:
        return 2 if major else 1
    if pc == ROAD_SIDEWALK_UNKNOWN:
        return 3 if major else 2
    # Walking on the carriageway: sidewalk explicitly absent, or mapped elsewhere.
    return 4 if major else 3


# ---------------------------------------------------------------------------
# Numeric attributes
# ---------------------------------------------------------------------------

_NUM = re.compile(r"[-+]?\d+(?:[.,]\d+)?")


def _first_number(value: str) -> Optional[float]:
    m = _NUM.search(value)
    if not m:
        return None
    return float(m.group(0).replace(",", "."))


def parse_width_m(value: Optional[str]) -> Optional[float]:
    """Parse OSM width values ("1.5", "1,5 m", "150 cm", "5'") into metres."""
    if value is None:
        return None
    v = value.strip().lower()
    n = _first_number(v)
    if n is None or n <= 0:
        return None
    if "cm" in v:
        n = n / 100.0
    elif "mm" in v:
        n = n / 1000.0
    elif "'" in v or "ft" in v:
        n = n * 0.3048
    if n > 50:  # implausible for a pedestrian facility; treat as bad data
        return None
    return round(n, 2)


def parse_incline(value: Optional[str]) -> tuple[Optional[float], Optional[str]]:
    """Return (signed incline in percent or None, qualitative hint or None).

    Qualitative values like ``up``/``down`` tell us there *is* a noticeable slope
    but not how steep it is, so the percentage stays unknown.
    """
    if value is None:
        return None, None
    v = value.strip().lower()
    if v in ("up", "down"):
        return None, v  # direction (relative to the way) without magnitude
    if v in ("yes", "steep"):
        return None, "steep" if v == "steep" else "incline"
    if v in ("no", "flat", "0"):
        return 0.0, None
    n = _first_number(v)
    if n is None:
        return None, None
    if "°" in v or "deg" in v:
        if abs(n) >= 90:
            return None, None
        n = math.tan(math.radians(n)) * 100.0
    if v.startswith("down") and n > 0:
        n = -n
    if abs(n) > 100:
        return None, None
    return round(n, 1), None


def parse_kerb_height_cm(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    v = value.strip().lower()
    n = _first_number(v)
    if n is None or n < 0:
        return None
    if "cm" in v:
        pass
    elif "mm" in v:
        n = n / 10.0
    elif v.endswith("m") or n < 0.5:
        n = n * 100.0  # metres
    if n > 60:
        return None
    return round(n, 1)


# Kerb severity: higher is worse for wheel users. None == unknown.
KERB_SEVERITY = {"flush": 0, "no": 0, "lowered": 1, "rolled": 1, "yes": 2, "raised": 3}


def kerb_type(tags: Tags) -> Optional[str]:
    k = tags.get("kerb")
    if k in KERB_SEVERITY:
        return "flush" if k == "no" else k
    if tags.get("barrier") == "kerb":
        return "yes"  # a kerb exists but its type is not documented
    return None


# ---------------------------------------------------------------------------
# Surface
# ---------------------------------------------------------------------------

SMOOTHNESS_CLASS = {
    "excellent": "SMOOTH", "good": "SMOOTH", "intermediate": "INTERMEDIATE",
    "bad": "ROUGH", "very_bad": "VERY_ROUGH", "horrible": "IMPASSABLE",
    "very_horrible": "IMPASSABLE", "impassable": "IMPASSABLE",
}
SURFACE_CLASS = {
    **{s: "SMOOTH" for s in ("asphalt", "concrete", "paved", "tartan", "rubber", "chipseal", "acrylic")},
    **{s: "INTERMEDIATE" for s in (
        "paving_stones", "concrete:plates", "concrete:lanes", "wood", "metal",
        "compacted", "fine_gravel", "bricks", "metal_grid", "paving_stones:lanes")},
    **{s: "ROUGH" for s in (
        "sett", "cobblestone", "unhewn_cobblestone", "gravel", "pebblestone",
        "unpaved", "ground", "dirt", "earth", "grass_paver", "woodchips", "stepping_stones")},
    **{s: "VERY_ROUGH" for s in ("sand", "mud", "grass", "rock", "stone")},
}


def surface_class(surface: Optional[str], smoothness: Optional[str]) -> str:
    """SMOOTH / INTERMEDIATE / ROUGH / VERY_ROUGH / IMPASSABLE / UNKNOWN.
    ``smoothness`` describes usability directly, so it wins over ``surface``."""
    if smoothness in SMOOTHNESS_CLASS:
        return SMOOTHNESS_CLASS[smoothness]
    if surface:
        first = surface.split(";")[0].strip()
        if first in SURFACE_CLASS:
            return SURFACE_CLASS[first]
    return "UNKNOWN"


# ---------------------------------------------------------------------------
# Crossings and barriers
# ---------------------------------------------------------------------------

def tri_state(value: Optional[str]) -> Optional[bool]:
    if value is None:
        return None
    v = value.strip().lower()
    if v in ("yes", "true", "1", "automatic", "24/7", "limited", "locate", "walk"):
        return True
    if v in ("no", "false", "0", "none", "disused"):
        return False
    return None


@dataclass
class CrossingInfo:
    crossing_type: Optional[str] = None   # SIGNALS / MARKED / UNMARKED / INFORMAL / NONE
    markings: Optional[bool] = None
    signals: Optional[bool] = None
    sound: Optional[bool] = None
    vibration: Optional[bool] = None
    button: Optional[bool] = None
    island: Optional[bool] = None
    tactile_paving: Optional[bool] = None

    def merge(self, other: "CrossingInfo") -> None:
        """Fill unknown fields from ``other`` without overwriting known values."""
        for f in self.__dataclass_fields__:
            if getattr(self, f) is None and getattr(other, f) is not None:
                setattr(self, f, getattr(other, f))


def crossing_info(tags: Tags) -> Optional[CrossingInfo]:
    """Normalise crossing tags on a crossing node or crossing way.

    Supports legacy ``crossing=zebra/marked/uncontrolled`` as well as the newer
    ``crossing:markings`` / ``crossing:signals`` scheme.
    """
    is_crossing = (
        tags.get("highway") == "crossing"
        or tags.get("footway") == "crossing"
        or tags.get("path") == "crossing"
        or "crossing" in tags
        or "crossing:markings" in tags
    )
    if not is_crossing:
        return None
    c = CrossingInfo()
    raw = (tags.get("crossing") or "").split(";")[0]
    markings = tags.get("crossing:markings")
    if raw == "traffic_signals" or tags.get("crossing:signals") == "yes":
        c.crossing_type, c.signals = "SIGNALS", True
    elif raw in ("marked", "zebra", "uncontrolled", "pelican", "toucan"):
        c.crossing_type = "MARKED"
    elif raw == "unmarked":
        c.crossing_type = "UNMARKED"
    elif raw == "informal":
        c.crossing_type = "INFORMAL"
    elif raw == "no":
        c.crossing_type = "NONE"
    if tags.get("crossing:signals") == "no" or raw in ("marked", "zebra", "uncontrolled", "unmarked"):
        c.signals = False if c.signals is None else c.signals
    if markings is not None:
        c.markings = markings != "no"
        if c.crossing_type is None:
            c.crossing_type = "MARKED" if c.markings else "UNMARKED"
    elif c.crossing_type == "MARKED":
        c.markings = True
    elif c.crossing_type == "UNMARKED":
        c.markings = False
    c.sound = tri_state(tags.get("traffic_signals:sound"))
    c.vibration = tri_state(tags.get("traffic_signals:vibration"))
    c.button = tri_state(tags.get("button_operated"))
    c.island = tri_state(tags.get("crossing:island"))
    c.tactile_paving = tri_state(tags.get("tactile_paving"))
    return c


# barrier=* values a wheelchair or mobility scooter usually cannot pass.
WHEELCHAIR_BLOCKING_BARRIERS = {
    "stile", "turnstile", "full-height_turnstile", "kissing_gate", "cycle_barrier",
    "motorcycle_barrier", "log", "chain", "step", "steps",
}
# barrier=* values that close the way for everyone.
ALL_BLOCKING_BARRIERS = {"fence", "wall", "hedge", "retaining_wall", "city_wall", "ditch"}


def barrier_effect(tags: Tags) -> Optional[str]:
    """Return ALL (impassable), WHEELCHAIR (blocks wheel users), MINOR, or None."""
    barrier = tags.get("barrier")
    if not barrier or barrier == "kerb":
        return None  # kerbs are handled by kerb_type()
    access = tags.get("access")
    foot = tags.get("foot")
    if barrier in ALL_BLOCKING_BARRIERS and foot not in FOOT_ALLOWED:
        return "ALL"
    if (access in ACCESS_FORBIDDEN or foot in FOOT_FORBIDDEN) and foot not in FOOT_ALLOWED:
        return "ALL"
    if tags.get("wheelchair") == "no" or barrier in WHEELCHAIR_BLOCKING_BARRIERS:
        return "WHEELCHAIR"
    return "MINOR"


def wheelchair_value(value: Optional[str]) -> Optional[str]:
    return value if value in ("yes", "limited", "no", "designated") else None


def lit_value(value: Optional[str]) -> Optional[bool]:
    return tri_state(value)
