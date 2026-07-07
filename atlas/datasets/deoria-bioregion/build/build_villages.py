#!/usr/bin/env python3
"""Extract the 5 Cluster-1 villages (Deoria Sadar block) -> villages.geojson + clusters.geojson."""
import json, re, unicodedata, difflib
import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import mapping, MultiPoint
from shapely.ops import unary_union

SCRATCH = "/private/tmp/claude-501/-Users-mithunsheshagiri-work-lokaApps/eee9e18b-80b2-46a4-8f7b-e95a736de1f0/scratchpad"
OUT = "/Users/mithunsheshagiri/work/lokaApps/atlas/datasets/deoria-bioregion"

def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z]", "", s.lower())

# Cluster-1 villages, resolved to exact LGD identities (verified by proximity — the five
# form a compact ~7km cluster across Deoria Sadar + adjacent Baitalpur blocks).
# selector: (soi_name, census_name, block)  — matched on whichever is given.
TARGETS = [
    # display,            soi match,           census match,      block
    ("Badhya Buzurg",     None,                "barhayabuzurg",   "deoriasadar"),
    ("Banki",             "banki",             None,              "deoriasadar"),
    ("Jungle Thakurahi",  "junglethakurahi",   None,              "deoriasadar"),
    ("Parsa Jungle",      "parsajangle",       None,              "baitalpur"),
    ("Mishrauliya",       "misraulia",         None,              "baitalpur"),
]

t = pq.read_table("villages.parquet",
                  columns=["vilnam_soi", "vilname11", "dtname", "dtcode11",
                           "block_name", "geometry"],
                  filters=[("dtcode11", "=", "190")])
df = t.to_pylist()
print("Deoria villages loaded:", len(df))

def select(soi, census, block):
    for r in df:
        if norm(r.get("block_name")) != norm(block):
            continue
        if soi and norm(r.get("vilnam_soi")) == soi:
            return r
        if census and norm(r.get("vilname11")) == census:
            return r
    raise SystemExit(f"NO MATCH for {soi or census} in {block}")

feats = []
polys = []
for display, soi, census, block in TARGETS:
    r = select(soi, census, block)
    geom = wkb.loads(bytes(r["geometry"]))
    c = geom.representative_point()
    polys.append(geom)
    matched_name = r.get("vilname11") or r.get("vilnam_soi")
    feats.append({"type": "Feature",
        "properties": {
            "name": display, "kind": "village", "cluster": 1,
            "block": (r.get("block_name") or "").title(),
            "matched": matched_name,
        },
        "geometry": {"type": "Point", "coordinates": [round(c.x, 6), round(c.y, 6)]}})
    print(f"  {display:20s} <- {matched_name!r} (block={r.get('block_name')}) @ {c.x:.4f},{c.y:.4f}")

json.dump({"type": "FeatureCollection", "features": feats},
          open(f"{OUT}/villages.geojson", "w"))
print("villages.geojson:", len(feats))

# cluster-1 boundary: convex hull of the 5 village polygons, buffered a touch
hull = unary_union(polys).convex_hull.buffer(0.01)  # ~1km padding
cluster = {"type": "FeatureCollection", "features": [{
    "type": "Feature",
    "properties": {"name": "Cluster 1", "cluster": 1, "status": "confirmed",
                   "villages": [f["properties"]["name"] for f in feats],
                   "block": "Deoria Sadar", "district": "Deoria"},
    "geometry": mapping(hull.simplify(0.001))}]}
json.dump(cluster, open(f"{OUT}/clusters.geojson", "w"))
print("clusters.geojson written; hull bounds:", [round(x,3) for x in hull.bounds])
