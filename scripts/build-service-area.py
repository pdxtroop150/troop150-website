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
        [--image src/assets/tree-recycling-service-area.jpg]

--preview writes a Leaflet map for checking the result in a browser.
--image renders a high-resolution JPEG map for the website with headless
Chrome and sips, so it needs macOS with Google Chrome installed.
"""
import argparse
import hashlib
import json
import math
import subprocess
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
    parser.add_argument("--image", type=Path, help="render the website's map image here (JPEG)")
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

    if args.preview or args.image:
        # What the website actually accepts: whole ZIP codes for full
        # coverage, and each served side clipped to its ZIP code, merged into
        # one shape so nothing is shaded twice.
        pieces = {
            z: zcta.intersection(shape(served[z])) if z in served else zcta
            for z, zcta in zctas.items()
        }
        coverage = unary_union(list(pieces.values()))
        data = {
            "zips": {z: mapping(g.simplify(0.0002)) for z, g in zctas.items()},
            "coverage": mapping(coverage.simplify(0.0002)),
        }
    if args.preview:
        args.preview.write_text(PREVIEW.replace("DATA", json.dumps(data)))
        print(f"Wrote {args.preview}")
    if args.image:
        render_image(args.image, data, pieces)


# OpenStreetMap's tiles at this zoom, one image pixel per tile pixel.
IMAGE_ZOOM = 14
IMAGE_PADDING = 80
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def render_image(path, data, pieces):
    def pixels(lon, lat):
        scale = 256 * 2 ** IMAGE_ZOOM
        y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
        return (lon + 180) / 360 * scale, (1 - y / math.pi) / 2 * scale

    west, south, east, north = unary_union(list(pieces.values())).bounds
    left, top = pixels(west, north)
    right, bottom = pixels(east, south)
    width = math.ceil(right - left) + 2 * IMAGE_PADDING
    height = math.ceil(bottom - top) + 2 * IMAGE_PADDING
    # Download the tiles first, so the screenshot never catches the map
    # mid-load, and cache them so reruns don't fetch them again.
    tiles = CACHE / "tiles"
    # One extra tile on each side covers Leaflet's rounding when it centers the map.
    for x in range(int(left - IMAGE_PADDING) // 256 - 1, int(right + IMAGE_PADDING) // 256 + 2):
        for y in range(int(top - IMAGE_PADDING) // 256 - 1, int(bottom + IMAGE_PADDING) // 256 + 2):
            tile = tiles / f"{IMAGE_ZOOM}/{x}/{y}.png"
            if not tile.exists():
                tile.parent.mkdir(parents=True, exist_ok=True)
                request = urllib.request.Request(
                    f"https://tile.openstreetmap.org/{IMAGE_ZOOM}/{x}/{y}.png",
                    headers={"User-Agent": USER_AGENT})
                tile.write_bytes(urllib.request.urlopen(request, timeout=60).read())
    # The served part of each ZIP code, outlined and labeled inside the
    # shading. Shared edges become the lines between ZIP codes.
    data = dict(data, pieces={z: mapping(g.simplify(0.0002)) for z, g in pieces.items()}, labels={
        z: list(g.representative_point().coords[0]) for z, g in pieces.items()
    }, bounds=[[south, west], [north, east]], zoom=IMAGE_ZOOM, padding=IMAGE_PADDING,
        tiles=tiles.as_uri() + "/{z}/{x}/{y}.png")
    page = Path(tempfile.gettempdir()) / "troop150-service-area-image.html"
    page.write_text(IMAGE_PAGE.replace("DATA", json.dumps(data)))
    screenshot = page.with_suffix(".png")
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        CHROME, "--headless=new", "--hide-scrollbars", "--force-device-scale-factor=1",
        f"--window-size={width},{height}", "--virtual-time-budget=10000",
        "--allow-file-access-from-files",
        f"--screenshot={screenshot}", page.as_uri(),
    ], check=True, capture_output=True)
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "85",
                    str(screenshot), "--out", str(path)], check=True, capture_output=True)
    print(f"Wrote {path} ({width}x{height})")


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

IMAGE_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
html,body,#map{height:100%;margin:0;background:#fff}
.zip{font:700 34px/1 Helvetica,Arial,sans-serif;color:#111;white-space:nowrap;
  text-shadow:0 0 5px #fff,0 0 5px #fff,0 0 5px #fff,0 0 5px #fff}
.legend{background:#fff;padding:14px 22px;font:600 32px Helvetica,Arial,sans-serif;
  border:2px solid #999;border-radius:8px;display:flex;align-items:center;gap:14px}
.legend i{width:44px;height:32px;background:rgba(46,125,50,.4);border:2px solid #2e7d32}
.leaflet-control-attribution{font-size:20px}
</style></head><body><div id="map"></div><script>
const data = DATA;
const map = L.map("map", {zoomControl: false, zoomSnap: 0, fadeAnimation: false,
  zoomAnimation: false, attributionControl: false});
L.control.attribution({prefix: false}).addTo(map);
map.fitBounds(data.bounds, {padding: [data.padding, data.padding], maxZoom: data.zoom});
L.tileLayer(data.tiles, {attribution: "&copy; OpenStreetMap contributors"}).addTo(map);
L.geoJSON(data.coverage, {style: {stroke: false, fillColor: "#1b5e20", fillOpacity: 0.4}}).addTo(map);
for (const geometry of Object.values(data.pieces))
  L.geoJSON(geometry, {style: {color: "#000", weight: 2.5, fill: false}}).addTo(map);
L.geoJSON(data.coverage, {style: {color: "#000", weight: 6, fill: false}}).addTo(map);
for (const [zip, [lon, lat]] of Object.entries(data.labels))
  L.marker([lat, lon], {icon: L.divIcon({className: "zip", html: zip, iconSize: null,
    iconAnchor: [48, 17]})}).addTo(map);
const legend = L.control({position: "topright"});
legend.onAdd = () => Object.assign(document.createElement("div"),
  {className: "legend", innerHTML: "<i></i>Curbside pickup area"});
legend.addTo(map);
</script></body></html>
"""

if __name__ == "__main__":
    main()
