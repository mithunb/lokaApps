#!/usr/bin/env python3
"""Block-level 'wasteland' choropleth = share of uncultivated open/barren land
(ESA WorldCover classes shrub+grass+bare) per block. Open, reproducible proxy for
revenue wasteland (culturable waste + barren), which isn't openly available as GIS."""
import os, json
os.environ["GDAL_DISABLE_READDIR_ON_OPEN"] = "EMPTY_DIR"
os.environ["CPL_VSIL_CURL_ALLOWED_EXTENSIONS"] = ".tif"
import numpy as np, rasterio
from rasterio.windows import from_bounds
from rasterio.transform import from_origin
from rasterio.features import rasterize
from rasterio.enums import Resampling
from shapely.geometry import shape

OUT = "/Users/mithunsheshagiri/work/lokaApps/atlas/datasets/deoria-bioregion"
B = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_%s_Map.tif"
TILES = {"N24E081": (81, 24, 84, 27), "N24E084": (84, 24, 87, 27),
         "N27E081": (81, 27, 84, 30), "N27E084": (84, 27, 87, 30)}

blocks = json.load(open(f"{OUT}/blocks.geojson"))["features"]
xs, ys = [], []
for f in blocks:
    g = shape(f["geometry"]); b = g.bounds
    xs += [b[0], b[2]]; ys += [b[1], b[3]]
X0, Y0, X1, Y1 = min(xs) - .01, min(ys) - .01, max(xs) + .01, max(ys) + .01
RES = 0.001
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
    oh, ow = row1 - row0, col1 - col0
    if oh <= 0 or ow <= 0:
        continue
    with rasterio.open("/vsicurl/" + (B % name)) as ds:
        win = from_bounds(ix0, iy0, ix1, iy1, ds.transform)
        arr = ds.read(1, window=win, out_shape=(oh, ow), resampling=Resampling.nearest)
    cls[row0:row1, col0:col1] = arr
    print(f"  {name}: read [{row0}:{row1},{col0}:{col1}]")

# rasterize block ids (1..n)
shapes = [(f["geometry"], i + 1) for i, f in enumerate(blocks)]
bid = rasterize(shapes, out_shape=(H, W), transform=transform, fill=0, dtype="int32")

OPEN = np.isin(cls, [20, 30, 60])       # shrub + grass + bare/sparse
land = cls > 0
n = len(blocks)
feats = []
rows = []
for i, f in enumerate(blocks):
    m = bid == (i + 1)
    tot = int((m & land).sum())
    op = int((m & OPEN).sum())
    pct = round(100.0 * op / tot, 1) if tot else 0.0
    p = f["properties"]
    feats.append({"type": "Feature", "properties": {
        "name": p["name"], "district": p["district"], "kind": "wasteland",
        "wl_pct": pct}, "geometry": f["geometry"]})
    rows.append((pct, p["name"], p["district"]))

json.dump({"type": "FeatureCollection", "features": feats}, open(f"{OUT}/wasteland.geojson", "w"))
import os as _os
print(f"wasteland.geojson: {len(feats)} blocks, {_os.path.getsize(f'{OUT}/wasteland.geojson')//1024} KB")
vals = [r[0] for r in rows]
print("wl_pct min/median/max:", min(vals), sorted(vals)[len(vals)//2], max(vals))
print("highest:", sorted(rows, reverse=True)[:6])
