"""Builds the sourced flood-label tables for FlowSense AI from news reports.

Every row traces to a source URL (sources.csv). Nothing here is inferred:
facts were extracted from the articles as stated; where an article did not
state something the field is left blank.
"""
import csv, os, re, collections

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")

SOURCES = {
 "DP23":  ("Daily Pioneer", "2023-07-10", "https://www.dailypioneer.com/2023/state-editions/g---gram-dc-urges-wfh-as-downpour-wreaks-havoc.html"),
 "ITV24": ("India TV", "2024-08-11", "https://www.indiatvnews.com/haryana/gurugram-rains-latest-update-gurugram-turns-jalgram-as-heavy-rain-leads-to-waterlogging-traffic-disruption-in-several-areas-see-photos-2024-08-11-946367"),
 "TRIB25a": ("The Tribune", "2025-05-26", "https://www.tribuneindia.com/news/haryana/rain-unmasks-civic-lapses-gurugram-reports-waterlogging-at-154-locations"),
 "PTI25a": ("PTI via The Week", "2025-07-10", "https://www.theweek.in/wire-updates/national/2025/07/10/des3-ncr-rain-waterlogging.html"),
 "PTI25b": ("PTI via ThePrint", "2025-07-31", "https://theprint.in/india/gurugram-rains-severe-waterlogging-leaves-roads-inundated-stranding-helpless-commuters/2709543"),
 "BS25":  ("Business Standard", "2025-09-02", "https://www.business-standard.com/india-news/gurugram-heavy-rains-floods-work-from-home-orders-delhi-ncr-weather-125090200151_1.html"),
 "BT25":  ("Business Today", "2025-09-02", "https://www.businesstoday.in/india/story/gurugram-may-face-bangalores-fate-netizens-as-heavy-rains-waterlogging-mar-normal-life-492055-2025-09-02"),
 "ITV25": ("India TV", "2025-09-01", "https://www.indiatvnews.com/news/india/rain-havoc-in-gurugram-waterlogging-triggers-massive-traffic-jams-people-stuck-for-hours-on-delhi-jaipur-highway-video-2025-09-01-1006203"),
 "BT26a": ("Business Today", "2026-07-08", "https://www.businesstoday.in/india/story/gurugram-rains-police-advises-work-from-home-asks-citizens-to-avoid-non-essential-travel-541655-2026-07-08"),
 "BT26b": ("Business Today", "2026-08-06", "https://www.businesstoday.in/india/story/delhi-ncr-rains-key-roads-waterlogged-after-heavy-downpour-gurugram-comes-to-a-standstill-547671-2026-08-06"),
 "TRIB26": ("The Tribune", "2026-08-08", "https://www.tribuneindia.com/news/haryana/97mm-rainfall-floods-millennium-city-again-old-gurugram-areas-worst-hit/"),
 "BT26c": ("Business Today", "2026-08-24", "https://www.businesstoday.in/india/story/gurugram-issues-work-from-home-advisory-for-tuesday-following-heavy-rain-and-flooding-551080-2026-08-24"),
 "PTI26": ("PTI via ThePrint", "2026-08-25", "https://theprint.in/india/70-mm-rainfall-over-short-span-inundates-gurugram-road-cave-ins-unending-jams-compound-woes/3024709/"),
}

# event_id: (date, window as stated, rain_mm as stated, rain_note, measured_by, primary source keys)
EVENTS = {
 "E01": ("2023-07-09", "Sunday 06:00-23:00 (article also says total recorded 'till the afternoon')", 150, "", "district administration (as reported)", "DP23"),
 "E02": ("2024-08-11", "Sunday early morning, measured by 08:30", 53, "", "district administration (as reported)", "ITV24"),
 "E03": ("2025-05-25", "Sunday early morning", "", "154 locations reported waterlogging; only 1 named", "", "TRIB25a"),
 "E04": ("2025-07-09", "Wed evening to 08:30 Thu 10 Jul (intermittent overnight)", 133, "Gurugram 133 mm; Wazirabad tehsil 122 mm", "district administration (as reported)", "PTI25a"),
 "E05": ("2025-07-31", "Thursday (time not stated)", 66, "Gurugram 66 mm; Kadipur/Harsaru tehsil areas 122 mm (highest)", "district administration (as reported)", "PTI25b"),
 "E06": ("2025-09-01", "Monday 15:00-19:00", 100, "reported as 'over 100 mm' (lower bound)", "District Disaster Management Authority (as reported)", "BS25;BT25;ITV25"),
 "E07": ("2026-07-07", "Tuesday; 'just an hour of rain'", "", "no Gurugram locations named", "", "BT26a"),
 "E08": ("2026-08-06", "Thursday morning", "", "article mostly Delhi; Gurugram detail limited", "", "BT26b"),
 "E09": ("2026-08-07", "Friday (one-day total)", 97, "'nearly 97 mm' over one day", "not stated", "TRIB26"),
 "E10": ("2026-08-24", "Monday (time not stated)", "", "rainfall not stated", "", "BT26c"),
 "E11": ("2026-08-25", "Tuesday; ~70 mm over a 35-minute period", 70, "short, intense burst", "not stated", "PTI26"),
}

# raw name -> (canonical, type). Unlisted names are used as their own canonical name.
CANON = {
 "Sheetla Mata Mandir Road": ("Sheetla Mata Road", "road"), "Sheetla Mata road": ("Sheetla Mata Road", "road"),
 "Sheetla Mata Road": ("Sheetla Mata Road", "road"),
 "Khandsa": ("Khandsa Chowk", "junction"), "Khandsa Chowk": ("Khandsa Chowk", "junction"),
 "Bus Stand Road": ("Bus Adda / Old Bus Stand area", "area"), "Bus Adda road": ("Bus Adda / Old Bus Stand area", "area"),
 "Old Bus Stand area": ("Bus Adda / Old Bus Stand area", "area"),
 "Old Delhi Road": ("Old Delhi-Gurugram Road", "road"), "old Gurugram-Delhi road": ("Old Delhi-Gurugram Road", "road"),
 "Delhi-Jaipur Expressway": ("NH-48 Delhi-Gurugram corridor", "corridor"), "Gurugram-Delhi Expressway": ("NH-48 Delhi-Gurugram corridor", "corridor"),
 "Delhi-Jaipur highway": ("NH-48 Delhi-Gurugram corridor", "corridor"), "NH-48 stretch": ("NH-48 Delhi-Gurugram corridor", "corridor"),
 "NH-8 corridor": ("NH-48 Delhi-Gurugram corridor", "corridor"), "NH-48 corridor": ("NH-48 Delhi-Gurugram corridor", "corridor"),
 "Sohna Road (Airia Mall stretch)": ("Sohna Road", "road"), "Sohna Road": ("Sohna Road", "road"),
 "Sadar Red Light area": ("Sadar Red Light", "junction"),
 "Near Gurugram MLA office": ("Near Gurugram MLA office", "area"), "Police line": ("Police Line", "area"),
 "Jharsa village to Sector 30/40 stretch": ("Jharsa to Sector 30/40 stretch", "road"),
 "Tulip Chowk, Sector 69 (60-m road)": ("Tulip Chowk, Sector 69", "junction"),
 "Ardee City towards Sector 52": ("Ardee City to Sector 52 road", "road"),
 "Sector 10 (near Euro International School)": ("Sector 10", "sector"),
 "Narsinghpur": ("Narsinghpur (NH-48 stretch)", "corridor"),
 "Basai (places near)": ("Basai (area)", "area"),
 "Dwarka Expressway service lane near Sector 104": ("Dwarka Expressway service lane near Sector 104", "road"),
 "Sikanderpur Metro station": ("Sikanderpur Metro station", "station"),
 "Sector 15 Part 2 (park)": ("Sector 15 Part 2", "park"),
}
def canon(raw):
    if raw in CANON: return CANON[raw]
    if raw.startswith("Sector "): return (raw, "sector")
    if raw.endswith("Chowk"): return (raw, "junction")
    if raw.endswith("Road"): return (raw, "road")
    if raw.endswith("underpass"): return (raw, "underpass")
    if raw in ("DLF Phase 3 V Block", "South City-1", "Rosewood City", "Malibu Town", "Greenwood City", "Palam Vihar"): return (raw, "colony")
    return (raw, "area")

SECT = lambda s: [f"Sector {n}" for n in s.split(",")]
# (event, source, [raw names], report_type)
REPORTS = [
 ("E01","DP23",["Himgiri Chowk","Aggarwal Dharmshala Chowk","Sheetla Mata Mandir Road","Kanhai Chowk","Rajiv Chowk","MG Road","Sohna Road","Udyog Vihar","Rosewood City","Malibu Town","Delhi-Jaipur Expressway","Narsinghpur","Near Gurugram MLA office","Police line","Bus Stand Road","Hero Honda Chowk","Basai Chowk","Khandsa","Subhash Chowk","Palam Vihar","Greenwood City","Jharsa village to Sector 30/40 stretch"]+SECT("14,17,31,30,40,15,10,9,10A,29,39,47"),"waterlogged"),
 ("E02","ITV24",["Gurugram-Delhi Expressway","Narsinghpur"],"waterlogged"),
 ("E02","ITV24",["DLF Phase 1 underpass","DLF Phase 3 underpass","Sector 4-5 underpass","Palam Vihar underpass","Suncity Township underpass"],"underpass_closed"),
 ("E03","TRIB25a",["Sector 15 Part 2 (park)"],"waterlogged"),
 ("E04","PTI25a",["Narsinghpur","Basai (places near)","Golf Course Extension Road","Rajiv Chowk","Sheetla Mata road","Sadar Bazaar","Bus Adda road","Basai Chowk","Khandsa","Sanjay Gram Road","Sohna Road","Subhash Chowk"]+SECT("30,31,40,45,47,51,22,23,4,5,12,13,48"),"waterlogged"),
 ("E05","PTI25b",["Narsinghpur","Subhash Chowk","old Gurugram-Delhi road","Hero Honda Chowk","Sohna Road","Rajiv Chowk","Sector 56 Road","Golf Course Extension Road","Udyog Vihar","Dwarka Expressway service lane near Sector 104"],"waterlogged"),
 ("E06","BS25",["IFFCO Chowk","Rajiv Chowk","Sohna Road"],"waterlogged"),
 ("E06","BS25",["Sikanderpur Metro station"],"station_gate_flooded"),
 ("E06","BT25",["Sheetla Mata Mandir Road","Sadar Red Light area","Hero Honda Chowk","Sohna Road","Narsinghpur","NH-48 stretch"],"waterlogged"),
 ("E06","ITV25",["Hero Honda Chowk","IFFCO Chowk","Delhi-Jaipur highway"],"waterlogged"),
 ("E08","BT26b",["IFFCO Chowk"],"waterlogged_embedded_post"),
 ("E08","BT26b",["NH-48 corridor"],"waterlogged"),
 ("E09","TRIB26",["Sheetla Mata Road","Dundahera","Surat Nagar","Bajghera","Dhanwapur Road","Old Bus Stand area","Old Delhi Road","Sector 9","Kadipur","NH-8 corridor"],"waterlogged"),
 ("E10","BT26c",["Sector 10 (near Euro International School)","South City-1","Tulip Chowk, Sector 69 (60-m road)","Narsinghpur","Sector 9","Sector 14","Sector 45","DLF Phase 3 V Block","Ardee City towards Sector 52","Sector 52A","Sector 5","Sohna Road (Airia Mall stretch)"],"waterlogged"),
 ("E11","PTI26",["Subhash Chowk"],"waterlogged"),
 ("E11","PTI26",["IFFCO Chowk"],"road_damage_cave_in"),
 ("E11","PTI26",["Delhi-Jaipur highway"],"road_damage_cave_in"),
]

def w(name, header, rows):
    with open(os.path.join(OUT, name), "w", newline="", encoding="utf-8") as f:
        cw = csv.writer(f); cw.writerow(header); cw.writerows(rows)

# ---- reports (long)
rep_rows, seen = [], set()
for eid, sk, raws, rtype in REPORTS:
    for raw in raws:
        c, t = canon(raw)
        key = (eid, c, sk, rtype)
        if key in seen: continue
        seen.add(key)
        rep_rows.append([eid, raw, c, t, rtype, sk, SOURCES[sk][2]])
w("flood_reports.csv", ["event_id","location_as_written","location_canonical","location_type","report_type","source_key","source_url"], rep_rows)

# ---- per-event depth (distinct canonical locations)
by_event = collections.defaultdict(set)
for r in rep_rows: by_event[r[0]].add(r[2])
depth = {e: len(v) for e, v in by_event.items()}

ev_rows = []
for eid, (d, win, mm, note, by, sks) in EVENTS.items():
    n = depth.get(eid, 0)
    ev_rows.append([eid, d, win, mm, note, by, n, "yes" if n >= 3 else "no", "; ".join(SOURCES[k][2] for k in sks.split(";"))])
w("events.csv", ["event_id","event_date","rain_window_as_stated","rain_mm_stated","rain_note","rain_measured_by","n_locations_named","usable_for_matrix","source_urls"], ev_rows)

# ---- location registry
locs = {}
for r in rep_rows:
    locs.setdefault(r[2], {"type": r[3], "events": set()})["events"].add(r[0])
usable = sorted(e for e in EVENTS if depth.get(e, 0) >= 3)
loc_rows = []
for i, (c, v) in enumerate(sorted(locs.items(), key=lambda kv: (-len(kv[1]["events"]), kv[0])), 1):
    q = f"{c}, Gurugram, Haryana, India"
    loc_rows.append([f"L{i:03d}", c, v["type"], len(v["events"] & set(usable)), q, "", "", "to_geocode"])
w("locations.csv", ["location_id","location_canonical","location_type","n_usable_events_reported","geocode_query","lat","lon","coord_status"], loc_rows)

# ---- location x event matrix (usable events only), with leakage-safe prior counts
date_of = {e: EVENTS[e][0] for e in EVENTS}
flooded = collections.defaultdict(dict)  # (loc) -> event -> evidence
for r in rep_rows:
    eid, c, rtype = r[0], r[2], r[4]
    ev = "explicit_waterlogging" if rtype == "waterlogged" else "indirect_closure_or_damage"
    if flooded[c].get(eid) != "explicit_waterlogging": flooded[c][eid] = ev
mx_rows = []
order = sorted(usable, key=lambda e: date_of[e])
for lid, c, t, *_ in loc_rows:
    prior_pos = prior_obs = 0
    for e in order:
        rep = flooded[c].get(e)
        mx_rows.append([e, date_of[e], lid, c, t, 1 if rep else 0, rep if rep else "weak_negative_not_reported", depth[e], prior_pos, prior_obs])
        prior_obs += 1; prior_pos += 1 if rep else 0
w("hotspot_event_matrix.csv", ["event_id","event_date","location_id","location_canonical","location_type","flooded_reported","evidence","event_report_depth","prior_flood_events","prior_events_observed"], mx_rows)

w("sources.csv", ["source_key","outlet","published","url"], [[k, *v] for k, v in SOURCES.items()])

pos = sum(r[5] for r in mx_rows)
print(f"events: {len(EVENTS)} (usable {len(usable)}), locations: {len(loc_rows)}, matrix rows: {len(mx_rows)}, positives: {pos}")
