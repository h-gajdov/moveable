"""Build a pedestrian routing graph (nodes + edges with accessibility attributes)
from an OSM extract.

Design notes
------------
* Routing node ids are the original OSM node ids (traceability).
* Ways are split at every node shared with another pedestrian way, and also at
  crossing, kerb and barrier nodes so those features become explicit routing
  nodes that the backend can report on.
* Attributes on *nodes* (kerbs, crossings, barriers) are attached to edges with
  explicit rules (see ``_attach_node_features``), because walking past a kerb
  node along a sidewalk is not the same as stepping down it.
* Nothing is inferred as "accessible" when data is missing.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Optional

import osmium
from pyproj import Geod

from . import tags as T
from .translit import has_cyrillic, normalize_for_search, to_latin

log = logging.getLogger(__name__)
GEOD = Geod(ellps="WGS84")

NAME_KEYS = ("name", "name:mk", "name:sq", "name:en")
POI_KEYS = ("amenity", "shop", "tourism", "leisure", "office", "healthcare",
            "public_transport", "railway", "historic", "building", "place")
POI_SKIP_VALUES = {"bench", "waste_basket", "parking_space", "vending_machine", "yes"}


@dataclass
class NodeFeature:
    osm_id: int
    lon: float
    lat: float
    tags: dict


@dataclass
class Way:
    osm_id: int
    wc: T.WayClass
    tags: dict
    refs: list[int]
    coords: list[tuple[float, float]]


@dataclass
class Edge:
    osm_way_id: int
    segment: int
    source: int
    target: int
    coords: list[tuple[float, float]]
    length_m: float
    wc: T.WayClass
    names: dict
    attrs: dict = field(default_factory=dict)
    # (attribute, value, method, osm_tag) for the provenance table
    provenance: list[tuple[str, str, str, str]] = field(default_factory=list)


@dataclass
class Place:
    osm_type: str
    osm_id: int
    kind: str
    category: Optional[str]
    names: dict
    search_text: str
    lon: float
    lat: float
    rank: int


@dataclass
class Graph:
    nodes: dict[int, tuple[float, float]]
    node_tags: dict[int, dict]
    edges: list[Edge]
    benches: list[NodeFeature]
    features: list[NodeFeature]
    places: list[Place]
    stats: dict


def names_of(tags: dict) -> dict:
    names = {k.replace("name:", "") if k != "name" else "default": tags[k]
             for k in NAME_KEYS if tags.get(k)}
    base = tags.get("name:mk") or tags.get("name")
    if base and has_cyrillic(base):
        names["latn"] = to_latin(base)
    return names


def is_disabled_parking(tags: dict) -> bool:
    """Require explicit reserved-parking evidence; wheelchair=yes alone is insufficient."""
    if tags.get("amenity") not in ("parking", "parking_space"):
        return False
    if tags.get("access") in ("private", "no") or tags.get("disabled") == "no":
        return False
    capacity = tags.get("capacity:disabled", "")
    return (tags.get("parking_space") == "disabled"
            or tags.get("disabled") == "designated"
            or capacity == "yes"
            or (capacity.isascii() and capacity.isdigit() and int(capacity) > 0))


# ---------------------------------------------------------------------------
# OSM reading
# ---------------------------------------------------------------------------

INTERESTING_NODE_KEYS = ("highway", "crossing", "kerb", "barrier", "tactile_paving",
                         "traffic_signals:sound", "crossing:markings")


class _Reader(osmium.SimpleHandler):
    def __init__(self, bbox: Optional[tuple[float, float, float, float]]):
        super().__init__()
        self.bbox = bbox
        self.ways: list[Way] = []
        self.node_tags: dict[int, dict] = {}
        self.benches: list[NodeFeature] = []
        self.features: list[NodeFeature] = []
        self.places: list[Place] = []
        self.street_parts: dict[str, list] = defaultdict(list)

    def _inside(self, lon: float, lat: float) -> bool:
        if not self.bbox:
            return True
        return self.bbox[0] <= lon <= self.bbox[2] and self.bbox[1] <= lat <= self.bbox[3]

    def node(self, n):
        if not n.location.valid():
            return
        tags = {t.k: t.v for t in n.tags}
        if not tags:
            return
        lon, lat = n.location.lon, n.location.lat
        if any(k in tags for k in INTERESTING_NODE_KEYS):
            self.node_tags[n.id] = tags
        amenity = tags.get("amenity")
        if amenity == "bench" or tags.get("leisure") == "picnic_table":
            self.benches.append(NodeFeature(n.id, lon, lat, tags))
        elif amenity == "toilets" or tags.get("highway") == "elevator" \
                or tags.get("wheelchair") in ("yes", "limited", "no"):
            self.features.append(NodeFeature(n.id, lon, lat, tags))
        self._maybe_place("N", n.id, tags, lon, lat)

    def _maybe_place(self, osm_type: str, osm_id: int, tags: dict, lon: float, lat: float):
        if not self._inside(lon, lat):
            return
        names = names_of(tags)
        if is_disabled_parking(tags):
            self.places.append(Place(osm_type, osm_id, "POI", "parking=disabled", names,
                                     _search_text(names), lon, lat, 20))
        elif names:
            cat = next(((k, tags[k]) for k in POI_KEYS if k in tags and tags[k] not in POI_SKIP_VALUES), None)
            if cat is None and "building" not in tags:
                return
            category = f"{cat[0]}={cat[1]}" if cat else "building"
            rank = 30 if cat and cat[0] in ("place", "railway", "public_transport", "tourism") else 20
            self.places.append(Place(osm_type, osm_id, "POI", category, names,
                                     _search_text(names), lon, lat, rank))
        elif tags.get("addr:street") and tags.get("addr:housenumber"):
            label = f"{tags['addr:street']} {tags['addr:housenumber']}"
            names = names_of({"name": label})
            self.places.append(Place(osm_type, osm_id, "ADDRESS", "address", names,
                                     _search_text(names), lon, lat, 10))

    def way(self, w):
        tags = {t.k: t.v for t in w.tags}
        if not tags:
            return
        coords = []
        try:
            for nd in w.nodes:
                if not nd.location.valid():
                    return
                coords.append((nd.location.lon, nd.location.lat))
        except osmium.InvalidLocationError:
            return
        if not coords:
            return
        wc = T.classify_way(tags) if "highway" in tags else None
        if wc is not None and len(coords) >= 2:
            refs = [nd.ref for nd in w.nodes]
            self.ways.append(Way(w.id, wc, tags, refs, coords))
            if tags.get("name") and wc.path_class not in (T.CROSSING,):
                self.street_parts[tags["name"]].append((tags, coords))
        elif "highway" not in tags:
            # Named buildings / amenities mapped as areas -> searchable place at centroid.
            if is_disabled_parking(tags) or names_of(tags) or (tags.get("addr:street") and tags.get("addr:housenumber")):
                lon = sum(c[0] for c in coords) / len(coords)
                lat = sum(c[1] for c in coords) / len(coords)
                self._maybe_place("W", w.id, tags, lon, lat)


def _search_text(names: dict) -> str:
    seen = []
    for v in names.values():
        n = normalize_for_search(v)
        if n and n not in seen:
            seen.append(n)
    return " | ".join(seen)


def _line_length(coords: list[tuple[float, float]]) -> float:
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return float(GEOD.line_length(lons, lats))


def _street_places(street_parts: dict[str, list], bbox) -> list[Place]:
    places = []
    for name, parts in street_parts.items():
        # One search entry per street name, placed at the middle of its longest part.
        tags, coords = max(parts, key=lambda p: _line_length(p[1]))
        mid = coords[len(coords) // 2]
        if bbox and not (bbox[0] <= mid[0] <= bbox[2] and bbox[1] <= mid[1] <= bbox[3]):
            continue
        names = names_of(tags)
        places.append(Place("W", 0, "STREET", f"highway={tags.get('highway')}", names,
                            _search_text(names), mid[0], mid[1], 25))
    return places


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def _is_split_node(tags: Optional[dict]) -> bool:
    if not tags:
        return False
    return (tags.get("highway") == "crossing" or "crossing" in tags or "kerb" in tags
            or "barrier" in tags)


def build_graph(ways: list[Way], node_tags: dict[int, dict]) -> tuple[dict, list[Edge]]:
    usage: dict[int, int] = defaultdict(int)
    road_nodes: set[int] = set()
    for w in ways:
        for ref in set(w.refs):
            usage[ref] += 1
        if w.wc.path_class in T.ROAD_CLASSES:
            road_nodes.update(w.refs)

    nodes: dict[int, tuple[float, float]] = {}
    edges: list[Edge] = []
    for w in ways:
        # Drop consecutive duplicate nodes (bad data)
        refs, coords = [w.refs[0]], [w.coords[0]]
        for r, c in zip(w.refs[1:], w.coords[1:]):
            if r != refs[-1]:
                refs.append(r)
                coords.append(c)
        if len(refs) < 2:
            continue
        names = names_of(w.tags)
        # Closed ways (e.g. pedestrian-area outlines) are split halfway so no edge
        # is a self-loop.
        forced_split = len(refs) // 2 if refs[0] == refs[-1] and len(refs) > 3 else -1
        start = 0
        seg = 0
        for i in range(1, len(refs)):
            last = i == len(refs) - 1
            if last or i == forced_split or usage[refs[i]] > 1 or _is_split_node(node_tags.get(refs[i])):
                seg_coords = coords[start:i + 1]
                length = _line_length(seg_coords)
                if length > 0.05:
                    e = Edge(w.osm_id, seg, refs[start], refs[i], seg_coords, length, w.wc, names)
                    e.attrs["_interior"] = refs[start + 1:i]
                    edges.append(e)
                    nodes[refs[start]] = coords[start]
                    nodes[refs[i]] = coords[i]
                    seg += 1
                start = i
        for e in edges[-seg:] if seg else []:
            _apply_way_attributes(e, w)

    _attach_node_features(edges, node_tags, road_nodes)
    for e in edges:
        e.attrs.pop("_interior", None)
        _finalise(e)
    return nodes, edges


def _prov(e: Edge, attr: str, value, method: str, tag: str) -> None:
    if value is not None:
        e.provenance.append((attr, str(value), method, tag))


def _apply_way_attributes(e: Edge, w: Way) -> None:
    t = w.tags
    a = e.attrs
    pc = w.wc.path_class
    on_road = pc in T.ROAD_CLASSES and pc not in (T.LIVING_STREET,)

    # For roads with sidewalks, prefer sidewalk:* sub-tags describing the sidewalk itself.
    def pick(*keys):
        for k in keys:
            if t.get(k) is not None:
                return t[k], k
        return None, None

    if pc == T.ROAD_WITH_SIDEWALK:
        surface, s_tag = pick("sidewalk:both:surface", "sidewalk:surface", "sidewalk:right:surface",
                              "sidewalk:left:surface", "footway:surface")
        smooth, sm_tag = pick("sidewalk:both:smoothness", "sidewalk:smoothness", "footway:smoothness")
        width_raw, w_tag = pick("sidewalk:both:width", "sidewalk:width", "sidewalk:right:width",
                                "sidewalk:left:width", "footway:width")
        if surface is None and t.get("surface") is not None:
            # The carriageway surface says little about the sidewalk surface.
            a["carriageway_surface"] = t["surface"]
    elif on_road:
        # Walking on the carriageway (or unknown): the road surface applies.
        surface, s_tag = pick("surface")
        smooth, sm_tag = pick("smoothness")
        width_raw, w_tag = None, None
    else:
        surface, s_tag = pick("surface", "footway:surface")
        smooth, sm_tag = pick("smoothness")
        width_raw, w_tag = pick("width", "footway:width", "est_width")

    a["surface"] = surface
    a["smoothness"] = smooth
    _prov(e, "surface", surface, "TAG", s_tag or "")
    _prov(e, "smoothness", smooth, "TAG", sm_tag or "")
    a["surface_class"] = T.surface_class(surface, smooth)

    width = T.parse_width_m(width_raw)
    a["width_m"] = width
    a["width_estimated"] = w_tag == "est_width" if width is not None else None
    _prov(e, "width_m", width, "TAG" if w_tag != "est_width" else "INFERRED", w_tag or "")

    incline, hint = T.parse_incline(t.get("incline"))
    a["incline_pct"] = incline
    a["incline_source"] = "OSM" if incline is not None else None
    a["incline_hint"] = hint
    _prov(e, "incline_pct", incline, "TAG", "incline")

    a["is_stairs"] = pc == T.STEPS
    if pc == T.STEPS:
        a["step_count"] = _int(t.get("step_count"))
        a["handrail"] = T.tri_state(t.get("handrail")) if "handrail" in t else (
            True if any(t.get(k) == "yes" for k in ("handrail:left", "handrail:right", "handrail:center")) else None)
        a["ramp_wheelchair"] = T.tri_state(t.get("ramp:wheelchair"))
        a["ramp_stroller"] = T.tri_state(t.get("ramp:stroller"))
    a["wheelchair"] = T.wheelchair_value(t.get("wheelchair"))
    _prov(e, "wheelchair", a["wheelchair"], "TAG", "wheelchair")
    a["lit"] = T.lit_value(t.get("lit"))
    _prov(e, "lit", a["lit"], "TAG", "lit")
    a["tactile_paving"] = T.tri_state(t.get("tactile_paving"))
    _prov(e, "tactile_paving", a["tactile_paving"], "TAG", "tactile_paving")
    a["kerb_type"] = None
    a["kerb_height_cm"] = None
    a["barrier"] = None
    a["barrier_effect"] = None
    a["segregated"] = T.tri_state(t.get("segregated"))

    a["crossing"] = None
    a["crossing_ref"] = None
    if pc == T.CROSSING:
        ci = T.crossing_info(t) or T.CrossingInfo()
        a["crossing"] = ci
        a["crossing_ref"] = f"W{w.osm_id}"
    if t.get("crossing") == "no":
        a["crossing_forbidden"] = True


def _int(v: Optional[str]) -> Optional[int]:
    try:
        return int(v) if v is not None else None
    except ValueError:
        return None


def _attach_node_features(edges: list[Edge], node_tags: dict[int, dict], road_nodes: set[int]) -> None:
    incident: dict[int, list[Edge]] = defaultdict(list)
    for e in edges:
        incident[e.source].append(e)
        incident[e.target].append(e)

    def apply_kerb(e: Edge, nid: int, tags: dict):
        kt = T.kerb_type(tags)
        h = T.parse_kerb_height_cm(tags.get("kerb:height"))
        if kt is None and h is None:
            return
        cur = e.attrs.get("kerb_type")
        if kt and (cur is None or T.KERB_SEVERITY[kt] > T.KERB_SEVERITY[cur]):
            e.attrs["kerb_type"] = kt
            _prov(e, "kerb_type", kt, "TAG", f"node/{nid}:kerb")
        if h is not None and (e.attrs.get("kerb_height_cm") is None or h > e.attrs["kerb_height_cm"]):
            e.attrs["kerb_height_cm"] = h
            _prov(e, "kerb_height_cm", h, "TAG", f"node/{nid}:kerb:height")

    def apply_crossing(e: Edge, nid: int, tags: dict):
        ci = T.crossing_info(tags)
        if ci is None:
            return
        if e.attrs.get("crossing") is None:
            e.attrs["crossing"] = ci
        else:
            e.attrs["crossing"].merge(ci)
        e.attrs["crossing_ref"] = e.attrs.get("crossing_ref") or f"N{nid}"
        if ci.crossing_type == "NONE":
            e.attrs["crossing_forbidden"] = True
        _prov(e, "crossing_type", ci.crossing_type, "TAG", f"node/{nid}:crossing")
        _prov(e, "crossing_sound", ci.sound, "TAG", f"node/{nid}:traffic_signals:sound")

    for nid, tags in node_tags.items():
        is_crossing = T.crossing_info(tags) is not None
        has_kerb = T.kerb_type(tags) is not None or "kerb:height" in tags
        barrier = T.barrier_effect(tags)
        if not (is_crossing or has_kerb or barrier):
            continue
        inc = incident.get(nid, [])
        crossing_edges = [e for e in inc if e.wc.path_class == T.CROSSING]

        # Barriers: every path through the node passes the barrier.
        if barrier:
            for e in inc:
                prev = e.attrs.get("barrier_effect")
                order = {"MINOR": 0, "WHEELCHAIR": 1, "ALL": 2}
                if prev is None or order[barrier] > order[prev]:
                    e.attrs["barrier_effect"] = barrier
                    e.attrs["barrier"] = tags.get("barrier")
                    _prov(e, "barrier", tags.get("barrier"), "TAG", f"node/{nid}:barrier")
        if has_kerb:
            # A kerb at a junction belongs to the crossing that steps down from it,
            # not to the sidewalk passing by.
            targets = crossing_edges or [e for e in inc if e.wc.path_class not in T.ROAD_CLASSES]
            for e in targets:
                apply_kerb(e, nid, tags)
        if is_crossing:
            if crossing_edges:
                for e in crossing_edges:
                    apply_crossing(e, nid, tags)
            elif nid in road_nodes:
                # Crossing mapped only as a node on the road: footways meeting the
                # road here cross it at this node.
                for e in inc:
                    if e.wc.path_class not in T.ROAD_CLASSES:
                        apply_crossing(e, nid, tags)
                        e.attrs["crossing_via_node"] = True


def _finalise(e: Edge) -> None:
    a = e.attrs
    ci: Optional[T.CrossingInfo] = a.get("crossing")
    a["traffic_exposure"] = T.traffic_exposure(e.wc, ci.signals if ci else None)
    if ci is not None and ci.tactile_paving is not None:
        a["tactile_paving"] = ci.tactile_paving if a.get("tactile_paving") is None else a["tactile_paving"]

    # Completeness: share of the attributes relevant for this edge type that are known.
    checks = [a["surface_class"] != "UNKNOWN", a.get("lit") is not None]
    if e.wc.path_class not in T.ROAD_CLASSES:
        checks.append(a.get("width_m") is not None)
    checks.append(a.get("incline_pct") is not None or a.get("is_stairs"))
    if ci is not None:
        checks += [ci.crossing_type is not None, a.get("kerb_type") is not None,
                   a.get("tactile_paving") is not None]
        if ci.signals:
            checks.append(ci.sound is not None)
    if e.wc.path_class == T.STEPS:
        checks.append(a.get("handrail") is not None)
    a["completeness"] = round(sum(checks) / len(checks), 3)


def read_osm(pbf_path: str, bbox=None) -> Graph:
    r = _Reader(bbox)
    r.apply_file(pbf_path, locations=True)
    nodes, edges = build_graph(r.ways, r.node_tags)
    places = r.places + _street_places(r.street_parts, bbox)
    stats = {
        "ways": len(r.ways), "edges": len(edges), "nodes": len(nodes),
        "benches": len(r.benches), "features": len(r.features), "places": len(places),
        "edge_km": round(sum(e.length_m for e in edges) / 1000, 1),
    }
    log.info("graph built: %s", stats)
    return Graph(nodes, {k: v for k, v in r.node_tags.items() if k in nodes}, edges,
                 r.benches, r.features, places, stats)


def iter_edges_with_class(edges: Iterable[Edge], cls: str):
    return (e for e in edges if e.wc.path_class == cls)
