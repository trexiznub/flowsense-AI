"""Train and backtest the FlowSense risk model, then export site/data/model.json.

Model v0.1 (deliberately small, transparent, explainable):
    logit P(location i floods | rain R mm in 24h) = b0 + b_rain * ln(R/100) + b_arterial * is_arterial_i
    is_arterial = location is a junction, road or highway corridor (vs sector / colony / area).

Tested and DROPPED (no signal in the backtest): location flood-history propensity (coefficient ~ -0.08, AUC fell)
    propensity_i = (prior flood reports + A) / (prior events observed + A + B)   # Beta(A,B) smoothed, earlier events only
and an is_sector dummy. Run with FEATS="ln_rain,x_prop,is_sector,is_arterial" to reproduce.
Spatial ranking is modest (AUC ~0.67) until terrain features (elevation, HAND, TWI) are added.

Validation is forward-chaining: to score event k we train only on events before k, and each location's
propensity only counts events before k. No future information is used.

KNOWN OPTIMISM: the candidate list (69 locations) was assembled from news mentions across ALL events,
so every candidate flooded at least once somewhere in the sample. Real deployment would rank all ~159
official hotspots, which is harder. Report backtest numbers with that caveat.
"""
import json, os, math, collections
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
D = lambda f: os.path.join(ROOT, "data", f)
A, B = 0.5, 1.5
L2 = 1.0

m = pd.read_csv(D("hotspot_event_matrix.csv"))
ev = pd.read_csv(D("events.csv")).set_index("event_id")
locs = pd.read_csv(D("locations.csv"))
order = sorted(m.event_id.unique(), key=lambda e: ev.loc[e, "event_date"])
rain = ev["rain_mm_stated"].to_dict()

def prop(pos, obs): return (pos + A) / (obs + A + B)
logit = lambda p: np.log(p / (1 - p))

m["propensity"] = prop(m.prior_flood_events, m.prior_events_observed)
m["x_prop"] = logit(m.propensity)
m["is_sector"] = (m.location_type == "sector").astype(float)
m["is_arterial"] = m.location_type.isin(["junction", "road", "corridor"]).astype(float)
m["ln_rain"] = m.event_id.map(lambda e: math.log(rain[e] / 100.0) if not np.isnan(rain[e]) else np.nan)
FEATS = os.environ.get("FEATS", "ln_rain,is_arterial").split(",")   # x_prop and is_sector dropped: no added signal in forward-chained backtest

def fit(df, feats=FEATS, iters=60):
    X = np.column_stack([np.ones(len(df))] + [df[f].values for f in feats]); y = df.flooded_reported.values.astype(float)
    w = np.zeros(X.shape[1]); R = np.eye(X.shape[1]) * L2; R[0, 0] = 0
    for _ in range(iters):                                   # Newton / IRLS with L2
        p = 1 / (1 + np.exp(-X @ w)); g = X.T @ (p - y) + R @ w
        H = (X * (p * (1 - p))[:, None]).T @ X + R + 1e-9 * np.eye(len(w))
        step = np.linalg.solve(H, g); w -= step
        if np.abs(step).max() < 1e-8: break
    return w

def predict(w, df, feats=FEATS):
    X = np.column_stack([np.ones(len(df))] + [df[f].fillna(0).values for f in feats]); return 1 / (1 + np.exp(-X @ w))

def auc(y, s):
    y = np.asarray(y); s = np.asarray(s); pos, neg = s[y == 1], s[y == 0]
    if len(pos) == 0 or len(neg) == 0: return float("nan")
    r = pd.Series(np.concatenate([pos, neg])).rank().values
    return float((r[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))

def topk(y, s, k): idx = np.argsort(-s, kind="stable")[:k]; return float(np.asarray(y)[idx].sum() / max(1, min(k, int(np.sum(y)))))

# ---------- forward-chaining backtest
rows, replay = [], {}
for k in range(1, len(order)):
    test_e = order[k]; train_e = order[:k]
    tr = m[m.event_id.isin(train_e) & m.ln_rain.notna()]
    te = m[m.event_id == test_e].copy()
    if tr.event_id.nunique() < 2:                              # not enough history to fit the rain term
        continue
    w = fit(tr); te["score"] = predict(w, te)
    pos = int(te.flooded_reported.sum())
    base = pos / len(te)
    typ = te.is_arterial.values * 1.0                          # type-only baseline
    rows.append(dict(event_id=test_e, date=ev.loc[test_e, "event_date"], n_candidates=len(te), n_reported=pos,
                     auc_model=auc(te.flooded_reported, te.score), auc_type_only=auc(te.flooded_reported, typ),
                     precision_at_k_model=topk(te.flooded_reported, te.score.values, pos),
                     precision_at_k_type_only=topk(te.flooded_reported, typ, pos), precision_at_k_random=base,
                     recall_top20_model=float(te.sort_values("score", ascending=False).head(20).flooded_reported.sum() / max(1, pos)),
                     expected_flooded=float(te.score.sum()) if not np.isnan(rain[test_e]) else None, rain_mm=None if np.isnan(rain[test_e]) else rain[test_e]))
    te = te.sort_values("score", ascending=False)
    replay[test_e] = [dict(id=r.location_id, name=r.location_canonical, score=round(float(r.score), 4), flooded=int(r.flooded_reported)) for r in te.itertuples()]
bt = pd.DataFrame(rows)
print(bt.round(3).to_string(index=False))
summ = {c: float(bt[c].mean()) for c in ["auc_model", "auc_type_only", "precision_at_k_model", "precision_at_k_type_only", "precision_at_k_random", "recall_top20_model"]}
print("\nmean over", len(bt), "forward-chained events:", {k: round(v, 3) for k, v in summ.items()})

# ---------- final model: all events with stated rain; propensity as of today (all 8 events)
w_final = fit(m[m.ln_rain.notna()])
names = ["intercept"] + FEATS
print("\nfinal coefficients:", dict(zip(names, np.round(w_final, 3))))

# current propensity per location
g = m.groupby("location_id").agg(pos=("flooded_reported", "sum"), obs=("flooded_reported", "count"))
events_of = collections.defaultdict(list)
for r in m[m.flooded_reported == 1].itertuples(): events_of[r.location_id].append(r.event_id)
rep = pd.read_csv(D("flood_reports.csv"))
src_of = rep.groupby("location_canonical").source_url.apply(lambda s: sorted(set(s))).to_dict()
loc_out = []
for r in locs.itertuples():
    pos = int(g.loc[r.location_id, "pos"]); obs = int(g.loc[r.location_id, "obs"])
    loc_out.append(dict(id=r.location_id, name=r.location_canonical, type=r.location_type, pos=pos, obs=obs,
                        propensity=round(prop(pos, obs), 4), events=events_of.get(r.location_id, []),
                        sources=src_of.get(r.location_canonical, [])[:3]))
ev_out = [dict(id=e, date=ev.loc[e, "event_date"], rain_mm=None if np.isnan(rain[e]) else rain[e], window=ev.loc[e, "rain_window_as_stated"],
               n_reported=int(m[(m.event_id == e)].flooded_reported.sum()), source=str(ev.loc[e, "source_urls"]).split("; ")[0]) for e in order]

out = dict(version="0.1", built="2026-11-11",
           model=dict(feature_names=names, coef=[float(x) for x in w_final], smoothing=dict(A=A, B=B), l2=L2,
                      rain_ref_mm=100.0, class_thresholds=dict(moderate=0.10, high=0.25, severe=0.50)),
           backtest=dict(per_event=json.loads(bt.round(4).to_json(orient="records")), mean=summ, n_events=len(bt),
                         method="forward-chaining: train on earlier events only; propensity counts earlier events only",
                         caveat="Candidate list built from news mentions across all events, so results are optimistic versus ranking all ~159 official hotspots."),
           events=ev_out, locations=loc_out, replay=replay)
dst = os.path.join(ROOT, "data", "model.json")
json.dump(out, open(dst, "w"), indent=1, allow_nan=False)   # browsers reject NaN; fail loudly instead
print("wrote", dst, os.path.getsize(dst), "bytes")
