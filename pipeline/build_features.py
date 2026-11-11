"""Run this on a machine with internet access (the build sandbox could not reach these sources).

  pip install requests pandas numpy rasterio pysheds shapely pyproj
  python build_features.py geocode     # locations.csv -> locations_geocoded.csv   (Nominatim/OSM, ~1 req/s)
  python build_features.py rain        # events.csv   -> event_rain_features.csv   (Open-Meteo archive, hourly)
  python build_features.py terrain     # locations_geocoded.csv -> location_terrain_features.csv (Copernicus DEM 30 m + OSM waterways)
  python build_features.py join        # -> model_table.csv

After `geocode`, OPEN locations_geocoded.csv, check every point on a map, and put corrections in
manual_coords.csv (location_id,lat,lon). Re-run `geocode` to merge them. Do not train on unchecked coordinates.
"""
import sys, os, time, json, math
import numpy as np, pandas as pd

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
P = lambda f: os.path.join(HERE, f)
CITY = (28.4595, 77.0266)                       # Gurugram centre (event-level rainfall point)
BBOX = (76.80, 28.30, 77.20, 28.62)             # W, S, E, N  - Gurugram study window
UA = {"User-Agent": "flowsense-sustainx-student-project/1.0"}


# ------------------------------------------------------------------ geocode
def geocode():
    import requests
    df = pd.read_csv(P("locations.csv"))
    res = []
    for _, r in df.iterrows():
        q = r["geocode_query"]
        try:
            j = requests.get("https://nominatim.openstreetmap.org/search", headers=UA, timeout=30, params={
                "q": q, "format": "json", "limit": 1, "viewbox": f"{BBOX[0]},{BBOX[3]},{BBOX[2]},{BBOX[1]}", "bounded": 1}).json()
        except Exception as e:
            j = []
        if j:
            res.append((float(j[0]["lat"]), float(j[0]["lon"]), "geocoded_UNVERIFIED", j[0].get("display_name", "")))
        else:
            res.append((np.nan, np.nan, "not_found_fill_manually", ""))
        time.sleep(1.1)                         # Nominatim usage policy
    df["lat"], df["lon"], df["coord_status"], df["osm_display_name"] = zip(*res)
    if os.path.exists(P("manual_coords.csv")):
        m = pd.read_csv(P("manual_coords.csv")).set_index("location_id")
        for lid, row in m.iterrows():
            i = df.index[df.location_id == lid]
            df.loc[i, ["lat", "lon", "coord_status"]] = [row["lat"], row["lon"], "manual_verified"]
    df.to_csv(P("locations_geocoded.csv"), index=False)
    print(df.coord_status.value_counts())


# ------------------------------------------------------------------ rainfall
def rain_features_from_series(t, mm, event_date):
    """t: hourly DatetimeIndex (IST), mm: hourly precipitation. Window = event day 00:00 -> next day 12:00."""
    s = pd.Series(np.asarray(mm, dtype=float), index=pd.DatetimeIndex(t)).fillna(0.0)
    d0 = pd.Timestamp(event_date)
    win = s[(s.index >= d0) & (s.index < d0 + pd.Timedelta(hours=36))]
    prev = s[(s.index >= d0 - pd.Timedelta(hours=72)) & (s.index < d0)]
    roll = lambda h: float(win.rolling(h, min_periods=1).sum().max())
    return {"rain_1h_max_mm": roll(1), "rain_3h_max_mm": roll(3), "rain_6h_max_mm": roll(6),
            "rain_24h_max_mm": roll(24), "rain_window_total_mm": float(win.sum()),
            "rain_prev_72h_mm": float(prev.sum()), "rain_peak_hour": str(win.idxmax()) if len(win) else ""}

def rain():
    import requests
    ev = pd.read_csv(P("events.csv"))
    out = []
    for _, e in ev.iterrows():
        d0 = pd.Timestamp(e.event_date)
        j = requests.get("https://archive-api.open-meteo.com/v1/archive", timeout=60, params={
            "latitude": CITY[0], "longitude": CITY[1], "hourly": "precipitation", "timezone": "Asia/Kolkata",
            "start_date": (d0 - pd.Timedelta(days=4)).date().isoformat(), "end_date": (d0 + pd.Timedelta(days=2)).date().isoformat()}).json()
        f = rain_features_from_series(j["hourly"]["time"], j["hourly"]["precipitation"], e.event_date)
        f.update(event_id=e.event_id, rain_source="Open-Meteo archive (reanalysis, ~0.1-0.25 deg)")
        out.append(f)
        time.sleep(0.5)
    r = pd.DataFrame(out)
    r = ev[["event_id", "rain_mm_stated"]].merge(r, on="event_id")
    r.to_csv(P("event_rain_features.csv"), index=False)
    print(r[["event_id", "rain_mm_stated", "rain_24h_max_mm", "rain_1h_max_mm"]])
    print("\nCHECK: reanalysis often under-reads convective bursts. Compare rain_mm_stated (district administration) with rain_24h_max_mm.")


# ------------------------------------------------------------------ terrain
def terrain_from_dem(dem_path, pts):
    """pts: DataFrame[location_id, lat, lon]. Returns elevation, slope, flow accumulation, TWI, HAND at each point."""
    import rasterio
    from pysheds.grid import Grid
    grid = Grid.from_raster(dem_path); dem = grid.read_raster(dem_path)
    pit = grid.fill_pits(dem); flood = grid.fill_depressions(pit); inflated = grid.resolve_flats(flood)
    fdir = grid.flowdir(inflated); acc = grid.accumulation(fdir)
    with rasterio.open(dem_path) as src:
        tr = src.transform; arr = src.read(1).astype(float)
        lat0 = (src.bounds.top + src.bounds.bottom) / 2
        dx = abs(tr.a) * 111320 * math.cos(math.radians(lat0)); dy = abs(tr.e) * 110540
    gy, gx = np.gradient(arr, dy, dx)
    slope_rad = np.arctan(np.hypot(gx, gy))
    cell = dx * dy
    twi = np.log((np.asarray(acc) + 1) * math.sqrt(cell) / np.maximum(np.tan(slope_rad), 1e-3))
    stream = acc > np.percentile(np.asarray(acc), 98)           # DEM-derived channels (approximate)
    hand = np.asarray(grid.compute_hand(fdir, inflated, stream))
    rows = []
    for _, p in pts.iterrows():
        r_, c_ = rasterio.transform.rowcol(tr, p.lon, p.lat)
        ok = 0 <= r_ < arr.shape[0] and 0 <= c_ < arr.shape[1]
        rows.append(dict(location_id=p.location_id,
                         elevation_m=arr[r_, c_] if ok else np.nan, slope_deg=math.degrees(slope_rad[r_, c_]) if ok else np.nan,
                         flow_accum_cells=float(np.asarray(acc)[r_, c_]) if ok else np.nan,
                         twi=float(twi[r_, c_]) if ok else np.nan, hand_m=float(hand[r_, c_]) if ok else np.nan))
    return pd.DataFrame(rows)

def fetch_dem(path):
    import rasterio
    from rasterio.merge import merge
    tiles = ["Copernicus_DSM_COG_10_N28_00_E076_00_DEM", "Copernicus_DSM_COG_10_N28_00_E077_00_DEM"]
    srcs = [rasterio.open(f"/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/{t}/{t}.tif") for t in tiles]
    arr, tr = merge(srcs, bounds=(BBOX[0], BBOX[1], BBOX[2], BBOX[3]))
    prof = srcs[0].profile; prof.update(driver="GTiff", height=arr.shape[1], width=arr.shape[2], transform=tr, count=1, compress="deflate")
    prof.pop("blockxsize", None); prof.pop("blockysize", None); prof.pop("tiled", None)
    with rasterio.open(path, "w", **prof) as dst: dst.write(arr[0], 1)

def waterway_distance(pts):
    import requests
    from pyproj import Transformer
    from shapely.geometry import LineString, Point
    from shapely.ops import unary_union
    q = f'[out:json][timeout:90];way["waterway"~"drain|canal|stream|river|ditch"]({BBOX[1]},{BBOX[0]},{BBOX[3]},{BBOX[2]});out geom;'
    j = requests.post("https://overpass-api.de/api/interpreter", data={"data": q}, headers=UA, timeout=120).json()
    tf = Transformer.from_crs(4326, 32643, always_xy=True)
    lines = [LineString([tf.transform(g["lon"], g["lat"]) for g in e["geometry"]]) for e in j["elements"] if len(e.get("geometry", [])) > 1]
    u = unary_union(lines) if lines else None
    return [u.distance(Point(*tf.transform(p.lon, p.lat))) if u is not None and not np.isnan(p.lat) else np.nan for _, p in pts.iterrows()], len(lines)

def terrain():
    pts = pd.read_csv(P("locations_geocoded.csv")).dropna(subset=["lat", "lon"])
    dem = P("gurugram_dem.tif")
    if not os.path.exists(dem): fetch_dem(dem)
    t = terrain_from_dem(dem, pts[["location_id", "lat", "lon"]])
    d, n = waterway_distance(pts)
    t["dist_to_osm_waterway_m"] = d
    t.to_csv(P("location_terrain_features.csv"), index=False)
    print(t.describe().T[["count", "min", "max"]], f"\nOSM waterway segments: {n}")
    print("NOTE: DEM-derived flow/HAND ignore culverts and piped drains; OSM drain coverage in Gurugram is incomplete.")


# ------------------------------------------------------------------ join
def join():
    m = pd.read_csv(P("hotspot_event_matrix.csv"))
    r = pd.read_csv(P("event_rain_features.csv")).drop(columns=["rain_mm_stated"])
    t = pd.read_csv(P("location_terrain_features.csv"))
    g = pd.read_csv(P("locations_geocoded.csv"))[["location_id", "lat", "lon", "coord_status"]]
    df = m.merge(r, on="event_id").merge(g, on="location_id").merge(t, on="location_id", how="left")
    df = df[df.coord_status.isin(["manual_verified"])]      # only train on hand-verified coordinates
    df.to_csv(P("model_table.csv"), index=False)
    print(df.shape, "positives:", int(df.flooded_reported.sum()), "events:", df.event_id.nunique())


if __name__ == "__main__":
    {"geocode": geocode, "rain": rain, "terrain": terrain, "join": join}[sys.argv[1]]()
