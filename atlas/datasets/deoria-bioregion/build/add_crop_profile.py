#!/usr/bin/env python3
"""Add per-district cropProfile (crop -> #blocks growing it) to districts.geojson,
aggregated from the already-built blocks.geojson (no re-download of raw sources)."""
import json
from collections import Counter

OUT = "/Users/mithunsheshagiri/work/lokaApps/atlas/datasets/deoria-bioregion"
CROP_ORDER = ["Sugarcane", "Rice", "Wheat", "Mustard", "Maize", "Banana", "Turmeric", "Vegetable Pea"]

blocks = json.load(open(f"{OUT}/blocks.geojson"))["features"]
prof = {}   # district -> Counter(crop -> #blocks)
for f in blocks:
    p = f["properties"]
    d = p["district"]
    prof.setdefault(d, Counter())
    for c in (p.get("crops") or []):
        prof[d][c] += 1

dd = json.load(open(f"{OUT}/districts.geojson"))
for f in dd["features"]:
    name = f["properties"]["name"]
    c = prof.get(name, Counter())
    ordered = sorted(c.items(), key=lambda kv: (-kv[1], CROP_ORDER.index(kv[0]) if kv[0] in CROP_ORDER else 99))
    f["properties"]["cropProfile"] = [{"crop": k, "blocks": v} for k, v in ordered]
    print(f"{name}: " + ", ".join(f"{k}({v})" for k, v in ordered))

json.dump(dd, open(f"{OUT}/districts.geojson", "w"))
print("districts.geojson updated with cropProfile")
