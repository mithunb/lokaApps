#!/usr/bin/env python3
"""Build forests.geojson — reserved/protected forests clipped to the 3 districts."""
import json, re
import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

OUT = "/Users/mithunsheshagiri/work/lokaApps/atlas/datasets/deoria-bioregion"

# district union to clip to
d = json.load(open(f"{OUT}/districts.geojson"))
region = unary_union([shape(f["geometry"]).buffer(0) for f in d["features"]])
rx0, ry0, rx1, ry1 = region.bounds

def clean(s):
    s = (s or "").strip().replace(">", "A").replace("|", "I").replace("@", "A")
    s = re.sub(r"\s+", " ", s)
    # title-case words, keep RF/PF suffix upper
    parts = [w if w in ("RF", "PF") else w.capitalize() for w in s.split()]
    return " ".join(parts)

t = pq.read_table("forests.parquet",
                  columns=["type", "addl_info", "geometry", "xmin", "ymin", "xmax", "ymax"]).to_pylist()
feats = []
kinds = {}
for r in t:
    try:
        if float(r["xmax"]) < rx0 or float(r["xmin"]) > rx1 or float(r["ymax"]) < ry0 or float(r["ymin"]) > ry1:
            continue
    except Exception:
        continue
    g = wkb.loads(bytes(r["geometry"])).buffer(0)
    g = g.intersection(region)               # clip to the 3 districts
    if g.is_empty or g.area == 0:
        continue
    g = g.simplify(0.0003, preserve_topology=True)
    if g.is_empty:
        continue
    typ = (r.get("type") or "").strip().title() or "Forest"   # Reserved / Protected / Minor
    kinds[typ] = kinds.get(typ, 0) + 1
    feats.append({"type": "Feature", "properties": {
        "name": clean(r.get("addl_info")) or None, "type": typ, "kind": "forest"},
        "geometry": mapping(g)})

json.dump({"type": "FeatureCollection", "features": feats}, open(f"{OUT}/forests.geojson", "w"))
import os
print(f"forests.geojson: {len(feats)} features, {os.path.getsize(f'{OUT}/forests.geojson')//1024} KB")
print("by type:", kinds)
print("sample names:", sorted(set(f["properties"]["name"] for f in feats if f["properties"]["name"]))[:20])
EOF = None
