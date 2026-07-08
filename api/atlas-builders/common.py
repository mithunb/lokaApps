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


def progress(step, pct, msg=""):
    emit({"event": "progress", "step": step, "pct": pct, "msg": msg})


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
