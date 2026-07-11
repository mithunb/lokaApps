"""Shared helpers for the LOKA Atlas dataset builder.

Progress protocol: JSON lines on stdout, parsed by api/lib/atlas/jobs.js —
  {"event":"progress","step":"lulc","pct":55,"msg":"..."}
  {"event":"warn","msg":"..."} {"event":"done"} {"event":"error","msg":"..."}
"""
import json
import os
import sys

import requests
from shapely.geometry import shape, box
from shapely.ops import unary_union

UA = {"User-Agent": "LOKA-Atlas-Builder (mithun@socratus.org)"}
R2 = "https://pub-0429b8e3b5a946e69ea007df844a6f1c.r2.dev/"
WORLDCOVER = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_%s_Map.tif"


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


# Each recipe reports its own 0–100% progress; the orchestrator assigns it a
# window (base + span) of the overall bar via set_window() so the bar only ever
# moves forward. The active layer's name/number ride along for the UI headline.
_WIN = {"base": 0.0, "span": 100.0, "label": "", "num": 0, "total": 0}


def set_window(base, span, label="", num=0, total=0):
    _WIN["base"] = float(base)
    _WIN["span"] = float(span)
    _WIN["label"] = label or ""
    _WIN["num"] = int(num or 0)
    _WIN["total"] = int(total or 0)


def progress(step, pct, msg=""):
    try:
        local = max(0.0, min(100.0, float(pct)))
    except Exception:
        local = 0.0
    overall = int(max(0, min(99, round(_WIN["base"] + local / 100.0 * _WIN["span"]))))
    emit({"event": "progress", "step": step, "pct": overall, "msg": msg,
          "layer": _WIN["label"], "lnum": _WIN["num"], "ltot": _WIN["total"]})


def warn(msg):
    emit({"event": "warn", "msg": str(msg)})


def fetch_cached(url, cache_dir, name=None, step="fetch"):
    """Download url into cache_dir once; return the local path."""
    os.makedirs(cache_dir, exist_ok=True)
    name = name or url.rstrip("/").split("/")[-1].split("?")[0]
    dest = os.path.join(cache_dir, name)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    progress(step, 0, f"downloading {name}")
    tmp = dest + ".part"
    with requests.get(url, headers=UA, stream=True, timeout=300) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length") or 0)
        got = 0
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
                got += len(chunk)
                if total > 4 << 20:
                    progress(step, min(99, int(100 * got / total)) if total else 0,
                             f"downloading {name} ({got >> 20} MB)")
    os.replace(tmp, dest)
    return dest


def load_selection(spec):
    """Union geometry + bbox of the admin units the org picked in the wizard.

    Reads the geoBoundaries geocache doc Node passed via spec.region.simplifiedFile.
    """
    r = spec["region"]
    doc = json.load(open(r["simplifiedFile"]))
    want = set(r["shapeIDs"])
    feats = [f for f in doc["features"] if f["properties"]["id"] in want]
    if not feats:
        raise RuntimeError("selection not found in boundary cache")
    geom = unary_union([shape(f["geometry"]).buffer(0) for f in feats])
    return geom, list(geom.bounds), feats


def pad_bbox(b, frac=0.06):
    w, s, e, n = b
    dx, dy = (e - w) * frac, (n - s) * frac
    return [w - dx, s - dy, e + dx, n + dy]


def bbox_geom(b):
    return box(b[0], b[1], b[2], b[3])


def bbi(row, b):
    """bbox-index prefilter for Bharatlas parquet rows carrying xmin..ymax."""
    return not (float(row["xmax"]) < b[0] or float(row["xmin"]) > b[2] or
                float(row["ymax"]) < b[1] or float(row["ymin"]) > b[3])


def write_geojson(out_dir, name, feats):
    p = os.path.join(out_dir, name)
    json.dump({"type": "FeatureCollection", "features": feats}, open(p, "w"))
    return p


def worldcover_tiles(b):
    """ESA WorldCover v200 3°-grid tile names covering bbox b."""
    import math
    w, s, e, n = b
    names = []
    lat0 = int(math.floor(s / 3.0) * 3)
    lon0 = int(math.floor(w / 3.0) * 3)
    lat = lat0
    while lat < n:
        lon = lon0
        while lon < e:
            ns = "N" if lat >= 0 else "S"
            ew = "E" if lon >= 0 else "W"
            names.append(f"{ns}{abs(lat):02d}{ew}{abs(lon):03d}")
            lon += 3
        lat += 3
    return names


def read_cog_window(bbox, res, tiles, step, resampling="nearest", dtype="float32", fill=0.0):
    """Windowed /vsicurl/ reads of remote COGs/GeoTIFFs covering bbox into one array.

    `tiles` is a list of (name, url). Missing or unreadable tiles are warned and
    skipped — nothing is stored on disk. Returns (arr, transform, (W,H), extent)
    with extent = (west, south, east, north); arr is None if no tile overlapped.
    Mirrors the WorldCover windowed-read pattern used by the LULC recipe.
    """
    import numpy as np
    import rasterio
    from rasterio.windows import from_bounds
    from rasterio.transform import from_origin
    from rasterio.enums import Resampling

    rs = getattr(Resampling, resampling)
    X0, Y0, X1, Y1 = bbox
    W = max(1, int(round((X1 - X0) / res)))
    H = max(1, int(round((Y1 - Y0) / res)))
    X1e = X0 + W * res
    Y0e = Y1 - H * res
    transform = from_origin(X0, Y1, res, res)
    arr = np.full((H, W), fill, dtype=dtype)
    got = False
    for i, (name, url) in enumerate(tiles):
        progress(step, 8 + int(52 * i / max(len(tiles), 1)), f"reading {name}")
        try:
            with rasterio.open("/vsicurl/" + url) as ds:
                bb = ds.bounds
                ix0, ix1 = max(X0, bb.left), min(X1e, bb.right)
                iy0, iy1 = max(Y0e, bb.bottom), min(Y1, bb.top)
                if ix0 >= ix1 or iy0 >= iy1:
                    continue
                col0 = int(round((ix0 - X0) / res)); col1 = int(round((ix1 - X0) / res))
                row0 = int(round((Y1 - iy1) / res)); row1 = int(round((Y1 - iy0) / res))
                if row1 <= row0 or col1 <= col0:
                    continue
                win = from_bounds(ix0, iy0, ix1, iy1, ds.transform)
                sub = ds.read(1, window=win, out_shape=(row1 - row0, col1 - col0), resampling=rs)
                arr[row0:row1, col0:col1] = sub
                got = True
        except Exception as ex:
            warn(f"tile {name} unavailable: {ex}")
    return (arr if got else None), transform, (W, H), (X0, Y0e, X1e, Y1)


def fetch_wcs_array(url, step, name, timeout=180):
    """GET a WCS GetCoverage GeoTIFF and read it in memory — nothing hits disk.

    Returns (arr float32, transform, (W,H), extent=(w,s,e,n)). Raises on failure
    so the orchestrator can skip a non-required layer gracefully.
    """
    import rasterio
    from rasterio.io import MemoryFile

    progress(step, 12, f"requesting {name}")
    r = requests.get(url, headers=UA, timeout=timeout)
    r.raise_for_status()
    with MemoryFile(r.content) as mf:
        with mf.open() as ds:
            arr = ds.read(1).astype("float32")
            b = ds.bounds
            transform = ds.transform
            size = (ds.width, ds.height)
    return arr, transform, size, (b.left, b.bottom, b.right, b.top)
