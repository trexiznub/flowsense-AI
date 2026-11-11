"""Turn hand-verified coordinates into data/coords.json so the website map lights up.
Input : data/locations_geocoded.csv (from pipeline/build_features.py geocode, after you checked points on a map)
Output: data/coords.json  {location_id: [lat, lon]}  -- only rows whose coord_status is 'manual_verified'."""
import csv, json, os
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
out = {}
for r in csv.DictReader(open(os.path.join(D, "locations_geocoded.csv"), encoding="utf-8")):
    if r["coord_status"] == "manual_verified" and r["lat"] and r["lon"]:
        out[r["location_id"]] = [round(float(r["lat"]), 6), round(float(r["lon"]), 6)]
json.dump(out, open(os.path.join(D, "coords.json"), "w"))
print(len(out), "locations written to coords.json")
