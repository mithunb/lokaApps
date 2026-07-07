#!/usr/bin/env python3
"""Build lulc.png + lulc.json — ESA WorldCover 2021, colorized, clipped to the 3 districts."""
import json, numpy as np, rasterio
from rasterio.windows import from_bounds
from rasterio.transform import from_origin
from rasterio.features import geometry_mask
from rasterio.enums import Resampling
from shapely.geometry import shape
from shapely.ops import unary_union
from PIL import Image

OUT = "/Users/mithunsheshagiri/work/lokaApps/atlas/datasets/deoria-bioregion"
# snug extent around the 3 districts
X0, Y0, X1, Y1 = 83.05, 26.07, 84.44, 27.32
RES = 0.00055
W = int(round((X1 - X0) / RES)); H = int(round((Y1 - Y0) / RES))
X1e = X0 + W * RES; Y0e = Y1 - H * RES          # exact east/south after rounding
out_transform = from_origin(X0, Y1, RES, RES)

TILES = ["wc_81.tif", "wc_84.tif", "wc_n27_81.tif", "wc_n27_84.tif"]
PALETTE = {10:(0,100,0),20:(255,187,34),30:(255,255,76),40:(240,150,255),50:(250,0,0),
           60:(180,180,180),70:(240,240,240),80:(0,100,200),90:(0,150,160),95:(0,207,117),100:(250,230,160)}
LABEL = {10:"Tree cover",20:"Shrubland",30:"Grassland",40:"Cropland",50:"Built-up",
         60:"Bare / sparse",70:"Snow & ice",80:"Water",90:"Herbaceous wetland",95:"Mangroves",100:"Moss & lichen"}

cls = np.zeros((H, W), dtype=np.uint8)
for t in TILES:
    ds = rasterio.open(t)
    b = ds.bounds
    ix0, ix1 = max(X0, b.left), min(X1e, b.right)
    iy0, iy1 = max(Y0e, b.bottom), min(Y1, b.top)
    if ix0 >= ix1 or iy0 >= iy1:
        continue
    col0 = int(round((ix0 - X0) / RES)); col1 = int(round((ix1 - X0) / RES))
    row0 = int(round((Y1 - iy1) / RES)); row1 = int(round((Y1 - iy0) / RES))
    oh, ow = row1 - row0, col1 - col0
    if oh <= 0 or ow <= 0:
        continue
    win = from_bounds(ix0, iy0, ix1, iy1, ds.transform)
    arr = ds.read(1, window=win, out_shape=(oh, ow), resampling=Resampling.nearest)
    cls[row0:row1, col0:col1] = arr
    print(f"  {t}: placed [{row0}:{row1},{col0}:{col1}]")

# colorize
rgba = np.zeros((H, W, 4), dtype=np.uint8)
present = {}
for v, (r, g, bl) in PALETTE.items():
    m = cls == v
    n = int(m.sum())
    if n:
        rgba[m] = (r, g, bl, 255)
        present[v] = n

# clip to district union
d = json.load(open(f"{OUT}/districts.geojson"))
union = unary_union([shape(f["geometry"]) for f in d["features"]])
inside = geometry_mask([union.__geo_interface__], out_shape=(H, W), transform=out_transform, invert=True)
rgba[~inside] = (0, 0, 0, 0)

Image.fromarray(rgba, "RGBA").save(f"{OUT}/lulc.png", optimize=True)

# legend: classes present inside the districts, by pixel count
present_inside = {}
ci = cls.copy(); ci[~inside] = 0
for v in PALETTE:
    n = int((ci == v).sum())
    if n > 0:
        present_inside[v] = n
total = sum(present_inside.values()) or 1
legend = [{"value": v, "label": LABEL[v],
           "color": "#%02x%02x%02x" % PALETTE[v],
           "pct": round(100 * present_inside[v] / total, 1)}
          for v in sorted(present_inside, key=lambda k: -present_inside[k])]

meta = {
    "image": "lulc.png",
    # MapLibre image-source corner order: TL, TR, BR, BL  ([lon,lat])
    "coordinates": [[X0, Y1], [X1e, Y1], [X1e, Y0e], [X0, Y0e]],
    "bounds": [X0, Y0e, X1e, Y1],
    "size": [W, H],
    "legend": legend,
    "source": "ESA WorldCover 2021 v200 (10 m), clipped to districts, resampled ~60 m",
}
json.dump(meta, open(f"{OUT}/lulc.json", "w"), indent=2)

import os
print(f"lulc.png: {W}x{H}, {os.path.getsize(f'{OUT}/lulc.png')//1024} KB")
print("legend (share of district area):")
for l in legend:
    print(f"   {l['label']:20s} {l['pct']:5.1f}%  {l['color']}")
