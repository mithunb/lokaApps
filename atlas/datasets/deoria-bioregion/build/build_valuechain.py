#!/usr/bin/env python3
"""Build valuechain.geojson — sugar mills + distilleries from the xlsx, geocoded."""
import json, time, urllib.parse, urllib.request

OUT = "/Users/mithunsheshagiri/work/lokaApps/atlas/datasets/deoria-bioregion"
X0, Y0, X1, Y1 = 82.95, 25.95, 84.55, 27.40
UA = "loka-atlas/1.0 (mapping exercise; contact mithun@socratus.org)"

def geocode(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": 1, "countrycodes": "in"})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        j = json.load(urllib.request.urlopen(req, timeout=30))
        if j:
            return float(j[0]["lon"]), float(j[0]["lat"]), j[0].get("display_name", "")
    except Exception as e:
        print("  geocode error:", e)
    return None

# name, type, district, query, coord (lon,lat) if known, precise?, source_label, note
SITES = [
    ("Bajaj Hindustan Sugar Ltd", "Sugar mill", "Deoria",
     None, (84.1544, 26.31011), False, "India Post pincode 274703 (Paratappur S.O.)",
     "Sugar mill at Pratappur, est. 1903 (formerly Pratappur Sugar & Industries Ltd)."),
    ("U.P. State Sugar & Cane Dev. Corp. Ltd", "Sugar mill", "Deoria",
     "Bhatni, Deoria, Uttar Pradesh", None, False, None,
     "State sugar & cane development unit at Bhatni (xlsx value-chain infra)."),
    ("India Glycols Ltd", "Distillery", "Gorakhpur",
     None, (83.22756, 26.74715), True, "VEDAS ethanol-plants dataset",
     "Ethanol / distillery unit (xlsx value-chain infra)."),
    ("Sarraiya (Saraya) Distillery", "Distillery", "Gorakhpur",
     "Sardarnagar, Gorakhpur, Uttar Pradesh", None, False, None,
     "Distillery at Sardarnagar / Saraya (xlsx value-chain infra)."),
    ("Kaptanganj Distillery", "Distillery", "Kushinagar",
     "Kaptanganj, Kushinagar, Uttar Pradesh", None, False, None,
     "Distillery at Kaptanganj (xlsx value-chain infra)."),
]

feats = []
for name, typ, dist, query, coord, precise, srclabel, note in SITES:
    approx = not precise
    if coord:
        lon, lat = coord
        src = srclabel or ("dataset" if precise else "approximate")
    else:
        r = geocode(query); time.sleep(1.1)
        if not r:
            print(f"  !! could not geocode {name} ({query})"); continue
        lon, lat, disp = r
        approx = True; src = "geocoded (town-level, approximate)"
        if not (X0 <= lon <= X1 and Y0 <= lat <= Y1):
            print(f"  !! {name} geocode OUT OF REGION: {lon},{lat} — {disp}"); continue
    feats.append({"type": "Feature", "properties": {
        "name": name, "type": typ, "district": dist, "kind": "valuechain",
        "note": note, "location_source": src, "approximate": approx},
        "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]}})
    print(f"  {name:40s} {typ:10s} @ {lon:.4f},{lat:.4f}  [{src}]")

json.dump({"type": "FeatureCollection", "features": feats}, open(f"{OUT}/valuechain.geojson", "w"))
print("valuechain.geojson:", len(feats), "features")
