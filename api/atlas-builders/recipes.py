"""Layer recipes for the LOKA Atlas builder.

Each recipe is `def <name>(ctx) -> list[dict]`: it writes its data files into
ctx["out"] and returns the manifest layer stanzas describing them. Styling is
ported from the proven deoria-bioregion manifest. A recipe that finds nothing
returns [] (the orchestrator warns and moves on).

ctx keys: spec, tier, out, cache, sel (shapely geometry of the picked units),
bbox (padded [w,s,e,n]), clip (shapely box of bbox).
"""
import json
import os
import re
import unicodedata

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")

import requests
from shapely import wkb
from shapely.geometry import shape, mapping, LineString
from shapely.ops import unary_union

from common import (
    R2, UA, WORLDCOVER, bbi, fetch_cached, fetch_wcs_array, progress,
    read_cog_window, warn, write_geojson, worldcover_tiles,
)


# ---------------------------------------------------------------- admin

def admin(ctx):
    if ctx["tier"] == "india":
        return _admin_lgd(ctx)
    return _admin_geoboundaries(ctx)


def _admin_geoboundaries(ctx):
    progress("admin", 5, "fetching full-resolution boundaries")
    url = ctx["spec"]["region"]["fullResUrl"]
    path = fetch_cached(url, ctx["cache"], name=f"gb-{ctx['spec']['region']['iso3']}-ADM{ctx['spec']['region']['level']}.geojson", step="admin")
    gj = json.load(open(path))
    want = set(ctx["spec"]["region"]["shapeIDs"])
    feats = []
    for f in gj.get("features", []):
        p = f.get("properties", {})
        fid = p.get("shapeID") or p.get("shapeName")
        if fid not in want:
            continue
        g = shape(f["geometry"]).buffer(0).simplify(0.0007, preserve_topology=True)
        feats.append({"type": "Feature", "properties": {
            "name": p.get("shapeName") or fid, "kind": "admin"}, "geometry": mapping(g)})
    progress("admin", 90, f"{len(feats)} units")
    if not feats:
        raise RuntimeError("no admin units matched the selection")
    write_geojson(ctx["out"], "admin.geojson", feats)
    return [_admin_stanza("admin.geojson")]


def _admin_lgd(ctx):
    progress("admin", 5, "fetching LGD districts")
    path = fetch_cached(R2 + "admin/districts/LGD_Districts.geojson", ctx["cache"], step="admin")
    gj = json.load(open(path))
    sel = ctx["sel"]
    feats = []
    for f in gj["features"]:
        p = f["properties"]
        g = shape(f["geometry"]).buffer(0)
        inter = g.intersection(sel)
        if inter.is_empty or inter.area / max(g.area, 1e-12) < 0.5:
            continue
        g = g.simplify(0.0007, preserve_topology=True)
        name = str(p.get("dtname") or "").strip().title()
        feats.append({"type": "Feature", "properties": {
            "name": name, "kind": "admin", "dist_lgd": p.get("dist_lgd"),
            "state": str(p.get("stname") or "").strip().title()}, "geometry": mapping(g)})
    progress("admin", 90, f"{len(feats)} districts")
    if not feats:
        raise RuntimeError("no LGD districts matched the selection")
    write_geojson(ctx["out"], "admin.geojson", feats)
    # the LGD polygons ARE the region now — sharpen the selection for later recipes
    ctx["sel"] = unary_union([shape(f["geometry"]) for f in feats])
    return [_admin_stanza("admin.geojson")]


def _admin_stanza(source):
    return {
        "id": "admin", "group": "base", "type": "fill", "source": source,
        "label": "Admin boundaries", "default": True,
        "paint": {"fillColor": "#000000", "fillOpacity": 0, "outlineColor": "#B0863A", "outlineWidth": 2.6},
        "label_text": {"property": "name", "size": 15, "color": "#1e2a1c", "haloColor": "#ffffff",
                       "haloWidth": 2.2, "transform": "uppercase", "letterSpacing": 0.12, "minzoom": 7,
                       "alwaysShow": True},
        "legend": [{"color": "#B0863A", "label": "Boundary", "shape": "line"}],
        "popup": {"title": "name", "fields": [{"label": "State", "property": "state"}]},
    }


# ---------------------------------------------------------------- subadmin (india blocks)

def subadmin(ctx):
    progress("subadmin", 5, "fetching LGD blocks (cached after first build)")
    path = fetch_cached(R2 + "admin/blocks/LGD_Blocks.geojson", ctx["cache"], step="subadmin")
    gj = json.load(open(path))
    sel = ctx["sel"]
    w, s, e, n = sel.bounds
    feats = []
    for f in gj["features"]:
        g = shape(f["geometry"])
        gb = g.bounds
        if gb[2] < w or gb[0] > e or gb[3] < s or gb[1] > n:
            continue
        g = g.buffer(0)
        if not g.representative_point().within(sel):
            continue
        p = f["properties"]
        g = g.simplify(0.0004, preserve_topology=True)
        feats.append({"type": "Feature", "properties": {
            "name": str(p.get("block_name") or "").strip().title(),
            "district": str(p.get("district") or "").strip().title(),
            "block_lgd": p.get("block_lgd"), "kind": "block"}, "geometry": mapping(g)})
    progress("subadmin", 90, f"{len(feats)} blocks")
    if not feats:
        return []
    write_geojson(ctx["out"], "subadmin.geojson", feats)
    return [{
        "id": "subadmin", "group": "base", "type": "fill", "source": "subadmin.geojson",
        "label": "Block boundaries & labels", "default": True,
        "paint": {"fillColor": "#000000", "fillOpacity": 0, "outlineColor": "#5c544a", "outlineWidth": 1, "outlineOpacity": 0.42},
        "label_text": {"property": "name", "size": 11, "color": "#2b2723", "haloColor": "#ffffff", "haloWidth": 1.6, "minzoom": 9},
        "popup": {"title": "name", "subtitleProperty": "district", "fields": []},
    }]


# ---------------------------------------------------------------- water (OSM, global tier)

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

def water_osm(ctx):
    w, s, e, n = ctx["bbox"]
    q = f'[out:json][timeout:90];way["waterway"~"^(river|canal)$"]({s},{w},{n},{e});out geom;'
    data = None
    for url in OVERPASS:
        try:
            progress("water", 10, f"querying OpenStreetMap waterways")
            r = requests.post(url, data={"data": q}, headers=UA, timeout=120)
            r.raise_for_status()
            data = r.json()
            break
        except Exception as ex:
            warn(f"overpass {url.split('/')[2]} failed: {ex}")
    if data is None:
        warn("waterways skipped — OpenStreetMap Overpass unavailable")
        return []
    clip = ctx["clip"]
    feats = []
    for el in data.get("elements", []):
        pts = [(p["lon"], p["lat"]) for p in el.get("geometry", [])]
        if len(pts) < 2:
            continue
        g = LineString(pts).intersection(clip)
        if g.is_empty:
            continue
        g = g.simplify(0.0003, preserve_topology=True)
        tags = el.get("tags", {})
        feats.append({"type": "Feature", "properties": {
            "name": tags.get("name") or tags.get("name:en"),
            "wtype": tags.get("waterway"), "kind": "waterway"}, "geometry": mapping(g)})
    progress("water", 90, f"{len(feats)} waterways")
    if not feats:
        return []
    write_geojson(ctx["out"], "water.geojson", feats)
    return [{
        "id": "water", "group": "eco", "subgroup": "Water", "type": "line", "source": "water.geojson",
        "label": "Rivers & waterways", "default": False,
        "paint": {"color": "#5f7f92", "width": ["match", ["get", "wtype"], "river", 2.0, 1.1], "opacity": 0.95},
        "label_text": {"property": "name", "size": 11, "color": "#35505f", "haloColor": "#eaf2ff", "haloWidth": 1.4, "minzoom": 9},
        "legend": [{"color": "#5f7f92", "label": "River / canal", "shape": "line"}],
        "popup": {"title": "name", "fields": [{"label": "Type", "property": "wtype"}]},
    }]


# ---------------------------------------------------------------- WRIS water (india tier)

def rivers_wris(ctx):
    import pyarrow.parquet as pq
    progress("rivers", 5, "fetching WRIS rivers (cached after first build)")
    path = fetch_cached(R2 + "water/rivers/WRIS_Rivers.parquet", ctx["cache"], step="rivers")
    b = ctx["bbox"]; clip = ctx["clip"]
    t = pq.read_table(path, columns=["rivname", "layer", "sub_basin", "geometry", "xmin", "ymin", "xmax", "ymax"]).to_pylist()
    feats = []
    for r in t:
        if not bbi(r, b):
            continue
        g = wkb.loads(bytes(r["geometry"])).intersection(clip)
        if g.is_empty:
            continue
        g = g.simplify(0.0003, preserve_topology=True)
        feats.append({"type": "Feature", "properties": {
            "name": (r["rivname"] or "").strip() or None, "layer": r["layer"],
            "sub_basin": r["sub_basin"], "kind": "river"}, "geometry": mapping(g)})
    progress("rivers", 60, f"{len(feats)} river segments")
    out = []
    if feats:
        write_geojson(ctx["out"], "rivers.geojson", feats)
        out.append({
            "id": "rivers", "group": "eco", "subgroup": "Water", "type": "line", "source": "rivers.geojson",
            "label": "Rivers & drainage", "default": False,
            "paint": {"color": "#5f7f92", "width": ["case", ["==", ["get", "layer"], "major"], 2.6, 1.1], "opacity": 0.95},
            "label_text": {"property": "name", "size": 11, "color": "#35505f", "haloColor": "#eaf2ff", "haloWidth": 1.4, "minzoom": 9},
            "legend": [{"color": "#5f7f92", "label": "River / stream", "shape": "line"}],
            "popup": {"title": "name", "fields": [{"label": "Class", "property": "layer"}, {"label": "Sub-basin", "property": "sub_basin"}]},
        })

    progress("canals", 65, "fetching WRIS canals")
    cpath = fetch_cached(R2 + "water/canals/WRIS_Canals.geojson", ctx["cache"], step="canals")
    d = json.load(open(cpath))
    cfeats = []
    for f in d["features"]:
        g = shape(f["geometry"])
        gb = g.bounds
        if gb[2] < b[0] or gb[0] > b[2] or gb[3] < b[1] or gb[1] > b[3]:
            continue
        g = g.intersection(clip)
        if g.is_empty:
            continue
        g = g.simplify(0.0004, preserve_topology=True)
        p = f["properties"]
        cfeats.append({"type": "Feature", "properties": {
            "name": (p.get("canname") or "").strip() or "Canal",
            "project": (p.get("prjname") or "").strip() or None, "kind": "canal"}, "geometry": mapping(g)})
    progress("canals", 90, f"{len(cfeats)} canal segments")
    if cfeats:
        write_geojson(ctx["out"], "canals.geojson", cfeats)
        out.append({
            "id": "canals", "group": "eco", "subgroup": "Water", "type": "line", "source": "canals.geojson",
            "label": "Canals", "default": False,
            "paint": {"color": "#7ba0b0", "width": 1.4, "opacity": 0.9},
            "legend": [{"color": "#7ba0b0", "label": "Irrigation canal", "shape": "line"}],
            "popup": {"title": "name", "fields": [{"label": "Project", "property": "project"}]},
        })
    return out


def wetlands_wris(ctx):
    import pyarrow.parquet as pq
    progress("wetlands", 5, "fetching wetlands (cached after first build)")
    path = fetch_cached(R2 + "water/wetlands/Bharatmaps_Parivesh_Wetland_Boundaries.parquet", ctx["cache"], step="wetlands")
    b = ctx["bbox"]; clip = ctx["clip"]
    t = pq.read_table(path, columns=["wetname", "descr", "level2", "areaha", "geometry", "xmin", "ymin", "xmax", "ymax"]).to_pylist()
    feats = []
    for r in t:
        if not bbi(r, b):
            continue
        if "non-wetland" in str(r.get("descr", "")).lower():
            continue
        try:
            area = float(r.get("areaha") or 0)
        except Exception:
            area = 0
        named = bool(str(r.get("wetname", "")).strip())
        if area < 10 and not named:
            continue
        g = wkb.loads(bytes(r["geometry"])).intersection(clip)
        if g.is_empty:
            continue
        g = g.buffer(0).simplify(0.0003, preserve_topology=True)
        if g.is_empty:
            continue
        feats.append({"type": "Feature", "properties": {
            "name": str(r.get("wetname", "")).strip() or None,
            "type": str(r.get("descr", "")).strip(),
            "area_ha": round(area, 1), "kind": "wetland"}, "geometry": mapping(g)})
    progress("wetlands", 90, f"{len(feats)} wetlands")
    if not feats:
        return []
    write_geojson(ctx["out"], "wetlands.geojson", feats)
    return [{
        "id": "wetlands", "group": "eco", "subgroup": "Water", "type": "fill", "source": "wetlands.geojson",
        "label": "Wetlands & water bodies", "default": False,
        "paint": {"fillColor": "#5f8f86", "fillOpacity": 0.7, "outlineColor": "#48706a", "outlineWidth": 0.5},
        "legend": [{"color": "#5f8f86", "label": "Lakes, ponds, riverine wetlands"}],
        "popup": {"title": "name", "titleFallback": "type", "fields": [
            {"label": "Type", "property": "type"}, {"label": "Area", "property": "area_ha", "suffix": " ha"}]},
    }]


def basins_wris(ctx):
    progress("basins", 10, "fetching sub-basins")
    path = fetch_cached(R2 + "water/hydro-boundaries/WRIS_SubBasin.geojson", ctx["cache"], step="basins")
    d = json.load(open(path))
    sel = ctx["sel"]
    feats = []
    for f in d["features"]:
        g = shape(f["geometry"]).buffer(0)
        if not g.intersects(sel):
            continue
        p = f["properties"]
        g = g.simplify(0.006, preserve_topology=True)
        feats.append({"type": "Feature", "properties": {
            "name": p.get("sub_basin"), "basin": p.get("ba_name"), "kind": "basin"}, "geometry": mapping(g)})
    progress("basins", 90, f"{len(feats)} sub-basins")
    if not feats:
        return []
    write_geojson(ctx["out"], "basins.geojson", feats)
    return [{
        "id": "basins", "group": "eco", "subgroup": "Water", "type": "fill", "source": "basins.geojson",
        "label": "River sub-basins", "default": False,
        "paint": {"fillColor": "#8aa2b0", "fillOpacity": 0.08, "outlineColor": "#5f7f92", "outlineWidth": 1.4, "outlineDash": [3, 2]},
        "legend": [{"color": "#5f7f92", "label": "Sub-basin", "shape": "dashed"}],
        "popup": {"title": "name", "fields": [{"label": "Basin", "property": "basin"}]},
    }]


def floodplain_ndem(ctx):
    import pyarrow.parquet as pq
    progress("floodplain", 2, "fetching NDEM flood record (large, cached after first build)")
    path = fetch_cached(R2 + "environment/ndem-floods-1998-2022/NDEM_All_India_Flood_Innundation_1998_to_2022.parquet",
                        ctx["cache"], step="floodplain")
    b = ctx["bbox"]; clip = ctx["clip"]
    t = pq.read_table(path, columns=["geometry", "xmin", "ymin", "xmax", "ymax"]).to_pylist()
    polys = []
    for r in t:
        if not bbi(r, b):
            continue
        g = wkb.loads(bytes(r["geometry"]))
        if not g.is_empty:
            polys.append(g)
    progress("floodplain", 60, f"merging {len(polys)} inundation patches")
    if not polys:
        return []
    merged = unary_union([p.buffer(0.0022) for p in polys]).buffer(-0.0013)
    merged = merged.intersection(clip).simplify(0.0009, preserve_topology=True)
    geoms = list(merged.geoms) if merged.geom_type.startswith("Multi") else [merged]
    geoms = [g for g in geoms if not g.is_empty and g.area > 0.00004]
    feats = [{"type": "Feature", "properties": {"kind": "floodplain"}, "geometry": mapping(g)} for g in geoms]
    progress("floodplain", 90, f"{len(feats)} flood zones")
    write_geojson(ctx["out"], "floodplain.geojson", feats)
    return [{
        "id": "floodplain", "group": "eco", "type": "fill", "source": "floodplain.geojson",
        "label": "Floodplain (observed inundation)", "default": False, "opacityControl": True,
        "paint": {"fillColor": "#6d8ba0", "fillOpacity": 0.35, "outlineColor": "#4f6b7e", "outlineWidth": 0.6},
        "info": "Areas inundated at least once, 1998–2022 (NRSC/ISRO NDEM satellite record).",
        "legend": [{"color": "#6d8ba0", "label": "Historically flooded"}],
    }]


# ---------------------------------------------------------------- WorldCover rasters

PALETTE = {10: (0, 100, 0), 20: (255, 187, 34), 30: (255, 255, 76), 40: (240, 150, 255), 50: (250, 0, 0),
           60: (180, 180, 180), 70: (240, 240, 240), 80: (0, 100, 200), 90: (0, 150, 160), 95: (0, 207, 117), 100: (250, 230, 160)}
LABEL = {10: "Tree cover", 20: "Shrubland", 30: "Grassland", 40: "Cropland", 50: "Built-up",
         60: "Bare / sparse", 70: "Snow & ice", 80: "Water", 90: "Herbaceous wetland", 95: "Mangroves", 100: "Moss & lichen"}


def _read_worldcover(bbox, res, step):
    """Windowed /vsicurl/ reads of the WorldCover COGs covering bbox → class grid."""
    import numpy as np
    import rasterio
    from rasterio.windows import from_bounds
    from rasterio.transform import from_origin
    from rasterio.enums import Resampling

    X0, Y0, X1, Y1 = bbox
    W = int(round((X1 - X0) / res)); H = int(round((Y1 - Y0) / res))
    X1e = X0 + W * res; Y0e = Y1 - H * res
    transform = from_origin(X0, Y1, res, res)
    cls = np.zeros((H, W), dtype=np.uint8)
    tiles = worldcover_tiles([X0, Y0, X1, Y1])
    for i, name in enumerate(tiles):
        progress(step, 10 + int(60 * i / max(len(tiles), 1)), f"reading WorldCover {name}")
        try:
            with rasterio.open("/vsicurl/" + (WORLDCOVER % name)) as ds:
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
                arr = ds.read(1, window=win, out_shape=(row1 - row0, col1 - col0), resampling=Resampling.nearest)
                cls[row0:row1, col0:col1] = arr
        except Exception as ex:
            warn(f"WorldCover tile {name} unavailable: {ex}")
    return cls, transform, (W, H), (X0, Y0e, X1e, Y1)


def lulc_worldcover(ctx):
    import numpy as np
    from rasterio.features import geometry_mask
    from PIL import Image

    sel = ctx["sel"]
    w, s, e, n = sel.bounds
    span = max(e - w, n - s)
    res = max(0.00055, span / 2400)  # cap output ~2400 px on the long side
    cls, transform, (W, H), (X0, Y0e, X1e, Y1) = _read_worldcover([w, s, e, n], res, "lulc")

    progress("lulc", 75, "colorizing & clipping")
    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    for v, (r, g, bl) in PALETTE.items():
        m = cls == v
        if m.any():
            rgba[m] = (r, g, bl, 255)
    inside = geometry_mask([sel.__geo_interface__], out_shape=(H, W), transform=transform, invert=True)
    rgba[~inside] = (0, 0, 0, 0)
    Image.fromarray(rgba, "RGBA").save(os.path.join(ctx["out"], "lulc.png"), optimize=True)

    ci = cls.copy(); ci[~inside] = 0
    present = {int(v): int((ci == v).sum()) for v in PALETTE if (ci == v).any()}
    total = sum(present.values()) or 1
    legend = [{"value": v, "label": LABEL[v], "color": "#%02x%02x%02x" % PALETTE[v],
               "pct": round(100 * present[v] / total, 1)}
              for v in sorted(present, key=lambda k: -present[k])]
    meta = {
        "image": "lulc.png",
        "coordinates": [[X0, Y1], [X1e, Y1], [X1e, Y0e], [X0, Y0e]],
        "bounds": [X0, Y0e, X1e, Y1], "size": [W, H], "legend": legend,
        "source": "ESA WorldCover 2021 v200 (10 m), clipped to the selected region",
    }
    json.dump(meta, open(os.path.join(ctx["out"], "lulc.json"), "w"))
    progress("lulc", 95, f"{W}x{H} px")
    return [{
        "id": "lulc", "group": "eco", "type": "image", "source": "lulc.json",
        "label": "Land use / land cover", "default": False, "opacityControl": True, "opacity": 0.75,
        "info": "ESA WorldCover 2021 (10 m), clipped to your region.",
        "legendFrom": "source",
    }]


def builtup_worldcover(ctx):
    import numpy as np
    from rasterio.features import shapes as rio_shapes

    sel = ctx["sel"]
    w, s, e, n = sel.bounds
    res = 0.0006
    cls, transform, _, _ = _read_worldcover([w - 0.01, s - 0.01, e + 0.01, n + 0.01], res, "builtup")
    progress("builtup", 75, "vectorising built-up patches")
    builtup = (cls == 50).astype(np.uint8)
    polys = [shape(g) for g, v in rio_shapes(builtup, mask=builtup.astype(bool), transform=transform) if v == 1]
    if not polys:
        return []
    merged = unary_union([p.buffer(0.0006) for p in polys]).buffer(-0.00045).intersection(sel)
    geoms = list(merged.geoms) if merged.geom_type.startswith("Multi") else [merged]
    feats = []
    for g in geoms:
        if g.is_empty or g.area < 0.00016:  # ~2 km² — towns, not village specks
            continue
        g = g.simplify(0.0005, preserve_topology=True)
        feats.append({"type": "Feature", "properties": {
            "kind": "builtup", "area_km2": round(g.area * 111 * 111, 1)}, "geometry": mapping(g)})
    feats.sort(key=lambda f: -f["properties"]["area_km2"])
    progress("builtup", 95, f"{len(feats)} town footprints")
    if not feats:
        return []
    write_geojson(ctx["out"], "builtup.geojson", feats)
    return [{
        "id": "builtup", "group": "base", "type": "fill", "source": "builtup.geojson",
        "label": "Urban / built-up areas", "default": False,
        "info": "Town & city footprints from the ESA WorldCover 2021 built-up class — a land-cover proxy for urban centres.",
        "paint": {"fillColor": "#8a7d6d", "fillOpacity": 0.55, "outlineColor": "#5c544a", "outlineWidth": 0.6},
        "legend": [{"color": "#8a7d6d", "label": "Built-up area (WorldCover-derived)"}],
        "popup": {"subtitle": "Urban / built-up area", "fields": [
            {"label": "Approx. footprint", "property": "area_km2", "suffix": " km²"}]},
    }]


# ---------------------------------------------------------------- eco: agro zones, SOI forests, wasteland (india)

def agro_zones(ctx):
    """ICAR agro-ecological regions clipped to the atlas bbox — a framing layer."""
    progress("agro", 5, "fetching agro-ecological zones (cached after first build)")
    path = fetch_cached(R2 + "agriculture/agro-ecological-zones/Agro_Ecological_Zones.geojson",
                        ctx["cache"], step="agro")
    d = json.load(open(path))
    b = ctx["bbox"]; clip = ctx["clip"]
    feats = []
    for f in d["features"]:
        g = shape(f["geometry"]).buffer(0)
        gb = g.bounds
        if gb[2] < b[0] or gb[0] > b[2] or gb[3] < b[1] or gb[1] > b[3]:
            continue
        g = g.intersection(clip)
        if g.is_empty:
            continue
        g = g.simplify(0.008, preserve_topology=True)  # framing layer — coarse is fine
        if g.is_empty:
            continue
        name = " ".join(w.capitalize() for w in str(f["properties"].get("physio_reg") or "").split()) \
            or "Agro-ecological region"
        feats.append({"type": "Feature", "properties": {"name": name, "kind": "agro_zone"},
                      "geometry": mapping(g)})
    progress("agro", 90, f"{len(feats)} zones")
    if not feats:
        return []
    write_geojson(ctx["out"], "agro_zones.geojson", feats)
    return [{
        "id": "agro", "group": "eco", "type": "fill", "source": "agro_zones.geojson",
        "label": "Agro-ecological zones", "default": False,
        "info": "ICAR agro-ecological regions — broad soil-climate framing for the landscape.",
        "paint": {"fillColor": "#9aad5b", "fillOpacity": 0.1, "outlineColor": "#6b7a3f",
                  "outlineWidth": 1.2, "outlineDash": [2, 2]},
        "legend": [{"color": "#6b7a3f", "label": "Agro-ecological region", "shape": "dashed"}],
        "popup": {"title": "name"},
    }]


def _soi_clean(s):
    """SOI topo-sheet names come with encoding artefacts; tidy them up."""
    s = (s or "").strip().replace(">", "A").replace("|", "I").replace("@", "A")
    s = re.sub(r"\s+", " ", s)
    return " ".join(w if w in ("RF", "PF") else w.capitalize() for w in s.split())


def soi_forests(ctx):
    import pyarrow.parquet as pq
    progress("forests-soi", 3, "fetching SOI forests (~80 MB, cached after first build)")
    path = fetch_cached(R2 + "environment/forests/SOI_Forests.parquet", ctx["cache"], step="forests-soi")
    b = ctx["bbox"]; sel = ctx["sel"]
    t = pq.read_table(path, columns=["type", "addl_info", "geometry",
                                     "xmin", "ymin", "xmax", "ymax"]).to_pylist()
    feats = []; kinds = {}
    for r in t:
        if not bbi(r, b):
            continue
        g = wkb.loads(bytes(r["geometry"])).buffer(0).intersection(sel)
        if g.is_empty or g.area == 0:
            continue
        g = g.simplify(0.0003, preserve_topology=True)
        if g.is_empty:
            continue
        typ = (r.get("type") or "").strip().title() or "Forest"
        kinds[typ] = kinds.get(typ, 0) + 1
        feats.append({"type": "Feature", "properties": {
            "name": _soi_clean(r.get("addl_info")) or None, "type": typ, "kind": "forest"},
            "geometry": mapping(g)})
    progress("forests-soi", 90, f"{len(feats)} forest polygons ({kinds})")
    if not feats:
        return []
    write_geojson(ctx["out"], "forests.geojson", feats)
    stanzas = []
    if kinds.get("Reserved"):
        stanzas.append({
            "id": "forests-reserved", "group": "eco", "subgroup": "Forests", "type": "fill",
            "source": "forests.geojson", "label": "Reserved forest", "default": False,
            "filter": ["==", ["get", "type"], "Reserved"],
            "info": "Reserved-forest polygons from Survey of India topo maps.",
            "paint": {"fillColor": "#2f4a30", "fillOpacity": 0.6, "outlineColor": "#22371f", "outlineWidth": 0.8},
            "legend": [{"color": "#2f4a30", "label": "Reserved forest"}],
            "popup": {"title": "name", "titleFallback": "type", "subtitle": "Reserved forest", "fields": []},
        })
    if kinds.get("Protected"):
        stanzas.append({
            "id": "forests-protected", "group": "eco", "subgroup": "Forests", "type": "fill",
            "source": "forests.geojson", "label": "Protected forest", "default": False,
            "filter": ["==", ["get", "type"], "Protected"],
            "info": "Protected-forest polygons from Survey of India topo maps.",
            "paint": {"fillColor": "#6f7d43", "fillOpacity": 0.6, "outlineColor": "#556232", "outlineWidth": 0.8},
            "legend": [{"color": "#6f7d43", "label": "Protected forest"}],
            "popup": {"title": "name", "titleFallback": "type", "subtitle": "Protected forest", "fields": []},
        })
    if not stanzas:  # region only has other SOI forest classes — show them plainly
        stanzas.append({
            "id": "forests-soi", "group": "eco", "subgroup": "Forests", "type": "fill",
            "source": "forests.geojson", "label": "Forest (Survey of India)", "default": False,
            "info": "Forest polygons from Survey of India topo maps.",
            "paint": {"fillColor": "#2f4a30", "fillOpacity": 0.6, "outlineColor": "#22371f", "outlineWidth": 0.8},
            "legend": [{"color": "#2f4a30", "label": "Forest (SOI)"}],
            "popup": {"title": "name", "titleFallback": "type", "fields": []},
        })
    return stanzas


def wasteland_worldcover(ctx):
    """Share of uncultivated open/scrub/barren land per block (WorldCover 20/30/60
    zonal stats) — an open, reproducible proxy for revenue wasteland, which isn't
    openly available as GIS."""
    import numpy as np
    from rasterio.features import rasterize

    progress("wasteland", 3, "fetching LGD blocks (cached after first build)")
    path = fetch_cached(R2 + "admin/blocks/LGD_Blocks.geojson", ctx["cache"], step="wasteland")
    gj = json.load(open(path))
    sel = ctx["sel"]
    w, s, e, n = sel.bounds
    units = []
    for f in gj["features"]:
        g = shape(f["geometry"])
        gb = g.bounds
        if gb[2] < w or gb[0] > e or gb[3] < s or gb[1] > n:
            continue
        g = g.buffer(0)
        if not g.representative_point().within(sel):
            continue
        p = f["properties"]
        units.append((g, str(p.get("block_name") or "").strip().title(),
                      str(p.get("district") or "").strip().title()))
    if not units:
        warn("wasteland: no LGD blocks in the region")
        return []

    res = 0.001  # ~100 m — zonal statistics, not cartography
    cls, transform, (W, H), _ = _read_worldcover([w - 0.01, s - 0.01, e + 0.01, n + 0.01], res, "wasteland")
    progress("wasteland", 78, f"zonal stats over {len(units)} blocks")
    open_land = np.isin(cls, (20, 30, 60))  # shrub, grassland, bare/sparse
    valid = cls > 0
    ids = rasterize(((g, i + 1) for i, (g, _, _) in enumerate(units)),
                    out_shape=cls.shape, transform=transform, fill=0, dtype="int32")
    feats = []
    for i, (g, name, district) in enumerate(units):
        m = ids == i + 1
        tot = int(np.count_nonzero(m & valid))
        if not tot:
            continue
        pct = 100.0 * np.count_nonzero(m & open_land) / tot
        gg = g.simplify(0.0004, preserve_topology=True)
        feats.append({"type": "Feature", "properties": {
            "name": name, "district": district, "wl_pct": round(pct, 1), "kind": "wasteland"},
            "geometry": mapping(gg)})
    progress("wasteland", 92, f"{len(feats)} blocks scored")
    if not feats:
        return []
    write_geojson(ctx["out"], "wasteland.geojson", feats)
    return [{
        "id": "wasteland", "group": "eco", "type": "fill", "source": "wasteland.geojson",
        "label": "Wasteland (open / barren land)", "default": False,
        "opacityControl": True, "opacity": 0.7,
        "info": "No open revenue-wasteland GIS exists, so this is a land-cover proxy: the share of "
                "uncultivated open, scrub & barren land per block (ESA WorldCover 2021).",
        "paint": {"fillColor": ["step", ["get", "wl_pct"], "#efe6d9", 1.5, "#ddc4a0", 3, "#caa06f",
                                5, "#a8703f", 7, "#824e26"],
                  "fillOpacity": 0.7, "outlineColor": "#7a5a3a", "outlineWidth": 0.4},
        "legend": [{"color": "#efe6d9", "label": "< 1.5%"}, {"color": "#ddc4a0", "label": "1.5–3%"},
                   {"color": "#caa06f", "label": "3–5%"}, {"color": "#a8703f", "label": "5–7%"},
                   {"color": "#824e26", "label": "> 7%"}],
        "popup": {"title": "name", "subtitleProperty": "district", "fields": [
            {"label": "Open / barren land", "property": "wl_pct", "suffix": "% of block area"}]},
    }]


# ---------------------------------------------------------------- pure-stanza recipes

def labels_esri(ctx):
    # One "Place names" toggle, on by default: CARTO label tiles over the map
    # basemap, Esri labels over satellite (the engine picks per active basemap).
    return [{
        "id": "labels", "group": "base", "type": "raster", "default": True,
        "label": "Place names",
        "info": "Town, village and river names on the basemap.",
        "tilesByBasemap": {
            "light": ["https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
                      "https://b.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
                      "https://c.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png"],
            "satellite": ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
        },
        "tileSize": 256, "attribution": "Labels © Esri, © CARTO",
    }]


# ================================================================
# Zero-storage remote-read raster layers
#
# Each reads an open global source windowed to the region at build time — the
# COGs/WCS coverages live on the providers' anonymous HTTP/S3, so nothing is
# mirrored locally. Output is a region-clipped PNG overlay + a *.json meta file,
# exactly like lulc_worldcover, so the engine renders them with no changes.
# ================================================================

GLO30 = "https://copernicus-dem-30m.s3.amazonaws.com/%s/%s.tif"
HANSEN = "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2024-v1.12/Hansen_GFC-2024-v1.12_%s_%s.tif"
GSW = "https://storage.googleapis.com/global-surface-water/downloads2021/%s/%s"
CHIRPS = "https://data.chc.ucsb.edu/products/CHIRPS-2.0/global_annual/tifs/chirps-v2.0.%d.tif"
SOILGRIDS = ("https://maps.isric.org/mapserv?map=/map/%s.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage"
             "&COVERAGEID=%s&FORMAT=image/tiff&SUBSET=long(%.4f,%.4f)&SUBSET=lat(%.4f,%.4f)"
             "&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326"
             "&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326")
MAP_WCS = ("https://data.malariaatlas.org/geoserver/ows?service=WCS&version=2.0.1&request=GetCoverage"
           "&coverageId=%s&format=image/geotiff&subset=Long(%.4f,%.4f)&subset=Lat(%.4f,%.4f)")

CHIRPS_YEAR = 2024  # latest complete CHIRPS annual composite


def _hex(h):
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _clip_span(bbox, target_px, native_res):
    """Output resolution: ~target_px on the long side, never finer than native."""
    span = max(bbox[2] - bbox[0], bbox[3] - bbox[1])
    return max(native_res, span / target_px)


def glo30_tiles(bbox):
    """Copernicus GLO-30 1° tiles (named by SW corner) covering bbox."""
    import math
    w, s, e, n = bbox
    out = []
    for lat in range(int(math.floor(s)), int(math.ceil(n))):
        for lon in range(int(math.floor(w)), int(math.ceil(e))):
            ns = "N" if lat >= 0 else "S"; ew = "E" if lon >= 0 else "W"
            base = f"Copernicus_DSM_COG_10_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM"
            out.append((base, GLO30 % (base, base)))
    return out


def _corner10_tiles(bbox):
    """(top-left-lat, left-lon) pairs on the 10° grid Hansen & JRC-GSW use."""
    import math
    w, s, e, n = bbox
    lats = range(int(math.ceil(s / 10.0) * 10), int(math.ceil(n / 10.0) * 10) + 1, 10)
    lons = range(int(math.floor(w / 10.0) * 10), int(math.floor(e / 10.0) * 10) + 1, 10)
    return [(lat, lon) for lat in lats for lon in lons]


def hansen_tiles(bbox, product):
    out = []
    for lat, lon in _corner10_tiles(bbox):
        ns = "N" if lat >= 0 else "S"; ew = "E" if lon >= 0 else "W"
        name = f"{abs(lat):02d}{ns}_{abs(lon):03d}{ew}"
        out.append((f"{product} {name}", HANSEN % (product, name)))
    return out


def gsw_tiles(bbox, product="occurrence"):
    out = []
    for lat, lon in _corner10_tiles(bbox):
        ns = "N" if lat >= 0 else "S"; ew = "E" if lon >= 0 else "W"
        name = f"{product}_{abs(lon)}{ew}_{abs(lat)}{ns}v1_4_2021.tif"
        out.append((name, GSW % (product, name)))
    return out


def _range_labels(edges, unit="", fmt="{:g}"):
    """Human labels for np.digitize bins given interior break edges."""
    labels = []
    lo = None
    for ed in list(edges) + [None]:
        if lo is None:
            labels.append("< " + fmt.format(edges[0]) + unit)
        elif ed is None:
            labels.append("≥ " + fmt.format(edges[-1]) + unit)
        else:
            labels.append(fmt.format(lo) + "–" + fmt.format(ed) + unit)
        lo = ed
    return labels


def _emit_ramp(ctx, lid, arr, valid, transform, size, extent, edges, colors, labels,
               source, info, label, group="context", subgroup=None, default=False, opacity=0.72):
    """Bin `arr` by `edges`, colour it, clip to the region, write PNG + meta, return stanza."""
    import numpy as np
    from rasterio.features import geometry_mask
    from PIL import Image

    W, H = size
    idx = np.digitize(arr, edges)  # 0..len(edges); needs len(colors) == len(edges)+1
    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    present = []
    for i, hexc in enumerate(colors):
        m = valid & (idx == i)
        if m.any():
            rgba[m] = (*_hex(hexc), 255)
            present.append(i)
    inside = geometry_mask([ctx["sel"].__geo_interface__], out_shape=(H, W), transform=transform, invert=True)
    rgba[~inside] = (0, 0, 0, 0)
    Image.fromarray(rgba, "RGBA").save(os.path.join(ctx["out"], lid + ".png"), optimize=True)

    X0, Y0e, X1e, Y1 = extent
    legend = [{"color": colors[i], "label": labels[i]} for i in present] or \
             [{"color": colors[i], "label": labels[i]} for i in range(len(colors))]
    meta = {
        "image": lid + ".png",
        "coordinates": [[X0, Y1], [X1e, Y1], [X1e, Y0e], [X0, Y0e]],
        "bounds": [X0, Y0e, X1e, Y1], "size": [W, H], "legend": legend, "source": source,
    }
    json.dump(meta, open(os.path.join(ctx["out"], lid + ".json"), "w"))
    stanza = {
        "id": lid, "group": group, "type": "image", "source": lid + ".json",
        "label": label, "default": default, "opacityControl": True, "opacity": opacity,
        "info": info, "legendFrom": "source",
    }
    if subgroup:
        stanza["subgroup"] = subgroup
    return [stanza]


# ---------------------------------------------------------------- terrain (GLO-30)

def terrain_glo30(ctx):
    import numpy as np
    from rasterio.features import geometry_mask
    from PIL import Image

    sel = ctx["sel"]; w, s, e, n = sel.bounds
    res = _clip_span([w, s, e, n], 1800, 0.00028)
    z, transform, (W, H), extent = read_cog_window(
        [w, s, e, n], res, glo30_tiles([w, s, e, n]), "terrain",
        resampling="bilinear", dtype="float32", fill=np.nan)
    if z is None:
        warn("terrain skipped — no Copernicus DEM tiles for this region")
        return []
    valid = np.isfinite(z) & (z > -1000)
    if not valid.any():
        return []
    vals = z[valid]
    edges = np.unique(np.percentile(vals, [20, 40, 60, 80]))
    colors = ["#5a7346", "#9bab63", "#d8c489", "#b98b54", "#7c5a3a"][: len(edges) + 1]

    # hypsometric tint modulated by hillshade. Shade amplitude scales with the
    # region's actual relief so flat plains render as clean elevation bands
    # (no amplified DEM noise) while hills/mountains get strong shaded relief.
    relief = float(np.percentile(vals, 98) - np.percentile(vals, 2))
    amp = 0.06 + 0.40 * float(np.clip((relief - 30.0) / 270.0, 0.0, 1.0))
    px = max(res * 111000.0, 1.0)
    zf = np.where(valid, z, np.nanmedian(vals))
    gy, gx = np.gradient(zf, px, px)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az_r = np.deg2rad(360 - 315 + 90); alt_r = np.deg2rad(45)
    hs = np.clip(np.sin(alt_r) * np.sin(slope) + np.cos(alt_r) * np.cos(slope) * np.cos(az_r - aspect), 0, 1)
    shade = (1.0 + amp * (hs - 0.5) * 2.0)[..., None]

    idx = np.digitize(z, edges)
    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    present = []
    for i, hexc in enumerate(colors):
        m = valid & (idx == i)
        if m.any():
            rgba[m] = (*_hex(hexc), 255)
            present.append(i)
    # modulate the flat hypsometric tint by the hillshade for shaded relief
    rgba[..., :3] = np.clip(rgba[..., :3].astype("float32") * shade, 0, 255).astype(np.uint8)
    inside = geometry_mask([sel.__geo_interface__], out_shape=(H, W), transform=transform, invert=True)
    rgba[~(inside & valid)] = (0, 0, 0, 0)
    Image.fromarray(rgba, "RGBA").save(os.path.join(ctx["out"], "terrain.png"), optimize=True)

    X0, Y0e, X1e, Y1 = extent
    labels = _range_labels(edges, unit=" m", fmt="{:.0f}")
    legend = [{"color": colors[i], "label": labels[i]} for i in present]
    meta = {"image": "terrain.png",
            "coordinates": [[X0, Y1], [X1e, Y1], [X1e, Y0e], [X0, Y0e]],
            "bounds": [X0, Y0e, X1e, Y1], "size": [W, H], "legend": legend,
            "source": "Copernicus GLO-30 DEM (30 m), shaded relief clipped to your region"}
    json.dump(meta, open(os.path.join(ctx["out"], "terrain.json"), "w"))
    progress("terrain", 95, f"{W}x{H} px")
    return [{
        "id": "terrain", "group": "context", "type": "image", "source": "terrain.json",
        "label": "Terrain & elevation", "default": False, "opacityControl": True, "opacity": 0.62,
        "info": "Shaded relief coloured by elevation, from the Copernicus GLO-30 DEM (30 m).",
        "legendFrom": "source",
    }]


# ---------------------------------------------------------------- rainfall (CHIRPS)

def rainfall_chirps(ctx):
    import numpy as np
    sel = ctx["sel"]; w, s, e, n = sel.bounds
    if s > 50 or n < -50:
        warn("rainfall skipped — CHIRPS covers 50°S–50°N only")
        return []
    res = _clip_span([w, s, e, n], 1200, 0.05)
    arr, transform, size, extent = read_cog_window(
        [w, s, e, n], res, [(f"CHIRPS {CHIRPS_YEAR}", CHIRPS % CHIRPS_YEAR)], "rainfall",
        resampling="bilinear", dtype="float32", fill=-9999.0)
    if arr is None:
        return []
    valid = arr >= 0
    if not valid.any():
        return []
    edges = np.unique(np.percentile(arr[valid], [20, 40, 60, 80]))
    colors = ["#dce9e0", "#a9ccc9", "#6fb0bd", "#3d86ad", "#264f96"][: len(edges) + 1]
    labels = _range_labels(edges, unit=" mm", fmt="{:.0f}")
    progress("rainfall", 90, "colorizing")
    return _emit_ramp(ctx, "rainfall", arr, valid, transform, size, extent, edges, colors, labels,
                      f"CHIRPS v2.0 annual rainfall {CHIRPS_YEAR} (~5 km), clipped to your region",
                      f"Total rainfall in {CHIRPS_YEAR} from CHIRPS (UCSB Climate Hazards Center, ~5 km).",
                      "Annual rainfall", subgroup="Climate", opacity=0.7)


# ---------------------------------------------------------------- forest cover & loss (Hansen)

def forest_hansen(ctx):
    import numpy as np
    from rasterio.features import geometry_mask
    from PIL import Image

    sel = ctx["sel"]; w, s, e, n = sel.bounds
    res = _clip_span([w, s, e, n], 2400, 0.00025)
    tc, transform, (W, H), extent = read_cog_window(
        [w, s, e, n], res, hansen_tiles([w, s, e, n], "treecover2000"), "forest",
        resampling="average", dtype="float32", fill=0.0)
    if tc is None:
        warn("forest skipped — no Hansen tiles for this region")
        return []
    ly, _, _, _ = read_cog_window(
        [w, s, e, n], res, hansen_tiles([w, s, e, n], "lossyear"), "forest",
        resampling="nearest", dtype="float32", fill=0.0)
    if ly is None:
        ly = np.zeros_like(tc)

    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    dense = tc >= 50
    open_f = (tc >= 15) & (tc < 50)
    loss = ly > 0
    rgba[open_f] = (*_hex("#8cbf6a"), 255)
    rgba[dense] = (*_hex("#1f5c2e"), 255)
    rgba[loss] = (*_hex("#d1462f"), 255)  # loss overrides cover
    inside = geometry_mask([sel.__geo_interface__], out_shape=(H, W), transform=transform, invert=True)
    keep = inside & (dense | open_f | loss)
    rgba[~keep] = (0, 0, 0, 0)
    Image.fromarray(rgba, "RGBA").save(os.path.join(ctx["out"], "forest.png"), optimize=True)

    legend = []
    if dense.any(): legend.append({"color": "#1f5c2e", "label": "Dense forest (≥50%)"})
    if open_f.any(): legend.append({"color": "#8cbf6a", "label": "Open forest (15–50%)"})
    if loss.any(): legend.append({"color": "#d1462f", "label": "Forest loss 2001–2024"})
    if not legend:
        warn("forest: no forest cover in this region — layer omitted")
        return []
    X0, Y0e, X1e, Y1 = extent
    meta = {"image": "forest.png",
            "coordinates": [[X0, Y1], [X1e, Y1], [X1e, Y0e], [X0, Y0e]],
            "bounds": [X0, Y0e, X1e, Y1], "size": [W, H], "legend": legend,
            "source": "Hansen/UMD Global Forest Change v1.12 (30 m), tree cover 2000 & loss to 2024"}
    json.dump(meta, open(os.path.join(ctx["out"], "forest.json"), "w"))
    progress("forest", 95, f"{W}x{H} px")
    return [{
        "id": "forest", "group": "context", "type": "image", "source": "forest.json",
        "label": "Forest cover & loss", "default": False, "opacityControl": True, "opacity": 0.8,
        "info": "Tree cover in 2000 (green) and forest lost 2001–2024 (red), from Hansen/UMD Global Forest Change (30 m).",
        "legendFrom": "source",
    }]


# ---------------------------------------------------------------- surface water (JRC GSW)

def water_jrc(ctx):
    import numpy as np
    sel = ctx["sel"]; w, s, e, n = sel.bounds
    res = _clip_span([w, s, e, n], 2400, 0.00025)
    occ, transform, size, extent = read_cog_window(
        [w, s, e, n], res, gsw_tiles([w, s, e, n], "occurrence"), "water_jrc",
        resampling="nearest", dtype="float32", fill=0.0)
    if occ is None:
        warn("surface water skipped — no JRC tiles for this region")
        return []
    valid = (occ > 0) & (occ <= 100)
    if not valid.any():
        warn("surface water: none detected in this region — layer omitted")
        return []
    edges = np.array([25, 75])
    colors = ["#bcd6e8", "#6aa8d8", "#2166ac"]
    labels = ["Occasional (1–25%)", "Seasonal (25–75%)", "Permanent (75–100%)"]
    progress("water_jrc", 90, "colorizing")
    return _emit_ramp(ctx, "water_jrc", occ, valid, transform, size, extent, edges, colors, labels,
                      "JRC Global Surface Water occurrence 1984–2021 (30 m), clipped to your region",
                      "How often each pixel held water 1984–2021 (JRC Global Surface Water, 30 m).",
                      "Surface water", subgroup="Water", opacity=0.85)


# ---------------------------------------------------------------- soil carbon (SoilGrids)

def soil_soilgrids(ctx):
    import numpy as np
    b = ctx["bbox"]
    url = SOILGRIDS % ("soc", "soc_0-5cm_mean", b[0], b[2], b[1], b[3])
    try:
        arr, transform, size, extent = fetch_wcs_array(url, "soil", "SoilGrids soil carbon")
    except Exception as ex:
        warn(f"soil carbon skipped — SoilGrids unavailable: {ex}")
        return []
    arr = arr / 10.0  # SoilGrids soc is dg/kg → g/kg
    valid = arr > 0
    if not valid.any():
        return []
    edges = np.unique(np.percentile(arr[valid], [20, 40, 60, 80]))
    colors = ["#eadfc0", "#d3b578", "#b3894a", "#8a5f30", "#5c3b1a"][: len(edges) + 1]
    labels = _range_labels(edges, unit=" g/kg", fmt="{:.0f}")
    progress("soil", 88, "colorizing")
    return _emit_ramp(ctx, "soil", arr, valid, transform, size, extent, edges, colors, labels,
                      "SoilGrids 2.0 soil organic carbon, 0–5 cm (250 m), clipped to your region",
                      "Topsoil organic carbon (0–5 cm) from ISRIC SoilGrids 2.0 (250 m) — a soil-health proxy.",
                      "Soil organic carbon", opacity=0.7)


# ---------------------------------------------------------------- access (Malaria Atlas)

def access_healthcare(ctx):
    import numpy as np
    b = ctx["bbox"]
    url = MAP_WCS % ("Accessibility__202001_Global_Motorized_Travel_Time_to_Healthcare", b[0], b[2], b[1], b[3])
    try:
        arr, transform, size, extent = fetch_wcs_array(url, "access", "travel time to healthcare")
    except Exception as ex:
        warn(f"travel-time skipped — Malaria Atlas unavailable: {ex}")
        return []
    valid = arr >= 0
    if not valid.any():
        return []
    edges = np.array([30, 60, 120])
    colors = ["#3f8f5a", "#c9c05a", "#e0913a", "#b23a2a"]
    labels = ["< 30 min", "30–60 min", "1–2 hr", "≥ 2 hr"]
    progress("access", 88, "colorizing")
    return _emit_ramp(ctx, "access", arr, valid, transform, size, extent, edges, colors, labels,
                      "Malaria Atlas Project — motorized travel time to healthcare, 2020 (~1 km)",
                      "Estimated motorized travel time to the nearest health facility (Malaria Atlas Project, 2020, ~1 km).",
                      "Travel time to healthcare", subgroup="Access", opacity=0.72)


# ================================================================
# People & services: community facilities from OpenStreetMap (HOT)
# ================================================================
#
# (A population-density layer is a natural next addition, but the clean open
# sources are either range-less country files hundreds of MB in size — WorldPop —
# or need a GeoParquet/reprojection recipe — Kontur/GHSL. Deferred to that track.)

HOT = "https://production-raw-data-api.s3.amazonaws.com/ISO3/%s/%s/hotosm_%s_%s_osm_geojson.zip"


def _iso3(ctx):
    return str((ctx.get("spec", {}).get("region") or {}).get("iso3") or "").upper()


def _hot_facilities(ctx, kind, lid, label, color, info, legend_label):
    import zipfile
    iso3 = _iso3(ctx)
    if not iso3:
        return []
    low = iso3.lower()
    url = HOT % (iso3, kind, low, kind)
    try:
        path = fetch_cached(url, ctx["cache"], name=f"hot-{low}-{kind}.zip", step=lid)
    except Exception as ex:
        warn(f"{label} skipped — no OpenStreetMap export for {iso3}: {ex}")
        return []
    try:
        z = zipfile.ZipFile(path)
        member = next((m for m in z.namelist() if m.endswith(".geojson")), None)
        gj = json.loads(z.read(member))
    except Exception as ex:
        warn(f"{label} skipped — could not read export: {ex}")
        return []

    sel = ctx["sel"]; b = ctx["bbox"]
    feats = []
    for f in gj.get("features", []):
        geom = f.get("geometry")
        if not geom:
            continue
        try:
            g = shape(geom)
        except Exception:
            continue
        gb = g.bounds
        if gb[2] < b[0] or gb[0] > b[2] or gb[3] < b[1] or gb[1] > b[3]:
            continue
        pt = g if g.geom_type == "Point" else g.representative_point()
        if not pt.within(sel):
            continue
        p = f.get("properties", {}) or {}
        cat = p.get("healthcare") or p.get("amenity") or p.get("building") or ""
        feats.append({"type": "Feature", "properties": {
            "name": p.get("name") or p.get("name_en"),
            "category": str(cat).replace("_", " ").strip() or None, "kind": lid},
            "geometry": mapping(pt)})
    progress(lid, 90, f"{len(feats)} facilities")
    if not feats:
        warn(f"{label}: none found in this region — layer omitted")
        return []
    write_geojson(ctx["out"], lid + ".geojson", feats)
    return [{
        "id": lid, "group": "people", "subgroup": "Facilities", "type": "circle", "source": lid + ".geojson",
        "label": label, "default": False,
        "paint": {"radius": 5, "color": color, "strokeColor": "#ffffff", "strokeWidth": 1.4, "opacity": 0.95},
        "label_text": {"property": "name", "size": 10, "color": "#2b2723", "haloColor": "#ffffff", "haloWidth": 1.4, "minzoom": 12},
        "legend": [{"color": color, "label": legend_label, "shape": "dot"}],
        "info": info,
        "popup": {"title": "name", "titleFallback": "category", "fields": [{"label": "Type", "property": "category"}]},
    }]


def health_hot(ctx):
    return _hot_facilities(ctx, "health_facilities", "health", "Health facilities",
                           "#c0392b", "Hospitals, clinics and pharmacies from OpenStreetMap (HOT export).",
                           "Health facility")


def education_hot(ctx):
    return _hot_facilities(ctx, "education_facilities", "education", "Schools & colleges",
                           "#2c6e9c", "Schools, colleges and kindergartens from OpenStreetMap (HOT export).",
                           "School / college")


# ---------------------------------------------------------------- constituencies (DataMeet, India)

DATAMEET_PC = "https://raw.githubusercontent.com/datameet/maps/master/parliamentary-constituencies/india_pc_2019_simplified.geojson"
PC_CATEGORY = {"GEN": "General", "SC": "Reserved (SC)", "ST": "Reserved (ST)"}


def constituencies_datameet(ctx):
    progress("constituencies", 10, "fetching Lok Sabha constituencies")
    path = fetch_cached(DATAMEET_PC, ctx["cache"], name="datameet-pc-2019.geojson", step="constituencies")
    gj = json.load(open(path))
    sel = ctx["sel"]; clip = ctx["clip"]
    feats = []
    for f in gj.get("features", []):
        g = shape(f["geometry"]).buffer(0)
        if not g.intersects(sel):
            continue
        g = g.intersection(clip).simplify(0.0009, preserve_topology=True)
        if g.is_empty:
            continue
        p = f.get("properties", {})
        feats.append({"type": "Feature", "properties": {
            "name": (p.get("pc_name") or "").strip(),
            "state": (p.get("st_name") or "").strip(),
            "category": PC_CATEGORY.get(str(p.get("pc_category") or "").upper(), p.get("pc_category")),
            "kind": "constituency"}, "geometry": mapping(g)})
    progress("constituencies", 90, f"{len(feats)} constituencies")
    if not feats:
        return []
    write_geojson(ctx["out"], "constituencies.geojson", feats)
    return [{
        "id": "constituencies", "group": "base", "type": "fill", "source": "constituencies.geojson",
        "label": "Lok Sabha constituencies", "default": False,
        "paint": {"fillColor": "#7a5c86", "fillOpacity": 0.05, "outlineColor": "#7a5c86", "outlineWidth": 1.6, "outlineDash": [4, 2]},
        "label_text": {"property": "name", "size": 12, "color": "#4a3168", "haloColor": "#ffffff",
                       "haloWidth": 2, "transform": "uppercase", "letterSpacing": 0.06, "minzoom": 7},
        "legend": [{"color": "#7a5c86", "label": "Constituency", "shape": "dashed"}],
        "info": "Lok Sabha (parliamentary) constituency boundaries, 2019 delimitation.",
        "popup": {"title": "name", "fields": [
            {"label": "State", "property": "state"}, {"label": "Reservation", "property": "category"}]},
    }]


# ================================================================
# Detailed OpenStreetMap vector tiles (Protomaps global PMTiles)
#
# Pure-stanza recipes (no build, no stored data): the viewer reads the region's
# tiles straight from the global Protomaps OpenStreetMap PMTiles over HTTP range
# requests. Works for any region worldwide, instantly, at zero storage cost.
# ================================================================

PROTOMAPS = "https://data.source.coop/protomaps/openstreetmap/tiles/v3.pmtiles"
OSM_PM_ATTR = "© OpenStreetMap contributors, © Protomaps"


def buildings_pmtiles(ctx):
    return [{
        "id": "buildings", "group": "base", "type": "pmtiles",
        "label": "Buildings", "default": False,
        "pmtiles": PROTOMAPS, "sourceLayer": "buildings", "render": "fill", "minzoom": 13,
        "paint": {"fill-color": "#b3a595", "fill-opacity": 0.55, "fill-outline-color": "#8f8271"},
        "legend": [{"color": "#b3a595", "label": "Building footprint"}],
        "info": "Building footprints from OpenStreetMap — zoom in to see them (Protomaps global tiles).",
        "attribution": OSM_PM_ATTR,
    }]


def roads_pmtiles(ctx):
    width = ["interpolate", ["linear"], ["zoom"],
             9, ["match", ["get", "pmap:kind"], "highway", 1.4, "major_road", 1.0, 0.4],
             16, ["match", ["get", "pmap:kind"], "highway", 6, "major_road", 4,
                  "medium_road", 2.6, "minor_road", 1.4, 0.8]]
    return [{
        "id": "roads", "group": "base", "type": "pmtiles",
        "label": "Roads & streets", "default": False,
        "pmtiles": PROTOMAPS, "sourceLayer": "roads", "render": "line", "minzoom": 9,
        "paint": {"line-color": "#8a7d6d", "line-width": width, "line-opacity": 0.85},
        "legend": [{"color": "#8a7d6d", "label": "Road / street", "shape": "line"}],
        "info": "Road and street network from OpenStreetMap (Protomaps global tiles).",
        "attribution": OSM_PM_ATTR,
    }]


# ================================================================
# District indicators (NFHS-5) — CSV joined by district to LGD boundaries
#
# A curated public dataset (NFHS-5 district factsheets, IIPS/MoHFW) bundled in
# the repo as a compact table keyed by normalised state|district, joined to the
# region's LGD district boundaries and drawn as a graduated choropleth. This is
# the "pick a public indicator → instant choropleth of your districts" pattern.
# ================================================================

_NFHS = None


def _load_nfhs():
    global _NFHS
    if _NFHS is None:
        p = os.path.join(os.path.dirname(__file__), "data", "nfhs5_districts.json")
        _NFHS = json.load(open(p))
    return _NFHS


def _dnorm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(district|dist|zila|zilla)\b", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)


# short key -> (label, unit, breaks, colour ramp light→dark)
_GREEN = ["#eef2e3", "#c9d6a8", "#9fb673", "#6f8f4a", "#4a5a33"]
_RUST = ["#f2e3d6", "#e0b48f", "#cf8a5a", "#b25e30", "#7c3616"]
NFHS_LAYERS = {
    "births": ("Institutional births", "%", [50, 70, 85, 95], _GREEN,
               "Share of births in a health facility (NFHS-5). Higher is better."),
    "literacy": ("Women who are literate", "%", [50, 60, 70, 80], _GREEN,
                 "Share of women age 15–49 who are literate (NFHS-5). Higher is better."),
    "cleanfuel": ("Households using clean cooking fuel", "%", [25, 45, 65, 85], _GREEN,
                  "Households cooking with clean fuel (NFHS-5). Higher is better."),
    "stunting": ("Child stunting (under 5)", "%", [25, 32, 38, 45], _RUST,
                 "Children under 5 who are stunted — low height-for-age (NFHS-5). Lower is better."),
}


def _nfhs_choropleth(ctx, key):
    label, unit, breaks, colors, info = NFHS_LAYERS[key]
    data = _load_nfhs()
    progress(key, 8, "fetching district boundaries")
    path = fetch_cached(R2 + "admin/districts/LGD_Districts.geojson", ctx["cache"], step=key)
    gj = json.load(open(path))
    sel = ctx["sel"]
    feats = []
    have = 0
    for f in gj["features"]:
        g = shape(f["geometry"]).buffer(0)
        inter = g.intersection(sel)
        if inter.is_empty or inter.area / max(g.area, 1e-12) < 0.5:
            continue
        p = f["properties"]
        st = str(p.get("stname") or "").strip()
        dt = str(p.get("dtname") or "").strip()
        val = (data.get(_dnorm(st) + "|" + _dnorm(dt)) or {}).get(key)
        props = {"name": dt.title(), "state": st.title()}
        if val is not None:
            props["value"] = val
            have += 1
        feats.append({"type": "Feature", "properties": props,
                      "geometry": mapping(g.simplify(0.0009, preserve_topology=True))})
    progress(key, 90, f"{have} districts with data")
    if not have:
        warn(f"{label}: no NFHS-5 data for these districts — layer omitted")
        return []
    step = ["step", ["get", "value"], colors[0]]
    for i, b in enumerate(breaks):
        step += [b, colors[i + 1]]
    legend = [{"color": colors[0], "label": f"< {breaks[0]}{unit}"}]
    for i in range(len(breaks) - 1):
        legend.append({"color": colors[i + 1], "label": f"{breaks[i]}–{breaks[i + 1]}{unit}"})
    legend.append({"color": colors[-1], "label": f"> {breaks[-1]}{unit}"})
    legend.append({"color": "#e2ded6", "label": "No survey data"})
    write_geojson(ctx["out"], key + ".geojson", feats)
    return [{
        "id": key, "group": "people", "subgroup": "District indicators (NFHS-5)",
        "type": "fill", "source": key + ".geojson", "label": label, "default": False,
        "paint": {"fillColor": ["case", ["has", "value"], step, "#e2ded6"],
                  "fillOpacity": 0.72, "outlineColor": "#7a6f5c", "outlineWidth": 0.6},
        "label_text": {"property": "name", "size": 11, "color": "#2b2723", "haloColor": "#ffffff",
                       "haloWidth": 1.6, "minzoom": 7},
        "legend": legend, "info": info,
        "popup": {"title": "name", "subtitleProperty": "state",
                  "fields": [{"label": label, "property": "value", "suffix": unit}]},
    }]


def nfhs_births(ctx): return _nfhs_choropleth(ctx, "births")
def nfhs_literacy(ctx): return _nfhs_choropleth(ctx, "literacy")
def nfhs_cleanfuel(ctx): return _nfhs_choropleth(ctx, "cleanfuel")
def nfhs_stunting(ctx): return _nfhs_choropleth(ctx, "stunting")


RECIPES = {
    "admin": admin,
    "subadmin": subadmin,
    "water_osm": water_osm,
    "rivers_wris": rivers_wris,
    "wetlands_wris": wetlands_wris,
    "basins_wris": basins_wris,
    "floodplain_ndem": floodplain_ndem,
    "lulc_worldcover": lulc_worldcover,
    "builtup_worldcover": builtup_worldcover,
    "labels_esri": labels_esri,
    "terrain_glo30": terrain_glo30,
    "rainfall_chirps": rainfall_chirps,
    "forest_hansen": forest_hansen,
    "water_jrc": water_jrc,
    "soil_soilgrids": soil_soilgrids,
    "access_healthcare": access_healthcare,
    "health_hot": health_hot,
    "education_hot": education_hot,
    "constituencies_datameet": constituencies_datameet,
    "buildings_pmtiles": buildings_pmtiles,
    "roads_pmtiles": roads_pmtiles,
    "nfhs_births": nfhs_births,
    "nfhs_literacy": nfhs_literacy,
    "nfhs_cleanfuel": nfhs_cleanfuel,
    "nfhs_stunting": nfhs_stunting,
    "agro_zones": agro_zones,
    "soi_forests": soi_forests,
    "wasteland_worldcover": wasteland_worldcover,
}
