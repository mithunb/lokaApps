#!/usr/bin/env python3
"""Build ecological vector layers: rivers, basin, wetlands, floodplain, canals, agro-zones."""
import json
import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import shape, mapping, box
from shapely.ops import unary_union

OUT = "/Users/mithunsheshagiri/work/lokaApps/atlas/datasets/deoria-bioregion"
X0, Y0, X1, Y1 = 82.95, 25.95, 84.55, 27.40
REGION = box(X0, Y0, X1, Y1)

def bbi(r):
    return not (float(r["xmax"]) < X0 or float(r["xmin"]) > X1 or
                float(r["ymax"]) < Y0 or float(r["ymin"]) > Y1)

import os
def write(name, features):
    path = f"{OUT}/{name}"
    json.dump({"type": "FeatureCollection", "features": features}, open(path, "w"))
    print(f"  {name}: {len(features)} features, {os.path.getsize(path)//1024} KB")

def gbounds(coords):
    xs, ys = [], []
    def w(c):
        if c and isinstance(c[0], (int, float)): xs.append(c[0]); ys.append(c[1])
        else:
            for x in c: w(x)
    w(coords); return xs, ys

# ---- RIVERS ----------------------------------------------------------------
t = pq.read_table("rivers.parquet",
                  columns=["rivname", "layer", "sub_basin", "geometry", "xmin", "ymin", "xmax", "ymax"]).to_pylist()
feats = []
for r in t:
    if not bbi(r): continue
    g = wkb.loads(bytes(r["geometry"])).intersection(REGION)
    if g.is_empty: continue
    g = g.simplify(0.0003, preserve_topology=True)
    feats.append({"type": "Feature", "properties": {
        "name": (r["rivname"] or "").strip() or None, "layer": r["layer"],
        "sub_basin": r["sub_basin"], "kind": "river"}, "geometry": mapping(g)})
write("rivers.geojson", feats)

# ---- BASIN (framing: Ghaghara + Gandak sub-basins) -------------------------
d = json.load(open("subbasin.geojson"))
keep = {"Ghaghara", "Gandak and others"}
feats = []
for f in d["features"]:
    p = f["properties"]
    if p["sub_basin"] in keep:
        g = shape(f["geometry"]).buffer(0).simplify(0.006, preserve_topology=True)
        feats.append({"type": "Feature", "properties": {
            "name": p["sub_basin"], "basin": p["ba_name"], "kind": "basin"}, "geometry": mapping(g)})
write("basin.geojson", feats)

# ---- WETLANDS (larger / notable; exclude non-wetland filler) ---------------
t = pq.read_table("wetlands.parquet",
                  columns=["wetname", "descr", "level2", "areaha", "geometry", "xmin", "ymin", "xmax", "ymax"]).to_pylist()
feats = []
for r in t:
    if not bbi(r): continue
    if "non-wetland" in str(r.get("descr", "")).lower(): continue
    try: area = float(r.get("areaha") or 0)
    except: area = 0
    named = bool(str(r.get("wetname", "")).strip())
    if area < 10 and not named: continue          # keep >=10 ha OR named
    g = wkb.loads(bytes(r["geometry"])).intersection(REGION)
    if g.is_empty: continue
    g = g.buffer(0).simplify(0.0003, preserve_topology=True)
    if g.is_empty: continue
    feats.append({"type": "Feature", "properties": {
        "name": str(r.get("wetname", "")).strip() or None,
        "type": str(r.get("descr", "")).strip(),
        "category": str(r.get("level2", "")).strip(),
        "area_ha": round(area, 1), "kind": "wetland"}, "geometry": mapping(g)})
write("wetlands.geojson", feats)

# ---- FLOODPLAIN (NDEM observed inundation, dissolved) ----------------------
t = pq.read_table("floods.parquet",
                  columns=["geometry", "xmin", "ymin", "xmax", "ymax"]).to_pylist()
polys = []
for r in t:
    if not bbi(r): continue
    g = wkb.loads(bytes(r["geometry"]))
    if not g.is_empty: polys.append(g)
print(f"  floods: buffer-merging {len(polys)} inundation patches into zones...")
# grow ~250m to coalesce adjacent patches, dissolve, shrink back ~150m, simplify, drop specks
merged = unary_union([p.buffer(0.0022) for p in polys]).buffer(-0.0013)
merged = merged.intersection(REGION).simplify(0.0009, preserve_topology=True)
geoms = list(merged.geoms) if merged.geom_type.startswith("Multi") else [merged]
geoms = [g for g in geoms if not g.is_empty and g.area > 0.00004]   # drop < ~0.5 km²
feats = [{"type": "Feature", "properties": {"kind": "floodplain"}, "geometry": mapping(g)}
         for g in geoms]
write("floodplain.geojson", feats)

# ---- CANALS ----------------------------------------------------------------
d = json.load(open("canals.geojson"))
feats = []
for f in d["features"]:
    xs, ys = gbounds(f["geometry"]["coordinates"])
    if not xs: continue
    if max(xs) < X0 or min(xs) > X1 or max(ys) < Y0 or min(ys) > Y1: continue
    g = shape(f["geometry"]).intersection(REGION)
    if g.is_empty: continue
    g = g.simplify(0.0004, preserve_topology=True)
    p = f["properties"]
    feats.append({"type": "Feature", "properties": {
        "name": (p.get("canname") or "").strip() or "Canal",
        "project": (p.get("prjname") or "").strip() or None, "kind": "canal"}, "geometry": mapping(g)})
write("canals.geojson", feats)

# ---- AGRO-ECOLOGICAL ZONES (framing) ---------------------------------------
d = json.load(open("agro.geojson"))
feats = []
for f in d["features"]:
    xs, ys = gbounds(f["geometry"]["coordinates"])
    if not xs: continue
    if max(xs) < X0 or min(xs) > X1 or max(ys) < Y0 or min(ys) > Y1: continue
    g = shape(f["geometry"]).buffer(0).simplify(0.008, preserve_topology=True)
    feats.append({"type": "Feature", "properties": {
        "name": " ".join(w.capitalize() for w in f["properties"]["physio_reg"].split()),
        "kind": "agro_zone"}, "geometry": mapping(g)})
write("agro_zones.geojson", feats)

print("done.")
