# Building the `deoria-bioregion` dataset

The app only reads the finished files in the dataset folder. These scripts are the
**recipe** that produced them — kept for provenance and so the dataset can be regenerated
or a sibling geography built the same way. They were run once from a scratch working dir;
adjust the `SCRATCH` / `OUT` paths at the top of each before re-running, and
`pip install openpyxl pyarrow shapely rasterio pillow`.

## Inputs

- **Attribute spreadsheet** — `Deoria_AttributeMapping.xlsx` (Socratus value-chain desk
  research): district context, the block × crop presence matrix, and per-crop narrative.
- **Bharatlas** (https://bharatlas.com, aggregating LGD / India-WRIS / NRSC-NDEM), files
  pulled from its R2 bucket `https://pub-0429b8e3b5a946e69ea007df844a6f1c.r2.dev/…`:
  - `admin/districts/LGD_Districts.geojson`, `admin/blocks/LGD_Blocks.geojson`,
    `admin/villages/LGD_Villages.parquet`, `postal/boundaries/Datagov_Pincode_Boundaries.geojson`
  - `water/rivers/WRIS_Rivers.parquet`, `water/hydro-boundaries/WRIS_SubBasin.geojson`,
    `water/canals/WRIS_Canals.geojson`, `water/wetlands/Bharatmaps_Parivesh_Wetland_Boundaries.parquet`
  - `environment/ndem-floods-1998-2022/NDEM_All_India_Flood_Innundation_1998_to_2022.parquet`
  - `agriculture/agro-ecological-zones/Agro_Ecological_Zones.geojson`,
    `infra/vedas-ethanol-plants/Vedas_Ethanol_Plants.geojson`
- **ESA WorldCover 2021 v200** COGs (public, no key), tiles N24E081/N24E084/N27E081/N27E084
  from `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/`.
- **OSM Nominatim** — geocoding a few value-chain sites (town-level, flagged approximate).

## Scripts (run in order)

| Script | Produces |
|---|---|
| `build_boundaries.py` | `districts.geojson` (3), `blocks.geojson` (49, crop matrix + narrative joined via a block-name alias table) |
| `build_villages.py`   | `villages.geojson` (5 Cluster-1 villages, resolved to exact LGD identities), `clusters.geojson` (convex-hull boundary) |
| `build_valuechain.py` | `valuechain.geojson` (sugar mills + distilleries; India Glycols from VEDAS, Bajaj from pincode 274703, others geocoded) |
| `build_eco.py`        | `rivers.geojson`, `basin.geojson`, `wetlands.geojson`, `floodplain.geojson` (NDEM patches buffer-merged into zones), `canals.geojson`, `agro_zones.geojson` — all clipped to the region bbox |
| `build_lulc.py`       | `lulc.png` + `lulc.json` (WorldCover, colorized, clipped to the districts, ~60 m, as a MapLibre image overlay) |
| `build_forests.py`    | `forests.geojson` (reserved + protected forests from Bharatlas `soi_forests`, clipped to the 3 districts, SOI name encoding cleaned; each feature tagged `type` = `Reserved`/`Protected`, which the manifest splits into two toggleable layers) |
| `build_wasteland.py`  | `wasteland.geojson` (per-block share of uncultivated open/scrub/barren land — WorldCover classes 20/30/60 zonal stats — a proxy for revenue wasteland, which isn't openly available as GIS) |
| `build_builtup.py`    | `builtup.geojson` (town/city footprints vectorised from the WorldCover built-up class 50, buffer-merged and size-filtered — a land-cover proxy for urban centres; official ULB admin boundaries aren't openly available) |
| `add_crop_profile.py` | Post-step: adds a per-district `cropProfile` (each crop → #blocks growing it) onto `districts.geojson`, aggregated from the already-built `blocks.geojson` crop matrix. Run after `build_boundaries.py`. Powers the "all crops grown" list in the district popup. |

Region bbox used for clipping: lon **82.95–84.55**, lat **25.95–27.40**.

Extra sources for the forest/wasteland/built-up layers: Bharatlas **SOI_Forests** (CC0) and the same **ESA WorldCover 2021** COGs read windowed via `/vsicurl/`.
