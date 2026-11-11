# FlowSense AI

Live site: https://trexiznub.github.io/flowsense-AI/ · Repo: https://github.com/trexiznub/flowsense-AI

Predictive flood intelligence and citizen coordination for Gurugram. SustainX 2026 prototype (v0.1) by Ujwal Raj K P and Sameer Kumar, Symbiosis Institute of International Business, Pune.

A static website: no backend, no build step. It loads a small trained model (`data/model.json`) and runs it in the browser.

**What's new in v0.3 (polish + differentiators)**
- **Crew planner:** set how many pumps and inspection crews you have; it allocates them by predicted risk and shows the share of expected flooding covered versus sending them at random.
- **Printable duty-officer brief:** one click builds a clean A4 page (top locations, actions, resource plan, override count, status warning, signature lines) and opens the print dialog (Save as PDF works).
- **Override audit:** downgrades of a model's risk class are flagged in the log so reviewers can spot them.
- Fixes: city dot-map colours, clipped focus rings and dropdown arrow, tighter hero typography and legibility, reveal bug on tall sections on phones, scroll progress bar and active-section nav.

**What's new in v0.2 (redesign)**
- Apple-style premium UI: calm sections, scroll reveals, glass nav, dark mode toggle, illustrated scenes (drain cutaway, how-it-works scenes, animated skyline hero).
- Simpler console: one big rain number, a gauge, a dot-map of all 69 locations and the top-5 action cards. The full list is one tap away.
- **Plan My Day** is now a 3-step flow: pick places, set times, watch a response simulation that plays (with pause, scrub, 2x). It drives a phone mock-up with notifications and a response tracker.
- Extras: shareable plan links, add-to-calendar (.ics), English/Hindi alert toggle, rain presets, installable PWA (manifest + service worker + icons).
- The Leaflet map was removed in this version; the dot-map replaces it until verified coordinates exist (`data/coords.json` is still produced by `model/export_coords.py`).
- The response simulation is an illustrative timeline with assumed timings, not live data.

**What it does**
- **Risk console:** set expected rainfall (or pull the live Open-Meteo forecast) and every tracked location gets a flood probability, a risk class and a recommended action. Replay any past event using a model trained only on earlier events.
- **Plan My Day:** turns a prediction into a resident alert (English and Hindi SMS text) and shows predicted risk and field-confirmed incidents separately.
- **Governance:** override log that demands a justification and an approving officer; closure recommendations labelled as needing traffic-police approval.
- **Backtest and method:** forward-chained results, the model formula, every data source.

## Run locally
```
python3 -m http.server 8000      # then open http://localhost:8000
```
Opening `index.html` by double-click will not work because browsers block `fetch` on `file://`.

## Deploy on GitHub Pages
```
git init && git add . && git commit -m "FlowSense AI v0.1"
git branch -M main
git remote add origin https://github.com/trexiznub/flowsense-AI.git
git push -u origin main
```
Then on GitHub: **Settings, Pages, Build and deployment, Source: Deploy from a branch, Branch: main, folder: / (root)**. The site appears at `https://trexiznub.github.io/flowsense-AI/` within a minute or two. `.nojekyll` is already included.

## Honest status
- **Trained on 8 news-reported flood events** (2023-2026), 69 named locations, 110 reported-flooded records. Not a live warning system. Do not use for safety decisions.
- **Backtest** (forward-chaining, 6 test events): mean AUC 0.67, top-k precision 41% vs 17% random. Rainfall predicts *how many* locations flood; *which* ones is only modestly better than chance until terrain features are added.
- **Tested and dropped:** location flood history and a sector flag added no signal.
- **Candidate list is optimistic:** the 69 locations were chosen because each was reported at least once.
- **Not the official 159-hotspot list**, whose names are not public in the sources found.
- **Untested here:** the live Open-Meteo forecast button (the build sandbox was offline; the failure path was tested). Check it once on the deployed site.
- Locations of the same type share a probability today, so many rows tie. That is a real limit of v0.1, not a display bug.

## Make it better (in this order)
1. **Add events.** Each needs a date, stated rainfall and named locations with a source URL. Edit `SOURCES`, `EVENTS`, `REPORTS` in `pipeline/make_labels.py`, then `python3 pipeline/make_labels.py` and `python3 model/train_model.py`. Aim for 20+ events.
2. **Add terrain features** on a computer with internet: `pip install requests pandas numpy rasterio pysheds shapely pyproj`, then in `pipeline/`: `python3 build_features.py geocode`, check every point on a map, put fixes in `data/manual_coords.csv` (`location_id,lat,lon`), re-run `geocode`, then `rain`, `terrain`, `join`. (`terrain` and `geocode` have not been run yet; expect small fixes.) Add the terrain columns to `model/train_model.py`, and keep a feature only if the forward-chained backtest improves.
3. **Light up the map:** `python3 model/export_coords.py` writes `data/coords.json` from verified coordinates. The map then appears automatically.
4. **Get the official hotspot list** from MCG/GMDA (RTI or request) and map it onto the registry.

## Layout
```
index.html, assets/        the website (vanilla HTML/CSS/JS), assets/icons = logo and PWA icons
manifest.webmanifest, sw.js  installable app shell (PWA)
data/model.json            trained model, backtest, replay scores (generated)
data/*.csv                 sourced labels (generated by pipeline/make_labels.py)
data/coords.json           verified coordinates for the map (empty until verified)
model/train_model.py       trains, backtests, exports model.json
model/export_coords.py     verified coordinates -> coords.json
pipeline/                  label builder, geocoding, rainfall and terrain features
```

## Website or app?
For the competition and for MCG/traffic-police users, a website is the right choice: nothing to install, one shareable link, free hosting. For residents, the citizen layer should reach people by SMS and IVR as well, since many do not use smartphones. A website can be added to a phone home screen later (PWA). A native app only becomes worthwhile once there is a live data feed and push-notification need.
gg
