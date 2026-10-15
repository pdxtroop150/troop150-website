#!/usr/bin/env python3
"""Builds src/config/treeRecyclingServiceArea.json, the pickup service area.

The output lists the ZIP codes served in full, plus a polygon for each ZIP
code served only in part.

Each polygon is the side of the boundary roads or water that we serve,
clipped to the ZIP code plus a margin. The website also
checks the ZIP code, so the margin never adds addresses outside the ZIP.

Sources: OpenStreetMap (Overpass API) for the boundaries and Census TIGERweb
for ZIP code (ZCTA) outlines. Downloads are cached in a temporary directory.

Usage:
    python3 -m venv /tmp/area-venv && /tmp/area-venv/bin/pip install shapely
    /tmp/area-venv/bin/python scripts/build-service-area.py [--preview map.html]

--preview writes a Leaflet map for checking the result in a browser.
"""
import argparse
import hashlib
import json
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from shapely.geometry import LineString, Point, box, mapping, shape
from shapely.ops import polygonize, unary_union

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "src/config/treeRecyclingServiceArea.json"
CACHE = Path(tempfile.gettempdir()) / "troop150-service-area"
USER_AGENT = "troop150-website service area builder"
# Every ZIP code we serve. Those with a boundary below are served only on one
# side of it; the rest are served in full.
ZIPS = ["97034", "97035", "97201", "97219", "97221", "97223", "97229", "97239"]

OVERPASS_QUERY = """[out:json][timeout:60];(
  relation["name"="Oswego Lake"](45.38,-122.75,45.43,-122.66);
  way["name"~"Oswego (Canal|Creek)"](45.37,-122.78,45.43,-122.64);
  way["ref"="OR 217"]["highway"="motorway"](45.40,-122.82,45.50,-122.72);
  way["name"~"Saltzman Road"]["highway"="secondary"](45.50,-122.85,45.62,-122.75);
  way["name"="Northwest Thompson Road"](45.50,-122.85,45.58,-122.74);
  way["name"~"^(Northwest|Southwest) Skyline Boulevard$"]["highway"~"^(primary|secondary|tertiary)$"](45.50,-122.85,45.60,-122.70);
  way["ref"~"(^|;)US 26(;|$)"]["highway"="motorway"](45.48,-122.82,45.53,-122.66);
  way["ref"~"(^|;)I 405(;|$)"]["highway"="motorway"](45.49,-122.70,45.54,-122.66);
);out geom;"""


def fetch(name, url, data=None):
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(exist_ok=True)
        request = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
        # The public Overpass server is often briefly overloaded.
        for attempt in range(4):
            try:
                path.write_bytes(urllib.request.urlopen(request, timeout=120).read())
                break
            except urllib.error.HTTPError as error:
                if attempt == 3 or error.code not in (429, 502, 503, 504):
                    raise
                print(f"{url} returned {error.code}; retrying in 30 seconds")
                time.sleep(30)
    return json.loads(path.read_text())


def coords(element):
    return [(g["lon"], g["lat"]) for g in element["geometry"]]


def due(point, dx=0.0, dy=0.0):
    """A line from point extending far in one compass direction."""
    return [point, (point[0] + dx, point[1] + dy)]


def served_side(zcta, lines, inside_point, barrier_area=None):
    """The part of the ZIP code's surroundings on inside_point's side of the lines."""
    frame = box(*zcta.buffer(0.02).bounds)
    barrier = unary_union([LineString(line) for line in lines]).buffer(0.00008)
    if barrier_area is not None:
        barrier = barrier.union(barrier_area)
    pieces = frame.difference(barrier)
    pieces = list(getattr(pieces, "geoms", [pieces]))
    if len(pieces) < 2:
        raise SystemExit("A boundary does not cross its ZIP code; check the extensions.")
    piece = next((p for p in pieces if p.contains(Point(inside_point))), None)
    if piece is None:
        raise SystemExit(f"No side contains the reference point {inside_point}.")
    return piece.intersection(zcta.buffer(0.01)).simplify(0.0001)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", type=Path, help="write a Leaflet preview map here")
    args = parser.parse_args()

    osm = fetch(
        f"osm-{hashlib.sha256(OVERPASS_QUERY.encode()).hexdigest()[:12]}.json",
        "https://overpass-api.de/api/interpreter",
        urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode(),
    )["elements"]
    zctas = {
        z: shape(fetch(
            f"zcta_{z}.json",
            "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
            f"PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query?where=ZCTA5%3D%27{z}%27"
            "&outFields=ZCTA5&outSR=4326&f=geojson",
        )["features"][0]["geometry"])
        for z in ZIPS
    }

    def ways(predicate):
        """A road's OSM ways, with short connectors bridging any small gaps
        between its pieces (at intersections, ramps, or tagging changes)."""
        lines = [coords(e) for e in osm if e["type"] == "way" and predicate(e.get("tags", {}))]
        while True:
            pieces = unary_union([LineString(line) for line in lines]).buffer(0.00008)
            pieces = list(getattr(pieces, "geoms", [pieces]))
            if len(pieces) < 2:
                return lines
            first = [p for line in lines for p in line if pieces[0].contains(Point(p))]
            rest = [p for line in lines for p in line if not pieces[0].contains(Point(p))]
            a, b = min(((a, b) for a in first for b in rest),
                       key=lambda ab: (ab[0][0] - ab[1][0]) ** 2 + (ab[0][1] - ab[1][1]) ** 2)
            lines = lines + [[a, b]]

    lake_relation = next(e for e in osm if e["type"] == "relation")
    lake = unary_union(list(polygonize(
        LineString(coords(m)) for m in lake_relation["members"] if m.get("role") == "outer"
    )))
    canal = ways(lambda t: t.get("name") == "Oswego Canal")
    creek = ways(lambda t: t.get("name") == "Oswego Creek")
    canal_end = min((p for w in canal for p in w), key=lambda p: p[1])
    creek_mouth = max((p for w in creek for p in w), key=lambda p: p[0])

    hwy217 = ways(lambda t: t.get("ref") == "OR 217")
    hwy217_north = max((p for w in hwy217 for p in w), key=lambda p: p[1])
    hwy217_east = max((p for w in hwy217 for p in w), key=lambda p: p[0])

    def ends(lines):
        points = [p for line in lines for p in line]
        return {
            "north": max(points, key=lambda p: p[1]),
            "south": min(points, key=lambda p: p[1]),
            "east": max(points, key=lambda p: p[0]),
            "west": min(points, key=lambda p: p[0]),
        }

    def nearest(point, lines):
        return min((p for line in lines for p in line),
                   key=lambda p: (p[0] - point[0]) ** 2 + (p[1] - point[1]) ** 2)

    thompson = ways(lambda t: t.get("name") == "Northwest Thompson Road")
    skyline = ways(lambda t: "Skyline" in t.get("name", ""))
    # Where freeways share a road, OSM lists both, e.g. "I 405;US 26".
    us26 = ways(lambda t: "US 26" in t.get("ref", "").split(";"))
    i405 = ways(lambda t: "I 405" in t.get("ref", "").split(";"))
    sunset = ways(lambda t: t.get("ref") == "US 26")  # west of the I-405 junction

    saltzman = ways(lambda t: "Saltzman" in t.get("name", ""))
    saltzman_north = max((p for w in saltzman for p in w), key=lambda p: p[1])
    saltzman_south = min((p for w in saltzman for p in w), key=lambda p: p[1])

    # zip: (description, boundary lines, a point on the served side, area barrier)
    boundaries = {
        # The lake, Oswego Canal (extended due south from its end), and Oswego
        # Creek (extended due east from its mouth)
        "97034": ("north of Oswego Lake",
                  canal + creek + [due(canal_end, dy=-0.2), due(creek_mouth, dx=0.2)],
                  (-122.69, 45.43), lake),
        # The freeway, extended due north from US 26 and due east from I-5
        "97223": ("north of Highway 217",
                  hwy217 + [due(hwy217_north, dy=0.2), due(hwy217_east, dx=0.2)],
                  (-122.74, 45.46), None),
        # Between NW Saltzman Road and NW Skyline Boulevard (each extended
        # due north and south) and south of NW Thompson Road (extended due
        # east and west)
        "97229": ("east of NW Saltzman Road, west of NW Skyline Boulevard, "
                  "and south of NW Thompson Road",
                  saltzman + skyline + thompson + [
                      due(saltzman_north, dy=0.2), due(saltzman_south, dy=-0.2),
                      due(ends(skyline)["north"], dy=0.2), due(ends(skyline)["south"], dy=-0.2),
                      due(ends(thompson)["east"], dx=0.2), due(ends(thompson)["west"], dx=-0.2)],
                  (-122.78, 45.527), None),
        # The freeway, extended due west and due east from its ends
        "97221": ("south of US 26",
                  sunset + [due(ends(sunset)["west"], dx=-0.2), due(ends(sunset)["east"], dx=0.2)],
                  (-122.73, 45.49), None),
        # US 26 (extended due west) and I-405 (extended due east from its
        # south end at I-5 to the river). The two freeways meet only through
        # ramps, so a short connector closes the gap.
        "97201": ("south of US 26 and I-405",
                  us26 + i405 + [due(ends(us26)["west"], dx=-0.2),
                                 due(ends(i405)["south"], dx=0.2),
                                 [ends(sunset)["east"], nearest(ends(sunset)["east"], i405)]],
                  (-122.705, 45.508), None),
    }

    features = []
    served = {}
    for z, (description, lines, inside, area) in boundaries.items():
        geometry = mapping(served_side(zctas[z], lines, inside, area))
        served[z] = geometry
        geometry["coordinates"] = json.loads(
            json.dumps(geometry["coordinates"]), parse_float=lambda s: round(float(s), 5)
        )
        features.append({
            "type": "Feature",
            "properties": {"zip": z, "description": description},
            "geometry": geometry,
        })
    result = {
        "type": "FeatureCollection",
        "fullZipCodes": [z for z in ZIPS if z not in boundaries],
        "features": features,
    }
    OUTPUT.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print(f"Wrote {OUTPUT.relative_to(ROOT)}")

    if args.preview:
        # What the website actually accepts: whole ZIP codes for full
        # coverage, and each served side clipped to its ZIP code, merged into
        # one shape so nothing is shaded twice.
        coverage = unary_union([
            zcta.intersection(shape(served[z])) if z in served else zcta
            for z, zcta in zctas.items()
        ])
        data = json.dumps({
            "zips": {z: mapping(g.simplify(0.0002)) for z, g in zctas.items()},
            "coverage": mapping(coverage.simplify(0.0002)),
        })
        args.preview.write_text(PREVIEW.replace("DATA", data))
        print(f"Wrote {args.preview}")


PREVIEW = """<!doctype html><html><head><meta charset="utf-8"><title>Service area</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0}</style></head><body><div id="map"></div><script>
const data = DATA;
const map = L.map("map");
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  {maxZoom: 18, attribution: "&copy; OpenStreetMap"}).addTo(map);
L.geoJSON(data.coverage, {style: {stroke: false, fillColor: "#2e7d32", fillOpacity: 0.35}}).addTo(map);
const outlines = Object.entries(data.zips).map(([zip, geometry]) => L.geoJSON(geometry, {style: {
  color: "#000", weight: 2, fill: false}}).bindTooltip(zip, {permanent: true}).addTo(map));
map.fitBounds(L.featureGroup(outlines).getBounds());
</script></body></html>
"""

if __name__ == "__main__":
    main()
