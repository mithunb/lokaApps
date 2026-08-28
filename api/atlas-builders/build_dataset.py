#!/usr/bin/env python3
"""LOKA Atlas dataset orchestrator.

Invoked by api/lib/atlas/jobs.js:  python3 build_dataset.py --jobspec <file>
Runs the chosen layer recipes and assembles atlas/datasets/<slug>/manifest.json.
Progress goes to stdout as JSON lines (see common.py); exit 0 + {"event":"done"}
means the dataset folder in jobspec.outDir is complete.
"""
import argparse
import base64
import io
import json
import math
import os
import sys
import traceback

from common import bbox_geom, emit, pad_bbox, progress, set_window, warn, load_selection
import recipes as recipe_mod


def zoom_for(bbox):
    span = max(bbox[2] - bbox[0], bbox[3] - bbox[1], 0.05)
    z = math.log2(360.0 / span) + 0.25
    return round(max(5.5, min(11.0, z)), 1)


GROUP_DEFS = {
    "base": {"id": "base", "label": "Base", "open": True},
    "context": {"id": "context", "label": "Terrain, climate & access", "open": True},
    "people": {"id": "people", "label": "People & services", "open": True},
    "agri": {"id": "agri", "label": "Crops & value chain", "open": True},
    "eco": {"id": "eco", "label": "Ecological landscape", "open": True},
}
GROUP_ORDER = ["base", "context", "people", "agri", "eco"]

BASEMAPS = [
    {
        "id": "satellite", "label": "Satellite",
        "tiles": ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        "tileSize": 256, "maxzoom": 19,
        "attribution": "Imagery © Esri, Maxar, Earthstar Geographics",
    },
    {
        # "Streets & colour": roads, parks and water in gentle colour.
        #
        # These tiles are written so a manifest still describes itself, but the
        # VIEWER is the authority — APP_BASEMAPS in atlas/atlas.js applies the
        # app's current base map to every atlas as it loads, so a change of house
        # style reaches everything already published instead of only what gets
        # built afterwards. Change it there; keep this in step so the two agree.
        #
        # @2x with tileSize 256 — a 512px image drawn into a 256pt tile, which is
        # what a retina screen needs. At 1x the whole map surface was upscaled and
        # soft, labels worst of all, because text is where blur is visible first.
        "id": "light", "label": "Map", "default": True,
        "tiles": ["https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png",
                  "https://b.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png",
                  "https://c.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png"],
        "tileSize": 256, "maxzoom": 19,
        "attribution": "© OpenStreetMap contributors © CARTO",
    },
]

BASE_ATTRIBUTIONS = [
    {"name": "Esri World Imagery", "url": "https://www.esri.com", "note": "Satellite basemap & place labels"},
    {"name": "OpenStreetMap contributors & CARTO", "url": "https://www.openstreetmap.org/copyright",
     "note": "Map basemap", "license": "ODbL"},
]

SOURCE_ATTRIBUTIONS = {
    "geoBoundaries (gbOpen)": {"url": "https://www.geoboundaries.org", "note": "Administrative boundaries", "license": "CC-BY 4.0"},
    "Local Government Directory (LGD) via Bharatlas": {"url": "https://bharatlas.com", "note": "District & block boundaries", "license": "CC0"},
    "India-WRIS via Bharatlas": {"url": "https://indiawris.gov.in", "note": "Rivers, canals, sub-basins"},
    "Bharatmaps/Parivesh via Bharatlas": {"url": "https://bharatlas.com", "note": "Wetland boundaries"},
    "NRSC / ISRO — NDEM via Bharatlas": {"url": "https://bhuvan.nrsc.gov.in", "note": "Flood inundation 1998–2022"},
    "ESA WorldCover 2021 (Copernicus)": {"url": "https://esa-worldcover.org", "note": "Land cover & built-up areas", "license": "CC-BY 4.0"},
    "OpenStreetMap contributors": {"url": "https://www.openstreetmap.org/copyright", "note": "Waterways", "license": "ODbL"},
    "Copernicus GLO-30 DEM": {"url": "https://spacedata.copernicus.eu", "note": "Terrain & elevation (© DLR/Airbus, ESA)", "license": "Copernicus free & open"},
    "CHIRPS (UCSB Climate Hazards Center)": {"url": "https://www.chc.ucsb.edu/data/chirps", "note": "Annual rainfall", "license": "Public domain"},
    "Hansen/UMD Global Forest Change": {"url": "https://glad.earthengine.app/view/global-forest-change", "note": "Forest cover & loss", "license": "CC-BY 4.0"},
    "JRC Global Surface Water": {"url": "https://global-surface-water.appspot.com", "note": "Surface water 1984–2021", "license": "EC free & open"},
    "ISRIC SoilGrids 2.0": {"url": "https://soilgrids.org", "note": "Soil organic carbon", "license": "CC-BY 4.0"},
    "Malaria Atlas Project": {"url": "https://malariaatlas.org", "note": "Travel time to healthcare", "license": "CC-BY 4.0"},
    "OpenStreetMap / HOT (HDX)": {"url": "https://data.humdata.org", "note": "Health & education facilities", "license": "ODbL"},
    "DataMeet": {"url": "https://github.com/datameet/maps", "note": "Lok Sabha constituency boundaries", "license": "CC-BY 4.0"},
    "OpenStreetMap / Protomaps": {"url": "https://protomaps.com", "note": "Buildings & roads (global vector tiles)", "license": "ODbL"},
    "NFHS-5 (IIPS / MoHFW)": {"url": "https://rchiips.org/nfhs/", "note": "District health & living-standard indicators", "license": "Government of India (public)"},
    "ICAR agro-ecological regions via Bharatlas": {"url": "https://bharatlas.com", "note": "Agro-ecological zones", "license": "CC0"},
    "Survey of India via Bharatlas": {"url": "https://bharatlas.com", "note": "Reserved & protected forests", "license": "CC0"},
}

RECIPE_SOURCES = {
    "admin": {"global": ["geoBoundaries (gbOpen)"], "india": ["Local Government Directory (LGD) via Bharatlas"]},
    "subadmin": {"india": ["Local Government Directory (LGD) via Bharatlas"]},
    "water_osm": {"global": ["OpenStreetMap contributors"]},
    "rivers_wris": {"india": ["India-WRIS via Bharatlas"]},
    "wetlands_wris": {"india": ["Bharatmaps/Parivesh via Bharatlas"]},
    "basins_wris": {"india": ["India-WRIS via Bharatlas"]},
    "floodplain_ndem": {"india": ["NRSC / ISRO — NDEM via Bharatlas"]},
    "lulc_worldcover": {"global": ["ESA WorldCover 2021 (Copernicus)"], "india": ["ESA WorldCover 2021 (Copernicus)"]},
    "builtup_worldcover": {"global": ["ESA WorldCover 2021 (Copernicus)"], "india": ["ESA WorldCover 2021 (Copernicus)"]},
    "labels_esri": {},
    "terrain_glo30": {"global": ["Copernicus GLO-30 DEM"], "india": ["Copernicus GLO-30 DEM"]},
    "rainfall_chirps": {"global": ["CHIRPS (UCSB Climate Hazards Center)"], "india": ["CHIRPS (UCSB Climate Hazards Center)"]},
    "forest_hansen": {"global": ["Hansen/UMD Global Forest Change"], "india": ["Hansen/UMD Global Forest Change"]},
    "water_jrc": {"global": ["JRC Global Surface Water"], "india": ["JRC Global Surface Water"]},
    "soil_soilgrids": {"global": ["ISRIC SoilGrids 2.0"], "india": ["ISRIC SoilGrids 2.0"]},
    "access_healthcare": {"global": ["Malaria Atlas Project"], "india": ["Malaria Atlas Project"]},
    "health_hot": {"global": ["OpenStreetMap / HOT (HDX)"], "india": ["OpenStreetMap / HOT (HDX)"]},
    "education_hot": {"global": ["OpenStreetMap / HOT (HDX)"], "india": ["OpenStreetMap / HOT (HDX)"]},
    "constituencies_datameet": {"india": ["DataMeet"]},
    "buildings_pmtiles": {"global": ["OpenStreetMap / Protomaps"], "india": ["OpenStreetMap / Protomaps"]},
    "roads_pmtiles": {"global": ["OpenStreetMap / Protomaps"], "india": ["OpenStreetMap / Protomaps"]},
    "nfhs_births": {"india": ["NFHS-5 (IIPS / MoHFW)"]},
    "nfhs_literacy": {"india": ["NFHS-5 (IIPS / MoHFW)"]},
    "nfhs_cleanfuel": {"india": ["NFHS-5 (IIPS / MoHFW)"]},
    "nfhs_stunting": {"india": ["NFHS-5 (IIPS / MoHFW)"]},
    "agro_zones": {"india": ["ICAR agro-ecological regions via Bharatlas"]},
    "soi_forests": {"india": ["Survey of India via Bharatlas"]},
    "wasteland_worldcover": {"india": ["ESA WorldCover 2021 (Copernicus)", "Local Government Directory (LGD) via Bharatlas"]},
}


def save_logo(spec, out_dir):
    data = (spec.get("branding") or {}).get("logoData")
    if not data:
        return None
    try:
        from PIL import Image
        raw = base64.b64decode(data.split(",", 1)[1])
        img = Image.open(io.BytesIO(raw))
        img.verify()
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
        img.thumbnail((480, 160))  # header-sized; re-encode strips anything odd
        img.save(os.path.join(out_dir, "branding-logo.png"), "PNG", optimize=True)
        return "branding-logo.png"
    except Exception as ex:
        warn(f"logo rejected: {ex}")
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobspec", required=True)
    args = ap.parse_args()
    spec = json.load(open(args.jobspec))

    out = spec["outDir"]
    cache = spec["srcCache"]
    os.makedirs(out, exist_ok=True)
    os.makedirs(cache, exist_ok=True)

    catalog = json.load(open(spec["catalogFile"]))
    by_id = {l["id"]: l for l in catalog["layers"]}

    chosen = [by_id[i] for i in spec["layers"] if i in by_id]
    n = len(chosen)

    # Reserve small bookends (region prep, manifest assembly) and give the layers
    # the middle of the bar; each layer gets an equal, forward-only slice.
    LAYER_LO, LAYER_HI = 5.0, 95.0
    set_window(0.0, LAYER_LO, "Preparing your region", 0, n)
    progress("region", 40, "resolving your region")
    sel, sel_bounds, sel_parts = load_selection(spec)
    bbox = pad_bbox(sel_bounds, 0.06)
    ctx = {
        "spec": spec, "tier": spec["tier"], "out": out, "cache": cache,
        "sel": sel, "bbox": bbox, "clip": bbox_geom(bbox),
        # the picked places one by one, not just their union — the district
        # pickers use these to guarantee every picked place gets boundaries
        "selParts": sel_parts,
    }

    layers = []
    span = (LAYER_HI - LAYER_LO) / max(n, 1)
    for idx, entry in enumerate(chosen):
        fn = recipe_mod.RECIPES.get(entry["recipe"])
        if not fn:
            warn(f"unknown recipe {entry['recipe']} — skipped")
            continue
        set_window(LAYER_LO + span * idx, span, entry["label"], idx + 1, n)
        progress(entry["id"], 0, f"Building “{entry['label']}”")
        try:
            stanzas = fn(ctx)
        except Exception as ex:
            if entry.get("required"):
                emit({"event": "error", "msg": f"{entry['label']} failed: {ex}"})
                traceback.print_exc(file=sys.stderr)
                sys.exit(1)
            warn(f"{entry['label']} skipped: {ex}")
            continue
        if not stanzas:
            warn(f"{entry['label']}: nothing found for this region — layer omitted")
        layers.extend(stanzas)

    if not layers:
        emit({"event": "error", "msg": "no layers could be built for this region"})
        sys.exit(1)

    set_window(95.0, 5.0, "Finishing up", 0, 0)
    progress("manifest", 40, "assembling your atlas")
    # region may have been sharpened by the admin recipe (LGD polygons)
    final_bounds = pad_bbox(list(ctx["sel"].bounds), 0.08)
    center = [round((final_bounds[0] + final_bounds[2]) / 2, 4),
              round((final_bounds[1] + final_bounds[3]) / 2, 4)]
    zoom = zoom_for(final_bounds)

    groups_present = []
    for gid in GROUP_ORDER:
        if any(l.get("group") == gid for l in layers):
            groups_present.append(GROUP_DEFS[gid])

    # attributions: sources used by the chosen recipes (for this tier) + basemaps
    attributions = []
    seen = set()
    for entry in chosen:
        names = (RECIPE_SOURCES.get(entry["recipe"]) or {}).get(spec["tier"]) \
            or (RECIPE_SOURCES.get(entry["recipe"]) or {}).get("global") or []
        for nm in names:
            if nm in seen:
                continue
            seen.add(nm)
            attributions.append({"name": nm, **SOURCE_ATTRIBUTIONS.get(nm, {})})
    attributions.extend(BASE_ATTRIBUTIONS)

    branding = dict(spec.get("branding") or {})
    logo = save_logo(spec, out)
    branding.pop("logoData", None)
    if logo:
        branding["logo"] = logo
    branding = {k: v for k, v in branding.items() if v}

    manifest = {
        "id": spec["slug"],
        "title": spec.get("title") or spec["slug"],
        "subtitle": spec.get("subtitle") or "",
        "about": spec.get("about") or "",
        "center": center,
        "zoom": zoom,
        "bounds": [[final_bounds[0], final_bounds[1]], [final_bounds[2], final_bounds[3]]],
        "minzoom": max(4, zoom - 2.2),
        "maxzoom": 15,
        "glyphs": "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf",
        "basemaps": BASEMAPS,
        "groups": groups_present,
        "layers": layers,
        "attributions": attributions,
        "generator": "LOKA Atlas wizard",
        "region": {"iso3": spec["region"]["iso3"], "names": spec["region"]["shapeNames"]},
    }
    if branding:
        manifest["branding"] = branding

    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)

    emit({"event": "done"})


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as ex:
        emit({"event": "error", "msg": str(ex)})
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
