#!/usr/bin/env python3
"""Build builtup.geojson — urban / built-up areas from ESA WorldCover 'built-up' (class 50),
buffer-merged and size-filtered to town/city footprints (drops village-scale specks).
An open land-cover proxy for urban centres; official ULB admin boundaries aren't open."""
import os, json
os.environ["GDAL_DISABLE_READDIR_ON_OPEN"] = "EMPTY_DIR"
os.environ["CPL_VSIL_CURL_ALLOWED_EXTENSIONS"] = ".tif"
import numpy as np, rasterio
from rasterio.windows import from_bounds
from rasterio.transform import from_origin
from rasterio.features import shapes
from rasterio.enums import Resampling
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

OUT = "/Users/mithunsheshagiri/work/lokaApps/atlas/datasets/deoria-bioregion"
B = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_%s_Map.tif"
TILES = {"N24E081": (81, 24, 84, 27), "N24E084": (84, 24, 87, 27),
         "N27E081": (81, 27, 84, 30), "N27E084": (84, 27, 87, 30)}

region = unary_union([shape(f["geometry"]).buffer(0) for f in json.load(open(f"{OUT}/districts.geojson"))["features"]])
X0, Y0, X1, Y1 = [region.bounds[0] - .01, region.bounds[1] - .01, region.bounds[2] + .01, region.bounds[3] + .01]
RES = 0.0006
W = int(round((X1 - X0) / RES)); H = int(round((Y1 - Y0) / RES))
transform = from_origin(X0, Y1, RES, RES)
cls = np.zeros((H, W), dtype=np.uint8)

for name, (tx0, ty0, tx1, ty1) in TILES.items():
    ix0, ix1 = max(X0, tx0), min(X1, tx1)
    iy0, iy1 = max(Y0, ty0), min(Y1, ty1)
    if ix0 >= ix1 or iy0 >= iy1:
        continue
    col0 = int(round((ix0 - X0) / RES)); col1 = int(round((ix1 - X0) / RES))
    row0 = int(round((Y1 - iy1) / RES)); row1 = int(round((Y1 - iy0) / RES))
    with rasterio.open("/vsicurl/" + (B % name)) as ds:
        win = from_bounds(ix0, iy0, ix1, iy1, ds.transform)
        arr = ds.read(1, window=win, out_shape=(row1 - row0, col1 - col0), resampling=Resampling.nearest)
    cls[row0:row1, col0:col1] = arr
    print(f"  {name}: read")

builtup = (cls == 50).astype(np.uint8)
polys = [shape(g) for g, v in shapes(builtup, mask=builtup.astype(bool), transform=transform) if v == 1]
print(f"  raw built-up patches: {len(polys)}")
# merge nearby patches into town footprints, drop village-scale specks
merged = unary_union([p.buffer(0.0006) for p in polys]).buffer(-0.00045).intersection(region)
geoms = list(merged.geoms) if merged.geom_type.startswith("Multi") else [merged]
KEEP = 0.00016   # ~2 km² — keep genuine town/city footprints, drop village chains
feats = []
for g in geoms:
    if g.is_empty or g.area < KEEP:
        continue
    g = g.simplify(0.0005, preserve_topology=True)
    feats.append({"type": "Feature", "properties": {"kind": "builtup",
        "area_km2": round(g.area * 111 * 111, 1)}, "geometry": mapping(g)})

feats.sort(key=lambda f: -f["properties"]["area_km2"])
json.dump({"type": "FeatureCollection", "features": feats}, open(f"{OUT}/builtup.geojson", "w"))
print(f"builtup.geojson: {len(feats)} urban footprints, {os.path.getsize(f'{OUT}/builtup.geojson')//1024} KB")
print("largest (km²):", [f["properties"]["area_km2"] for f in feats[:8]])
