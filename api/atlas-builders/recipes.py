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

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")

import requests
from shapely import wkb
from shapely.geometry import shape, mapping, LineString
from shapely.ops import unary_union

from common import (
    R2, UA, WORLDCOVER, bbi, fetch_cached, progress, warn, write_geojson,
    worldcover_tiles,
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


# ---------------------------------------------------------------- pure-stanza recipes

def labels_esri(ctx):
    return [{
        "id": "labels", "group": "base", "type": "raster", "default": True,
        "label": "Place labels (satellite)", "onlyWithBasemap": "satellite",
        "tiles": ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
        "tileSize": 256, "attribution": "Labels © Esri",
    }]


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
}
