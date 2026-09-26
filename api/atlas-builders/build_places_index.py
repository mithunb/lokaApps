#!/usr/bin/env python3
"""Write places/index.json from the files that ship beside it.

The index is the list of named places an atlas can match a row against —
mountain ranges, reserves, a ward. It holds names, other names the same place
goes by, and a box saying roughly where it is. It holds NO geometry: 709 shapes
would be tens of megabytes, and an atlas needs the two or three that fall inside
its own region. The shape is fetched when a build asks for it.

This script exists because the first index was written by a throwaway script
that was not kept. Two things went wrong as a result. 123 of the 125 mountain
ranges never made it in, so they shipped in the data file and could never be
found — a row saying "Aravalli Range" got nothing while the outline sat right
there. And there was no way to add a source, or a place, without writing the
whole thing again from memory.

Run it from anywhere:

    python3 api/atlas-builders/build_places_index.py

It reads only files in places/ and writes only places/index.json. It prints what
changed against the index already on disk, so a run that was meant to add one
place and quietly dropped four hundred says so.
"""

import json
import os
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
PLACES = os.path.join(HERE, "places")
INDEX = os.path.join(PLACES, "index.json")


# ---------------------------------------------------------------------------
# Where the places come from
# ---------------------------------------------------------------------------

# Each shipped file, and what has to be said about it wherever its shapes are
# drawn. "home" is a link a reader can follow; the fetch address in the sources
# block below is for the machine and is no use to a person.
SHIPPED = [
    {
        "file": "ranges-IND.geojson",
        "credit": "GMBA Mountain Inventory v2.0",
        "licence": "CC BY 4.0",
        "home": "https://www.gmba.unibe.ch/services/tools/inventory",
    },
    {
        "file": "reserves-IND.geojson",
        "credit": "National Tiger Conservation Authority",
        "licence": "reproducible free of charge with the source acknowledged"
                   " (ntca.gov.in/copyright-policy)",
        "home": "https://ntca.gov.in",
    },
    {
        "file": "ramsar-IND.geojson",
        "credit": "Ramsar Sites Information Service",
        "licence": "open access",
        "home": "https://rsis.ramsar.org",
    },
]

# Every source a place can come from.
#
# This table IS the plug-in point. A source is a row, not a function: say where
# to fetch from and how to read the answer, and places.py does the rest. The
# fields are documented at the top of places.py's fetching section.
#
#   fetch    an address with {id} in it, or a filename relative to places/
#   read     in: "features" | "list" | "geometry"
#            geometry_at: for "list", the key on each record holding the shape
#            match: a property to match the place's name against
#            areas_only: refuse a point where an outline was wanted
#   gap_s    seconds to wait before each call, when the service asks for one
#   home     a link a reader can follow; the fetch address is for the machine
#   credit / licence   what has to be said wherever its shapes are drawn
SOURCES = {
    "file": {
        "label": "shipped with the atlas",
        "fetch": "{id}",
        "read": {"in": "features", "match": "name"},
        "credit": "see each entry",
        "licence": "see each entry",
    },
    "osm": {
        "label": "OpenStreetMap",
        "fetch": "https://nominatim.openstreetmap.org/lookup"
                 "?osm_ids={id}&format=json&polygon_geojson=1",
        "read": {"in": "list", "geometry_at": "geojson", "areas_only": True},
        "gap_s": 1.1,
        "home": "https://www.openstreetmap.org/copyright",
        "credit": "\u00a9 OpenStreetMap contributors",
        "licence": "ODbL 1.0",
        "note": "one request a second, per their policy; the result is cached",
    },
    "ramsar": {
        "label": "Ramsar Sites Information Service",
        "fetch": "https://rsis.ramsar.org/geoserver/wfs?service=WFS&version=1.1.0"
                 "&request=GetFeature&typeName=ramsar_sdi:features_published"
                 "&outputFormat=application/json&CQL_FILTER=ramsarid={id}",
        "read": {"in": "features"},
        "timeout_s": 90,
        "home": "https://rsis.ramsar.org",
        "credit": "Ramsar Sites Information Service",
        "licence": "open access",
        "note": "the boundaries layer, features_bnd, is keyed on an internal"
                " number and knows nothing of Ramsar site numbers \u2014 three"
                " attempts failed against it. features_published carries the"
                " site number, the official name and the outline together.",
    },
}

# Names a source may not claim, because something else owns them.
#
# The mountain inventory has an entry called "Meghalaya" and another called
# "Andaman and Nicobar Islands". Both are states or union territories first and
# a landform second, and a row that says "Meghalaya" means the state. The index
# is searched ahead of the administrative boundaries — that is the whole point
# of it, so that a reserve beats the district around it — so leaving these in
# would have handed the state's rows to a mountain polygon.
POLITICAL = {
    "meghalaya",
    "andaman and nicobar islands",
}


# ---------------------------------------------------------------------------

def canon(s):
    """Lowercase, unaccented, punctuation flattened — for comparing only."""
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    out = []
    for c in s.lower():
        out.append(c if c.isalnum() else " ")
    return " ".join("".join(out).split())


def bbox_of(geom):
    """The box around a shape, to three decimals — about a hundred metres.

    The index is read whole on every build, so its size is worth caring about,
    and a box used to decide whether a place is anywhere near a region does not
    need centimetres."""
    lo_x = lo_y = float("inf")
    hi_x = hi_y = float("-inf")

    def walk(c):
        nonlocal lo_x, lo_y, hi_x, hi_y
        if not c:
            return
        if isinstance(c[0], (int, float)):
            x, y = float(c[0]), float(c[1])
            lo_x, hi_x = min(lo_x, x), max(hi_x, x)
            lo_y, hi_y = min(lo_y, y), max(hi_y, y)
            return
        for part in c:
            walk(part)

    walk((geom or {}).get("coordinates"))
    if lo_x == float("inf"):
        return None
    return [round(lo_x, 3), round(lo_y, 3), round(hi_x, 3), round(hi_y, 3)]


def read_json(path, fallback=None):
    if not os.path.exists(path):
        if fallback is None:
            sys.exit("missing: " + path)
        return fallback
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def build():
    extra_aliases = read_json(
        os.path.join(PLACES, "aliases-extra.json"), {}).get("aliases", {})
    extra_places = read_json(
        os.path.join(PLACES, "places-extra.json"), {}).get("places", [])

    # ---- pass one: everything the shipped files offer ---------------------
    found = []
    skipped_political = []

    for src in SHIPPED:
        doc = read_json(os.path.join(PLACES, src["file"]))
        for i, f in enumerate(doc.get("features", [])):
            props = f.get("properties") or {}
            name = str(props.get("name") or "").strip()
            if not name:
                continue
            if canon(name) in POLITICAL:
                skipped_political.append(name)
                continue
            box = bbox_of(f.get("geometry"))
            if not box:
                continue
            found.append({
                "name": name,
                "file_aliases": list(props.get("aliases") or []),
                "kind": str(props.get("kind") or "place"),
                "state": props.get("state"),
                "id": src["file"],
                "at": i,
                "bbox": box,
                "credit": src["credit"],
                "licence": src["licence"],
            })

    # ---- a place two registers both describe is one place -----------------
    #
    # Five wetlands are in the Ramsar register and in the reserve register
    # under the same name. They are not two places, and listing both would make
    # the name ambiguous — which is worse than either answer on its own. The
    # first register to carry a name keeps it, so the order of SHIPPED is the
    # order of preference. One register listing a name twice is a different
    # thing entirely and is handled below.
    also_in, kept, owner = [], [], {}
    for e in found:
        k = canon(e["name"])
        if k in owner and owner[k] != e["id"]:
            also_in.append("%s (kept from %s)" % (e["name"], owner[k]))
            continue
        owner.setdefault(k, e["id"])
        kept.append(e)
    found = kept

    # ---- pass two: make every name answer to exactly one place ------------
    #
    # Two national parks are both called Rajiv Gandhi, one in Karnataka and one
    # in Andhra Pradesh; the Chambal sanctuary is listed once per state it runs
    # through. The first version of this list kept whichever came first and
    # threw the rest away, so half of those places could never be drawn.
    #
    # They are all kept now, told apart by the state they are in. The bare name
    # then belongs to none of them, which is right: a row that says only "Rajiv
    # Gandhi National Park" has not said which one, and being asked is a better
    # answer than being quietly given the wrong park.
    groups = {}
    for e in found:
        groups.setdefault(canon(e["name"]), []).append(e)
    shared = []
    for key, members in groups.items():
        if len(members) < 2:
            continue
        shared.append(members[0]["name"] + " \u00d7" + str(len(members)))
        for n, e in enumerate(members):
            st = (e.get("state") or "").strip()
            same_state = sum(1 for m in members if (m.get("state") or "").strip() == st)
            tail = st if (st and same_state == 1) else (st + " " + str(n + 1) if st else str(n + 1))
            e["name"] = e["name"] + " (" + tail.strip() + ")"

    places, taken = [], {}
    alias_used = set()
    for e in found:
        key = canon(e["name"])
        # Other names this place goes by. Two sources, never invented here:
        # whatever the file itself carries, and whatever was written by hand for
        # the cases no rule could reach. A hand-written set is keyed on the name
        # in the register, which for a shared name is the one WITHOUT the state.
        hand_key = e["name"].split(" (")[0] if e["name"].endswith(")") else e["name"]
        hand = list(extra_aliases.get(e["name"]) or extra_aliases.get(hand_key) or [])
        if hand:
            alias_used.add(e["name"] if extra_aliases.get(e["name"]) else hand_key)
        aliases = []
        for alt in list(e["file_aliases"]) + hand:
            alt = str(alt).strip()
            if alt and canon(alt) != key and alt not in aliases:
                aliases.append(alt)
        entry = {
            "name": e["name"],
            "aliases": aliases,
            "kind": e["kind"],
            "state": e["state"],
            "source": "file",
            "id": e["id"],
            "feature": hand_key,
            "at": e["at"],
            "bbox": e["bbox"],
            "credit": e["credit"],
            "licence": e["licence"],
        }
        taken[key] = entry
        places.append(entry)

    # ---- places in no shipped file, written by hand ------------------------
    skipped_dupe = []
    for entry in extra_places:
        name = str(entry.get("name") or "").strip()
        if not name:
            continue
        key = canon(name)
        if key in taken:
            skipped_dupe.append(name)
            continue
        merged = dict(entry)
        aliases = list(merged.get("aliases") or [])
        for alt in extra_aliases.get(name) or []:
            if alt not in aliases:
                aliases.append(alt)
        if extra_aliases.get(name):
            alias_used.add(name)
        merged["aliases"] = aliases
        sd = SOURCES.get(merged.get("source")) or {}
        merged.setdefault("credit", sd.get("credit", ""))
        merged.setdefault("licence", sd.get("licence", ""))
        taken[key] = merged
        places.append(merged)

    places.sort(key=lambda p: (p.get("kind") or "", canon(p["name"])))

    out = {
        "comment": "Named places an atlas can match a row against. Names and a"
                   " rough box only \u2014 the shape is fetched when a build asks"
                   " for it. Written by build_places_index.py; edit the files"
                   " it reads, not this one.",
        "sources": SOURCES,
        "places": places,
    }

    was = read_json(INDEX, {"places": []}).get("places", [])
    with open(INDEX, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    # Say what happened, loudly enough that a silent loss cannot happen twice.
    by_kind = {}
    for p in places:
        by_kind[p["kind"]] = by_kind.get(p["kind"], 0) + 1
    print("wrote " + os.path.relpath(INDEX, os.path.dirname(HERE)))
    print("  places: %d  (was %d)" % (len(places), len(was)))
    for k in sorted(by_kind):
        print("     %-22s %d" % (k, by_kind[k]))
    if skipped_political:
        print("  left out, the name belongs to a state or union territory:")
        for n in skipped_political:
            print("     " + n)
    if also_in:
        print("  in more than one register, so listed once: " + ", ".join(sorted(also_in)))
    if shared:
        print("  told apart by their state, because the name is shared: "
              + ", ".join(sorted(shared)))
    if skipped_dupe:
        print("  left out, the name was already taken: " + ", ".join(skipped_dupe))

    # An alias written by hand against a name no register uses reaches nothing,
    # and says so nowhere. That is how "Nagarahole National Park" came to carry
    # six other names for a park listed as "Rajiv Gandhi National Park".
    orphan = [k for k in extra_aliases if k not in alias_used]
    if orphan:
        print("  WARNING \u2014 other names written for a place that is not in any file:")
        for k in orphan:
            print("     " + k + "  (its " + str(len(extra_aliases[k])) + " other names reach nothing)")

    gone = {canon(p["name"]) for p in was} - {canon(p["name"]) for p in places}
    if gone:
        print("  NO LONGER IN THE INDEX (%d): %s" % (len(gone), ", ".join(sorted(gone))))


if __name__ == "__main__":
    build()
