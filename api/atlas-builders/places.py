"""Named places that are not administrative units — ranges, reserves, wards.

The index (api/data/places/index.json) holds NAMES AND IDS, not shapes: a few
kilobytes for the whole of India. A build reads it, works out which entries
overlap the atlas's own box — from the bbox in the index, fetching nothing —
and then fetches the geometry only for those, by id, once, into the cache.

Two rules, both learned the hard way:

  Fetch by ID, never by name. Asked for "Jeevan Bhima Nagar" by name a geocoder
  offers a polygon in CHENNAI; asked for relation 19883328 it returns the right
  one every time. Asked for "BRT Tiger Reserve" it offers Periyar. The ids in
  the index were each looked up and confirmed by hand before being written.

  Fetch at BUILD time, never when somebody opens the map. Public mirrors are
  unreliable — four of nine queries failed on the day this was written — and an
  atlas that fetches its shapes on page load is an atlas that sometimes has no
  shapes.
"""
import json
import os
import time

from common import UA, progress, warn

# Beside the builder, not under api/data — api/data is the server's own state
# and is not in the repository, and an index nobody can review or diff is not
# an index.
HERE = os.path.dirname(os.path.abspath(__file__))
SHIPPED = os.path.join(HERE, "places")
INDEX = os.path.join(SHIPPED, "index.json")
POLITE_GAP_S = 1.1          # Nominatim asks for one request a second


def load_index():
    try:
        with open(INDEX, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as e:                      # an atlas is fine without them
        warn(f"place index unreadable: {e}")
        return {"sources": {}, "places": []}


def _overlaps(a, b):
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def within(bbox):
    """Index entries whose own box meets this one. Reads no geometry at all."""
    idx = load_index()
    return idx, [p for p in idx.get("places", [])
                 if isinstance(p.get("bbox"), list) and len(p["bbox"]) == 4
                 and _overlaps(p["bbox"], bbox)]


def _from_file(entry):
    path = os.path.join(SHIPPED, entry["id"])
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    feats = doc.get("features", [])
    want = entry.get("feature") or entry["name"]
    # Where in the file it sits, when the list knows. Four names in the reserve
    # register belong to more than one place — two national parks called Rajiv
    # Gandhi, a sanctuary listed once per state it runs through — so searching
    # by name alone always returned the first and the others could never be
    # drawn. The position is checked against the name before it is trusted, so
    # a list written against an older copy of the file falls back to searching
    # rather than fetching the wrong shape.
    at = entry.get("at")
    if isinstance(at, int) and 0 <= at < len(feats):
        f = feats[at]
        if str(f.get("properties", {}).get("name", "")).strip() == want:
            return f.get("geometry")
    for f in feats:
        if str(f.get("properties", {}).get("name", "")).strip() == want:
            return f.get("geometry")
    return None


def _from_osm(entry, cache_dir, fetch_url):
    import requests
    url = fetch_url.replace("{id}", entry["id"])
    dest = os.path.join(cache_dir, "place-" + entry["id"] + ".json")
    if not (os.path.exists(dest) and os.path.getsize(dest) > 0):
        time.sleep(POLITE_GAP_S)
        r = requests.get(url, headers=UA, timeout=60)
        r.raise_for_status()
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write(r.text)
    with open(dest, encoding="utf-8") as fh:
        got = json.load(fh)
    if not got:
        return None
    g = got[0].get("geojson")
    # a point is not an area; drawing one as a shape is the mistake this avoids
    return g if g and g.get("type") in ("Polygon", "MultiPolygon") else None


def _from_ramsar(entry, cache_dir, fetch_url):
    import requests
    url = fetch_url.replace("{id}", entry["id"])
    dest = os.path.join(cache_dir, "place-ramsar-" + entry["id"] + ".json")
    if not (os.path.exists(dest) and os.path.getsize(dest) > 0):
        r = requests.get(url, headers=UA, timeout=90)
        r.raise_for_status()
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write(r.text)
    with open(dest, encoding="utf-8") as fh:
        try:
            doc = json.load(fh)
        except ValueError:
            return None
    feats = doc.get("features") or []
    return feats[0].get("geometry") if feats else None


def geometry_for(entry, sources, cache_dir):
    """The shape for one entry, or None. Never raises: a place that cannot be
    fetched is a place the atlas does without, not a build that fails."""
    src = sources.get(entry.get("source")) or {}
    try:
        if entry.get("source") == "file":
            return _from_file(entry)
        if entry.get("source") == "osm":
            return _from_osm(entry, cache_dir, src.get("fetch", ""))
        if entry.get("source") == "ramsar":
            return _from_ramsar(entry, cache_dir, src.get("fetch", ""))
    except Exception as e:
        warn(f"{entry.get('name')}: could not be fetched ({e})")
    return None


def collect(bbox, cache_dir):
    """GeoJSON features for every indexed place meeting this box."""
    idx, wanted = within(bbox)
    sources = idx.get("sources", {})
    feats = []
    for i, entry in enumerate(wanted):
        progress("places", int(90 * i / max(len(wanted), 1)), entry["name"])
        g = geometry_for(entry, sources, cache_dir)
        if not g:
            continue
        feats.append({"type": "Feature", "properties": {
            "name": entry["name"],
            "aliases": entry.get("aliases") or [],
            "kind": entry.get("kind") or "place",
            "state": entry.get("state"),
            # Who to credit, under what licence, and which source row says so.
            # The first two are what a reader has to be shown; the third is how
            # the recipe finds the source's link without guessing at the name.
            "source": entry.get("source"),
            "credit": entry.get("credit"),
            "licence": entry.get("licence"),
        }, "geometry": g})
    return feats
