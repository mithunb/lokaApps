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


# ---------------------------------------------------------------------------
# Fetching a shape
#
# Three sources were three hand-written functions, and adding a fourth meant
# writing a fifth. They differ in only two ways that matter — where the answer
# comes from, and where the shape sits inside it — so both are written down in
# the source row instead of in code. Adding a source is now a row in
# build_places_index.py's SOURCES table:
#
#   "fetch"  an address with {id} in it, or a path relative to places/
#   "read"   how to find the shape in the answer:
#              in           "features" (a GeoJSON collection), "list" (a plain
#                           array of records), or "geometry" (the answer IS one)
#              geometry_at  for "list": the key on each record holding the shape
#              match        a property to match the place's name against, when
#                           the answer carries more than one place
#              areas_only   true to refuse a point where an outline was wanted
#   "gap_s"  seconds to wait before each call, when the service asks for one
#
# Everything fetched is cached under the build's cache directory and fetched
# once, ever.
# ---------------------------------------------------------------------------

def _dig(rec, key):
    """One level, or a dotted path — "geojson" or "geometry.shape"."""
    cur = rec
    for part in str(key).split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _safe(s):
    return "".join(c if (c.isalnum() or c in "-_.") else "_" for c in str(s))[:80]


def _answer(entry, src, cache_dir):
    """The source's reply, parsed. Local files are read; addresses are fetched
    once and kept. Returns None when there is nothing to read."""
    fetch = str(src.get("fetch") or "")
    if not fetch:
        return None

    if not fetch.lower().startswith(("http://", "https://")):
        # A file shipped beside the index. {id} names it.
        path = os.path.join(SHIPPED, os.path.basename(fetch.replace("{id}", entry["id"])))
        if not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    import requests
    url = fetch.replace("{id}", str(entry["id"]))
    dest = os.path.join(cache_dir, "place-%s-%s.json" % (
        _safe(entry.get("source")), _safe(entry["id"])))
    # Caches written before sources were named this way. Cheap to look for, and
    # it saves asking a public service again for something already on disk.
    if not (os.path.exists(dest) and os.path.getsize(dest) > 0):
        for old in ("place-%s.json" % _safe(entry["id"]),
                    "place-%s-%s.json" % (_safe(entry.get("source")), _safe(entry["id"]))):
            legacy = os.path.join(cache_dir, old)
            if os.path.exists(legacy) and os.path.getsize(legacy) > 0:
                dest = legacy
                break
    if not (os.path.exists(dest) and os.path.getsize(dest) > 0):
        gap = src.get("gap_s")
        if gap:
            time.sleep(float(gap))
        r = requests.get(url, headers=UA, timeout=float(src.get("timeout_s") or 60))
        r.raise_for_status()
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write(r.text)
    with open(dest, encoding="utf-8") as fh:
        try:
            return json.load(fh)
        except ValueError:
            return None


def _shape_in(doc, entry, read):
    """The one shape this entry wants, out of whatever came back."""
    if doc is None:
        return None
    where = str(read.get("in") or "features")

    if where == "geometry":
        return doc if isinstance(doc, dict) and doc.get("type") else None

    if where == "list":
        recs = doc if isinstance(doc, list) else (doc.get(read.get("at") or "results") or [])
        key = read.get("geometry_at") or "geometry"
        for rec in recs:
            g = _dig(rec, key)
            if g and g.get("type"):
                return g
        return None

    # a GeoJSON collection
    feats = (doc.get("features") or []) if isinstance(doc, dict) else []
    if not feats:
        return None
    prop = read.get("match")
    if not prop:
        return feats[0].get("geometry")

    want = str(entry.get("feature") or entry["name"]).strip()
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
        if str((f.get("properties") or {}).get(prop, "")).strip() == want:
            return f.get("geometry")
    for f in feats:
        if str((f.get("properties") or {}).get(prop, "")).strip() == want:
            return f.get("geometry")
    return None


def geometry_for(entry, sources, cache_dir):
    """The shape for one entry, or None. Never raises: a place that cannot be
    fetched is a place the atlas does without, not a build that fails."""
    src = sources.get(entry.get("source")) or {}
    if not src:
        warn(f"{entry.get('name')}: no source called {entry.get('source')!r}")
        return None
    read = src.get("read") or {}
    try:
        g = _shape_in(_answer(entry, src, cache_dir), entry, read)
    except Exception as e:
        warn(f"{entry.get('name')}: could not be fetched ({e})")
        return None
    if not g:
        return None
    # A point is not an area. Drawing one as a shape is the mistake this avoids:
    # a geocoder that cannot find an outline will happily offer a dot instead.
    if read.get("areas_only") and g.get("type") not in ("Polygon", "MultiPolygon"):
        return None
    return g


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
