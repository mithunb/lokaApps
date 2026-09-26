#!/usr/bin/env python3
"""Pull one country's Ramsar wetlands into a file that ships beside the index.

    python3 api/atlas-builders/pull_ramsar.py IND

Why a file rather than fetching each site when a build needs it: 114 sites in
India, each a separate call to a service that has been slow and has already
been wrong once. Pulled once, trimmed, and read from disk thereafter — the same
arrangement as the mountain ranges and the reserve register.

The three attempts that failed before this worked are worth recording, because
the mistake was not in the request. The obvious layer, features_bnd, is the one
called "boundaries" and it holds the outlines — but it is keyed on an internal
number and carries no Ramsar site number and no name, so there is no way to ask
it for a particular wetland. features_published carries the site number, the
official name, the country and the outline together. Asking the service to
describe itself is what found this; guessing at the request never would have.

What this does NOT get. The register publishes boundaries for some of its
sites, not all. India has around ninety designated wetlands; this layer holds
seventy-five of them, and the ones missing include the best known — Chilika,
Loktak, Keoladeo, Vembanad, Wular, Sambhar. They are designated, they are on
the Ramsar list, and their outlines are simply not published through this
service. The other layers here carry only centroids, with no site number to
join on, so there is nothing to fall back to. Those wetlands need another
source or a hand-written entry; running this again will not find them.

Nothing else in this directory pulls the other two shipped registers. The
mountain ranges and the reserve register were fetched before there was anywhere
to keep the script that fetched them, so they cannot be refreshed the way this
can. That is a gap, not a design.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PLACES = os.path.join(HERE, "places")

SERVICE = "https://rsis.ramsar.org/geoserver/wfs"
LAYER = "ramsar_sdi:features_published"
DP = 6          # about a tenth of a metre; the same trim the map builder uses


def fetch(iso3):
    q = urllib.parse.urlencode({
        "service": "WFS", "version": "1.1.0", "request": "GetFeature",
        "typeName": LAYER, "outputFormat": "application/json",
        "CQL_FILTER": "iso3='%s'" % iso3,
    })
    req = urllib.request.Request(
        SERVICE + "?" + q,
        # Plain ASCII: a request header cannot carry an em-dash.
        headers={"User-Agent": "LOKA Atlas (loka.place) register pull"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode("utf-8"))


# A reservoir's shoreline is the most detailed thing in this register, and the
# detail is not information anyone reading a map wants: Hirakud Reservoir
# arrived as 79,342 points for 654 square kilometres, which is a point every
# few metres around a lake drawn at a scale where the whole lake is a thumbnail.
# Anything over this is thinned until it fits, with the tolerance stepped up
# until it does rather than guessed at once.
POINT_BUDGET = 1500


def count_points(c):
    if not c:
        return 0
    if isinstance(c[0], (int, float)):
        return 1
    return sum(count_points(x) for x in c)


def thin(geom):
    """Fewer points, same shape to the eye. Returns (geometry, was_thinned)."""
    if count_points(geom.get("coordinates")) <= POINT_BUDGET:
        return geom, False
    try:
        from shapely.geometry import shape, mapping
    except ImportError:
        return geom, False
    g = shape(geom)
    for tol in (0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005):
        out = g.simplify(tol, preserve_topology=True)
        if out.is_empty:
            continue
        m = mapping(out)
        if count_points(m.get("coordinates")) <= POINT_BUDGET:
            return json.loads(json.dumps(m)), True
    m = mapping(g.simplify(0.005, preserve_topology=True))
    return json.loads(json.dumps(m)), True


def trim(c):
    if not c:
        return c
    if isinstance(c[0], (int, float)):
        return [round(float(c[0]), DP), round(float(c[1]), DP)]
    return [trim(x) for x in c]


def main():
    iso3 = (sys.argv[1] if len(sys.argv) > 1 else "IND").upper()
    doc = fetch(iso3)
    raw = doc.get("features") or []
    print("  %s: %d records from the register" % (iso3, len(raw)))

    # One site, however many records.
    #
    # The register lists a wetland once per parcel: Tawa Reservoir arrives as
    # twenty records, Hirakud as six, all under one name and one site number.
    # They are not twenty places. Grouped by the site number, they become one
    # wetland with a shape in several pieces, which is what it is.
    sites = {}
    order = []
    for f in raw:
        p = f.get("properties") or {}
        rid = p.get("ramsarid")
        g = f.get("geometry")
        # The register's names carry stray spaces — " Lonar Lake " — and a name
        # with a space on the end matches nothing a person would type.
        name = " ".join(str(p.get("officialname") or "").split())
        if not name or not g or rid is None:
            continue
        if rid not in sites:
            sites[rid] = {"name": name, "area": p.get("area_off"), "parts": []}
            order.append(rid)
        parts = sites[rid]["parts"]
        if g["type"] == "Polygon":
            parts.append(g["coordinates"])
        elif g["type"] == "MultiPolygon":
            parts.extend(g["coordinates"])

    out, thinned, joined = [], [], []
    for rid in order:
        site = sites[rid]
        if not site["parts"]:
            continue
        if len(site["parts"]) > 1:
            joined.append("%s (%d pieces)" % (site["name"], len(site["parts"])))
        geom, was_thinned = thin({"type": "MultiPolygon", "coordinates": site["parts"]})
        if was_thinned:
            thinned.append(site["name"])
        out.append({
            "type": "Feature",
            "properties": {
                "name": site["name"],
                "kind": "wetland",
                "ramsarid": rid,
                "area_km2": round(float(site["area"] or 0) / 100.0, 1),
                "source": "Ramsar Sites Information Service",
            },
            "geometry": {"type": geom["type"], "coordinates": trim(geom["coordinates"])},
        })

    dest = os.path.join(PLACES, "ramsar-%s.geojson" % iso3)
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": out}, fh,
                  ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")

    print("  wrote %s" % os.path.relpath(dest, os.path.dirname(HERE)))
    print("  %d wetlands, %.2f MB" % (len(out), os.path.getsize(dest) / 1048576.0))
    if joined:
        print("  listed in pieces and put back together: " + ", ".join(sorted(joined)))
    if thinned:
        print("  thinned, their outlines being finer than any map needs: "
              + ", ".join(sorted(set(thinned))))
    names = [f["properties"]["name"].lower() for f in out]
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        print("  STILL sharing a name under different site numbers: " + ", ".join(dupes))
    print("\n  Now run build_places_index.py to fold them into the list.")


if __name__ == "__main__":
    main()
