(function () {
'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const sig = (x) => 1 / (1 + Math.exp(-x));
const ART = new Set(['junction', 'road', 'corridor']);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const LAT = 28.4595, LON = 77.0266;
const TYPE_LABEL = { junction: 'Junction', road: 'Road', corridor: 'Highway corridor', sector: 'Sector', colony: 'Colony / township', area: 'Area', underpass: 'Underpass', station: 'Metro station', park: 'Park' };
const CLS = ['Low', 'Moderate', 'High', 'Severe'];
const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.remove('no-js');

let M, LOCS = [], LOC = {}, REPLAY = {}, EVENTS = [], COORDS = {}, SRC = [];
const S = { rain: 100, replay: '', live: null, liveOn: false, showAll: false, q: '', type: 'all',
  places: [], dep: 9, ret: 18, peak: 17, lang: 'en' };

/* ---------- helpers ---------- */
let toastT, armReveal = () => {};
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400); }
function countTo(el, to, fmt, dur) {
  fmt = fmt || ((v) => Math.round(v)); dur = dur || 900;
  const from = parseFloat(el.dataset.v || '0') || 0; el.dataset.v = to;
  if (REDUCED) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  (function step(t) { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); })(t0);
}
const hLabel = (h) => { const hh = Math.floor(h) % 24, m = h % 1 ? '30' : '00'; return (hh % 12 || 12) + (m === '30' ? ':30' : ':00') + (hh < 12 ? ' AM' : ' PM'); };
const hShort = (h) => { const hh = Math.floor(h) % 24, m = h % 1 ? ':30' : ''; return (hh % 12 || 12) + m + (hh < 12 ? ' AM' : ' PM'); };
const colorOf = (c) => ({ Severe: 'var(--sev)', High: 'var(--hi)', Moderate: 'var(--mod)', Low: 'var(--low)' }[c]);
function fillRange(r) { const p = ((r.value - r.min) / (r.max - r.min)) * 100; r.style.setProperty('--pct', p + '%'); }

/* ---------- model ---------- */
function prob(loc, R) {
  const [b0, b1, b2] = M.model.coef;
  return sig(b0 + b1 * Math.log(Math.max(R, 1) / M.model.rain_ref_mm) + b2 * (ART.has(loc.type) ? 1 : 0));
}
function klass(p) { const t = M.model.class_thresholds; return p >= t.severe ? 'Severe' : p >= t.high ? 'High' : p >= t.moderate ? 'Moderate' : 'Low'; }
function action(c, type) {
  const under = type === 'underpass', art = ART.has(type);
  if (c === 'Severe') return [under ? 'Stage a pump, inspect the drain now, prepare to close the underpass to pedestrians.' :
    art ? 'Pre-position a pump, clear the nearest drain, request a diversion.' : 'Pre-position a pump, inspect the nearest drain, alert the local RWA.', art || under ? 'Closure needs traffic-police approval' : ''];
  if (c === 'High') return ['Inspect and desilt the nearest drain before the rain; keep a crew on standby.', ''];
  if (c === 'Moderate') return ['Add to the watch list and check the nearest drain is clear.', ''];
  return ['No action needed. Routine monitoring.', ''];
}
function currentRows() {
  let r = S.replay ? REPLAY[S.replay].map((x) => ({ loc: LOC[x.id], p: x.score, actual: x.flooded })) : LOCS.map((l) => ({ loc: l, p: prob(l, S.rain), actual: null }));
  r.sort((a, b) => b.p - a.p || b.loc.pos - a.loc.pos || a.loc.name.localeCompare(b.loc.name));
  r.forEach((x, i) => { x.rank = i + 1; x.cls = klass(x.p); });
  return r;
}

/* ---------- console ---------- */
function setRain(v, keepLive) {
  S.rain = Math.max(0, Math.min(200, Math.round(v)));
  if (!keepLive) { S.liveOn = false; const lp = $('#livePill'); if (lp) lp.dataset.msg = ''; }
  const sl = $('#rainSlider'); sl.value = S.rain; fillRange(sl);
  $('#rainValue').textContent = S.rain;
  $$('.presets button[data-mm]').forEach((b) => b.classList.toggle('on', +b.dataset.mm === S.rain && !S.replay));
}
function renderGauge(rows) {
  const n = rows.length; let val, lab, chip, pct, top = rows[0] ? rows[0].cls : 'Low';
  if (S.replay) {
    const ev = EVENTS.find((e) => e.id === S.replay), k = ev.n_reported, hits = rows.slice(0, k).filter((x) => x.actual).length;
    val = k; lab = 'locations were reported flooded'; pct = k / n * 100;
    chip = `${fmtDate(ev.date)} · model's top ${k} caught ${hits} (random: ~${(k * k / n).toFixed(1)}) · trained on earlier events only`;
  } else {
    const exp = rows.reduce((a, x) => a + x.p, 0), act = rows.filter((x) => x.cls === 'High' || x.cls === 'Severe').length;
    val = Math.round(exp); lab = 'locations expected to flood'; pct = exp / n * 100;
    chip = act ? `${act} locations at 25%+ risk: act first` : 'No location above the 25% action threshold';
  }
  $('#gArc').style.strokeDashoffset = 100 - Math.min(100, pct);
  $('#gArc').style.stroke = colorOf(S.replay ? 'High' : top);
  countTo($('#gNum'), val); $('#gLab').textContent = lab; $('#gChip').textContent = chip;
}
function renderWaffle(rows) {
  const w = $('#waffle');
  if (w.children.length !== rows.length) { w.innerHTML = rows.map((x, i) => `<i style="animation-delay:${Math.min(i * 12, 700)}ms"></i>`).join(''); }
  [...w.children].forEach((el, i) => { const x = rows[i]; el.className = 'c-' + x.cls + (x.actual ? ' ring' : '');
    el.title = `${x.loc.name}: ${Math.round(x.p * 100)}% (${x.cls})${x.actual === null ? '' : x.actual ? ', reported flooded' : ', not reported'}`; });
  $('#ringLeg').hidden = !S.replay;
  $('#cityNote').textContent = S.replay ? 'Ringed dots were reported flooded' : 'Each dot is a tracked location, sorted by risk';
}
function renderActions(rows) {
  const top = rows.slice(0, 6), box = $('#actCards');
  $('#actNote').textContent = 'In v0.1 many locations of the same type share one probability, so ties are ordered by how often each was reported in past floods.';
  if (!S.replay && top[0].cls === 'Low') { box.innerHTML = '<div class="act k-Low"><b>All clear at this rainfall</b><p class="ok">No tracked location is above the Moderate threshold. Try the Heavy or Severe preset.</p></div>'; return; }
  box.innerHTML = top.map((x, i) => {
    const [a, flag] = action(x.cls, x.loc.type);
    const note = x.actual === null ? '' : `<em style="color:${x.actual ? 'var(--sevT)' : 'var(--mut)'}">${x.actual ? 'Reported flooded' : 'Not reported'}</em>`;
    return `<article class="act k-${x.cls}" style="animation-delay:${i * 70}ms"><div class="act-top"><div><b>${esc(x.loc.name)}</b><small>${esc(TYPE_LABEL[x.loc.type] || x.loc.type)}</small></div><span class="chip ${x.cls}">${x.cls}</span></div>
      <div class="act-p"><strong>${Math.round(x.p * 100)}%</strong><div class="meter"><i style="width:${Math.max(3, x.p * 100)}%;background:${colorOf(x.cls)}"></i></div></div>
      <p>${S.replay ? 'Scored using only data from before this event.' : esc(a)}</p><p class="why">${x.loc.pos ? `Reported flooded in ${x.loc.pos} of ${x.loc.obs} past events` : 'No past reports in usable events'}</p>${flag && !S.replay ? `<em>${flag}</em>` : ''}${note}
      ${S.replay ? '' : `<button class="link" data-ov="${x.loc.id}">Override with reason</button>`}</article>`;
  }).join('');
}
function renderPlanner(rows) {
  const P = +$('#nPumps').value, C = +$('#nCrews').value; $('#oPumps').textContent = P; $('#oCrews').textContent = C;
  ['nPumps', 'nCrews'].forEach((id) => fillRange($('#' + id)));
  const total = rows.reduce((a, x) => a + x.p, 0) || 1, n = rows.length, k = Math.min(n, P + C);
  const pumps = rows.slice(0, Math.min(n, P)), crews = rows.slice(pumps.length, k), cov = rows.slice(0, k).reduce((a, x) => a + x.p, 0);
  const left = rows.slice(k).filter((x) => x.cls === 'High' || x.cls === 'Severe').length;
  $('#plRes').innerHTML = `<div><b>${Math.round(cov / total * 100)}%</b><span>of expected flooding covered</span></div><div><b>${Math.round(k / n * 100)}%</b><span>covered if sent at random (${k} of ${n})</span></div><div><b>${left}</b><span>High/Severe locations left uncovered</span></div>`;
  $('#plChips').innerHTML = pumps.map((x) => `<span><i>PUMP</i>${esc(x.loc.name)}</span>`).join('') + crews.map((x) => `<span><i>CREW</i>${esc(x.loc.name)}</span>`).join('') || '<span>Add pumps or crews above.</span>';
  S.plan = { pumps, crews, cov: cov / total, rand: k / n, left };
}
function openBrief() {
  const rows = currentRows(), pl = S.plan || { pumps: [], crews: [] }, log = getLog();
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
  const src = S.replay ? 'Replay of ' + fmtDate(EVENTS.find((e) => e.id === S.replay).date) + ' (scored with earlier data only)' : S.liveOn ? 'Live Open-Meteo forecast, next 24 h' : 'Assumed scenario';
  const top = rows.slice(0, 12).map((x) => `<tr><td>${x.rank}</td><td>${esc(x.loc.name)}</td><td>${esc(TYPE_LABEL[x.loc.type] || x.loc.type)}</td><td>${Math.round(x.p * 100)}%</td><td>${x.cls}</td><td>${esc(action(x.cls, x.loc.type)[0])}${action(x.cls, x.loc.type)[1] ? ' <b>(' + action(x.cls, x.loc.type)[1] + ')</b>' : ''}</td></tr>`).join('');
  $('#brief').innerHTML = `<h1>FlowSense AI: Duty officer brief</h1><div class="meta">Generated ${esc(now)} IST · Rainfall ${S.rain} mm · ${esc(src)}</div>
    <h2>Priority locations (top 12 of ${rows.length})</h2><table><thead><tr><th>#</th><th>Location</th><th>Type</th><th>Risk</th><th>Class</th><th>Recommended action</th></tr></thead><tbody>${top}</tbody></table>
    <h2>Resources</h2><p>${pl.pumps.length} pumps and ${pl.crews.length} inspection crews, allocated by predicted risk. Pumps: ${esc(pl.pumps.map((x) => x.loc.name).join(', ') || 'none')}. Crews: ${esc(pl.crews.map((x) => x.loc.name).join(', ') || 'none')}.</p>
    <h2>Overrides logged this session: ${log.length}</h2><p>${log.filter((r) => CLS.indexOf(r.to) < CLS.indexOf(r.from)).length} downgrade(s). Each has a justification and an approving officer in the log.</p>
    <div class="warn"><b>Status:</b> prototype v0.1, trained on 8 news-reported events. Predictions are not confirmed incidents. Closures need traffic-police approval and field verification. Not for safety decisions.</div>
    <div class="sign"><div>Duty officer (name, signature)</div><div>Approving authority (name, signature)</div></div>`;
  setTimeout(() => window.print(), 80);
}
function renderList(rows) {
  const q = S.q.trim().toLowerCase();
  const list = rows.filter((x) => (S.type === 'all' || x.loc.type === S.type) && (!q || x.loc.name.toLowerCase().includes(q)));
  $('#allList').innerHTML = list.map((x) => {
    const hist = x.loc.pos ? `Reported in ${x.loc.pos} of ${x.loc.obs} events` : 'No reports in usable events';
    const fl = x.actual === null ? '' : `<span class="flag ${x.actual ? '' : 'no'}">${x.actual ? 'flooded' : 'not reported'}</span>`;
    return `<div class="row"><span class="dot c-${x.cls}"></span><div><b>${esc(x.loc.name)}${fl}</b><small>${esc(TYPE_LABEL[x.loc.type] || x.loc.type)} · ${hist}</small></div><span class="pct">${Math.round(x.p * 100)}%</span><span class="chip ${x.cls}">${x.cls}</span>${S.replay ? '<span></span>' : `<button class="link" data-ov="${x.loc.id}">Override</button>`}</div>`;
  }).join('') || '<p class="hint" style="padding:14px">No locations match.</p>';
}
function renderScatter() {
  const W = 560, H = 250, pl = 44, pb = 38, pt = 14, pr = 12, n = LOCS.length, ev = EVENTS.filter((e) => e.rain_mm);
  const ymax = Math.max(n * 0.5, ...ev.map((e) => e.n_reported)) * 1.1;
  const X = (r) => pl + r / 200 * (W - pl - pr), Y = (v) => H - pb - v / ymax * (H - pb - pt);
  let d = ''; for (let r = 5; r <= 200; r += 5) d += (d ? 'L' : 'M') + X(r).toFixed(1) + ' ' + Y(LOCS.reduce((a, l) => a + prob(l, r), 0)).toFixed(1);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Locations reported flooded in past events against rainfall, with the model's expected count">`;
  for (let i = 0; i <= 4; i++) { const v = ymax * i / 4; s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${pl - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--mut)">${Math.round(v)}</text>`; }
  [0, 50, 100, 150, 200].forEach((r) => s += `<text x="${X(r)}" y="${H - pb + 17}" text-anchor="middle" font-size="11" fill="var(--mut)">${r}</text>`);
  s += `<text x="${W / 2}" y="${H - 4}" text-anchor="middle" font-size="11.5" fill="var(--mut)">Rainfall (mm)</text><text transform="translate(12 ${H / 2}) rotate(-90)" text-anchor="middle" font-size="11.5" fill="var(--mut)">Locations flooded</text>`;
  s += `<path d="${d}" fill="none" stroke="url(#lg)" stroke-width="3.5" stroke-linecap="round"/>`;
  ev.forEach((e) => s += `<circle cx="${X(e.rain_mm)}" cy="${Y(e.n_reported)}" r="6" fill="var(--card)" stroke="var(--fg)" stroke-width="2"><title>${fmtDate(e.date)}: ${e.rain_mm} mm, ${e.n_reported} reported</title></circle>`);
  s += `<line id="scLine" y1="${pt}" y2="${H - pb}" stroke="var(--aqua)" stroke-width="2" stroke-dasharray="5 5"/><g id="scDot"><circle r="7" fill="var(--aqua)"/></g>`;
  $('#scatter').innerHTML = s + '</svg><p class="hint">Dots are past events; the line is what the model expects. The dashed marker follows your slider.</p>';
  $('#scatter').dataset.geo = [pl, W, pr, ymax, H, pb, pt].join(',');
}
function moveScatter() {
  const g = ($('#scatter').dataset.geo || '').split(',').map(Number); if (g.length < 7) return;
  const [pl, W, pr, ymax, H, pb, pt] = g, x = pl + S.rain / 200 * (W - pl - pr), y = H - pb - LOCS.reduce((a, l) => a + prob(l, Math.max(S.rain, 1)), 0) / ymax * (H - pb - pt);
  const ln = $('#scLine'), dt = $('#scDot'); if (!ln) return; ln.setAttribute('x1', x); ln.setAttribute('x2', x); dt.setAttribute('transform', `translate(${x} ${y})`);
}
function render() {
  const rows = currentRows();
  renderGauge(rows); renderWaffle(rows); renderActions(rows); renderPlanner(rows); renderList(rows); moveScatter(); renderReplayRow();
  const lp = $('#livePill');
  lp.hidden = !lp.dataset.msg; lp.textContent = lp.dataset.msg || '';
  renderPlan(); syncUrl();
}
function renderReplayRow() {
  const el = $('#replayRow');
  el.innerHTML = '<small>Replay a past event</small>' + EVENTS.filter((e) => REPLAY[e.id]).map((e) => `<button class="rc${S.replay === e.id ? ' on' : ''}" data-ev="${e.id}">${fmtDate(e.date)}${e.rain_mm ? ' · ' + e.rain_mm + ' mm' : ''}</button>`).join('') + (S.replay ? '<button class="rc" data-ev="">Back to slider</button>' : '');
}

/* live forecast */
async function loadLive() {
  const lp = $('#livePill'); lp.dataset.msg = 'Fetching the live forecast…'; lp.hidden = false; lp.textContent = lp.dataset.msg;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=precipitation&forecast_days=3&timezone=Asia%2FKolkata`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 13).replace(' ', 'T') + ':00';
    let i0 = j.hourly.time.findIndex((t) => t >= now); if (i0 < 0) i0 = 0;
    S.live = { t: j.hourly.time.slice(i0, i0 + 24), p: j.hourly.precipitation.slice(i0, i0 + 24).map((x) => x || 0) };
    const tot = S.live.p.reduce((a, b) => a + b, 0);
    S.replay = ''; setRain(tot, true); S.liveOn = true;
    lp.dataset.msg = `Live: Open-Meteo forecast for Gurugram, next 24 h = ${tot.toFixed(1)} mm. This is a coarse model grid (about 10 km) and can under-forecast short bursts.`;
    toast('Live forecast loaded');
  } catch (e) {
    S.liveOn = false; lp.dataset.msg = 'Could not reach the forecast service (' + e.message + '). Use the slider instead.';
  }
  render();
}

/* ---------- plan my day ---------- */
function hourly() {
  const a = new Array(24).fill(0);
  if (S.liveOn && S.live) { S.live.t.forEach((t, i) => { a[+t.slice(11, 13)] += S.live.p[i]; }); return a; }
  const w = a.map((_, h) => Math.exp(-Math.pow(h - S.peak, 2) / 8)), sum = w.reduce((x, y) => x + y, 0);
  return w.map((x) => x / sum * S.rain);
}
function rainIn(hr, a, len) { let s = 0; for (let t = a; t < a + len - 1e-9; t += 0.5) s += hr[Math.min(23, Math.floor(t))] * 0.5; return s; }
function bestSlot(hr, from, to, want) {
  let best = null;
  for (let t = from; t <= to; t += 0.5) { const r = rainIn(hr, t, 1), sc = r + Math.abs(t - want) * 0.02; if (!best || sc < best.sc) best = { t, r, sc }; }
  return best;
}
const intensity = (v) => v < 1 ? 'dry' : v < 5 ? 'light' : v < 10 ? 'heavy' : 'very heavy';
function planData() {
  const hr = hourly(), rows = S.places.map((id) => ({ l: LOC[id], p: prob(LOC[id], S.rain) })).filter((x) => x.l);
  const worst = rows.reduce((m, x) => (!m || x.p > m.p ? x : m), null);
  const cls = worst ? klass(worst.p) : 'Low';
  const am = rainIn(hr, S.dep, 1), pm = rainIn(hr, S.ret, 1);
  let pk = 0, pki = 0; for (let i = 0; i < 22; i++) { const s = hr[i] + hr[i + 1] + hr[i + 2]; if (s > pk) { pk = s; pki = i; } }
  const bAm = bestSlot(hr, 5, 12, S.dep), bPm = bestSlot(hr, 14, 21.5, S.ret);
  const worstWin = Math.max(am, pm);
  const level = worstWin >= 5 || (worstWin >= 1 && (cls === 'High' || cls === 'Severe')) ? 'avoid' : worstWin >= 1 || cls === 'High' || cls === 'Severe' ? 'watch' : 'calm';
  return { hr, rows, worst, cls, am, pm, pk, pki, bAm, bPm, level, rainy: pk >= 3 };
}
function renderChips() {
  $('#placeChips').innerHTML = S.places.map((id) => { const l = LOC[id], c = klass(prob(l, S.rain));
    return `<button class="chip-btn" data-rm="${id}" aria-label="Remove ${esc(l.name)}"><span class="d c-${c}"></span>${esc(l.name)}<i>×</i></button>`; }).join('') || '<p class="hint">Add at least one place below.</p>';
  const sel = $('#addPlace');
  sel.innerHTML = `<option value="">${S.places.length >= 3 ? 'Maximum of 3 places' : '+ Add a place'}</option>` + [...LOCS].sort((a, b) => a.name.localeCompare(b.name)).filter((l) => !S.places.includes(l.id)).map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  sel.disabled = S.places.length >= 3;
}
function dayChart(d) {
  const W = 640, H = 190, pl = 30, pr = 8, pt = 14, pb = 28, h0 = 5, h1 = 24, bw = (W - pl - pr) / (h1 - h0);
  const mx = Math.max(4, ...d.hr.slice(h0, h1)) * 1.15, X = (h) => pl + (h - h0) * bw, Y = (v) => H - pb - v / mx * (H - pb - pt);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hourly rain forecast with your two commute windows shaded">`;
  for (let i = 0; i <= 2; i++) { const v = mx * i / 2; s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${pl - 5}" y="${Y(v) + 4}" text-anchor="end" font-size="10" fill="var(--mut)">${v.toFixed(0)}</text>`; }
  [[S.dep, 'Leave'], [S.ret, 'Return']].forEach(([t, n]) => s += `<rect x="${X(t)}" y="${pt}" width="${bw}" height="${H - pb - pt}" rx="6" fill="var(--aqua)" opacity=".16"/><text x="${X(t) + bw / 2}" y="${pt + 11}" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--tealD)">${n}</text>`);
  for (let h = h0; h < h1; h++) { const v = d.hr[h], hh = Math.max(v > 0.05 ? 2 : 0, H - pb - Y(v)); s += `<rect x="${X(h) + 3}" y="${H - pb - hh}" width="${bw - 6}" height="${hh}" rx="4" fill="${v >= 5 ? 'var(--sev)' : v >= 1 ? 'var(--hi)' : 'var(--aqua)'}" opacity=".9"><title>${hShort(h)}: ${v.toFixed(1)} mm</title></rect>`; }
  for (let h = h0; h <= h1 - 1; h += 3) s += `<text x="${X(h) + bw / 2}" y="${H - 9}" text-anchor="middle" font-size="10.5" fill="var(--mut)">${hShort(h)}</text>`;
  $('#dayChart').innerHTML = s + `<text x="${pl}" y="${pt - 3}" font-size="10" fill="var(--mut)">mm per hour</text></svg>`;
}
function smsText(d, lang) {
  const names = d.rows.map((x) => x.l.name).join(', ') || 'your area';
  const win = d.rainy ? `${hShort(d.pki)} to ${hShort(d.pki + 3)}` : null;
  if (lang === 'hi') {
    const HI = { Low: 'कम', Moderate: 'मध्यम', High: 'उच्च', Severe: 'गंभीर' };
    return `फ्लोसेंस (पूर्वानुमान, अभी पुष्टि नहीं): ${names} के आसपास जलभराव का जोखिम ${HI[d.cls]}। अनुमानित वर्षा लगभग ${S.rain} मिमी${win ? `, सबसे तेज़ ${win}` : ''}। ${d.level === 'calm' ? 'यात्रा सामान्य रखें।' : `सुझाव: ${hShort(d.bAm.t)} तक निकलें और ${hShort(d.bPm.t)} पर लौटें।`}`;
  }
  return `FlowSense (PREDICTED, not yet confirmed): ${d.cls} flood risk near ${names}. Forecast rain about ${S.rain} mm${win ? `, heaviest ${win}` : ''}. ${d.level === 'calm' ? 'No change to your plans needed.' : `Suggested: leave by ${hShort(d.bAm.t)} and head back around ${hShort(d.bPm.t)}.`}`;
}
function renderPlan() {
  if (!M) return;
  renderChips();
  $('#outDep').textContent = hLabel(S.dep); $('#outRet').textContent = hLabel(S.ret); $('#outPeak').textContent = S.liveOn ? 'from live forecast' : hLabel(S.peak);
  $('#peakWrap').classList.toggle('off', S.liveOn && !!S.live);
  ['depart', 'ret', 'peak'].forEach((id) => fillRange($('#' + id)));
  $('#rainSrc').innerHTML = (S.liveOn ? 'Rain from the <b>live forecast</b> (' + S.rain + ' mm). ' : `Rain assumed: <b>${S.rain} mm</b>. `) + [['Light', 30], ['Heavy', 70], ['Severe', 110], ['Extreme', 150]].map(([n, v]) => `<button class="rc${S.rain === v && !S.liveOn ? ' on' : ''}" data-mm="${v}">${n}</button>`).join('');
  const d = planData(); dayChart(d);
  const names = d.rows.map((x) => x.l.name);
  const lines = [], mk = (when, v, t) => `<li><b>${when} at ${hShort(t)}:</b> ${v < 0.3 ? 'dry' : v.toFixed(1) + ' mm in that hour (' + intensity(v) + ')'}</li>`;
  lines.push(mk('Morning', d.am, S.dep), mk('Evening', d.pm, S.ret));
  if (d.worst) lines.push(`<li><b>${esc(d.worst.l.name)}</b> is your riskiest place: <span class="chip ${d.cls}">${d.cls}</span> ${Math.round(d.worst.p * 100)}% predicted</li>`);
  const head = { calm: 'Smooth day ahead', watch: 'Mostly fine. Allow extra time.', avoid: 'Shift your timing today' }[d.level];
  let best = '';
  if (d.level !== 'calm') best = `<div class="best"><span>Leave by ${hShort(d.bAm.t)}</span><span>Return around ${hShort(d.bPm.t)}</span></div>`;
  const v = $('#verdict'); v.className = 'verdict k-' + d.level;
  v.innerHTML = `<strong>${head}</strong><ul>${lines.join('')}</ul>${best}`;
  $('#smsBox').innerHTML = `<div class="bubble">${esc(smsText(d, S.lang))}</div>`;
  $('#lEn').classList.toggle('on', S.lang === 'en'); $('#lHi').classList.toggle('on', S.lang === 'hi');
  $('#lEn').setAttribute('aria-pressed', S.lang === 'en'); $('#lHi').setAttribute('aria-pressed', S.lang === 'hi');
  // phone
  $('#pDate').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
  const pp = $('#pPred'); pp.className = 'p-card pred k-' + d.cls; pp.innerHTML = `<small>PREDICTED RISK</small><strong>${d.cls} · ${d.worst ? Math.round(d.worst.p * 100) : 0}%</strong><span>${esc(names.join(', ') || 'No places chosen')}</span>`;
  $('#pPlan').innerHTML = `<small>YOUR COMMUTE</small><strong>${head.split('.')[0]}</strong><span>${d.level === 'calm' ? 'No changes needed' : `Leave by ${hShort(d.bAm.t)} · back ${hShort(d.bPm.t)}`}</span>`;
  renderPhoneSim();
}
function copyText(t, msg) { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast(msg), () => toast('Copy failed. Select the text manually.')); }
function icsDownload() {
  const d = planData(), now = new Date(), z = (n) => String(n).padStart(2, '0');
  const day = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); const ymd = `${day.getFullYear()}${z(day.getMonth() + 1)}${z(day.getDate())}`;
  const stamp = (h) => `${ymd}T${z(Math.floor(h))}${h % 1 ? '30' : '00'}00`;
  const ev = (t, title, txt) => `BEGIN:VEVENT\r\nUID:fs-${ymd}-${t}@flowsense\r\nDTSTAMP:${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z\r\nDTSTART;TZID=Asia/Kolkata:${stamp(t)}\r\nDTEND;TZID=Asia/Kolkata:${stamp(t + 1)}\r\nSUMMARY:${title}\r\nDESCRIPTION:${txt.replace(/\n/g, '\\n')}\r\nEND:VEVENT\r\n`;
  const note = 'FlowSense AI prediction (not confirmed). Prototype v0.1: not for safety decisions.';
  const body = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//FlowSense AI//EN\r\n' + ev(S.dep, 'Commute (flood-aware)', `Predicted risk ${d.cls}. Rain this hour: ${d.am.toFixed(1)} mm. ${note}`) + ev(S.ret, 'Return commute (flood-aware)', `Predicted risk ${d.cls}. Rain this hour: ${d.pm.toFixed(1)} mm. ${note}`) + 'END:VCALENDAR';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' })); a.download = 'flowsense-commute.ics'; a.click(); toast('Calendar file downloaded');
}
function shareUrl() {
  const p = new URLSearchParams({ r: S.rain, p: S.places.join(','), d: S.dep, b: S.ret, k: S.peak });
  return location.origin + location.pathname + '?' + p.toString() + '#plan';
}
function syncUrl() { try { if (location.protocol.startsWith('http')) history.replaceState(null, '', shareUrl().replace(location.origin, '').replace('#plan', '') + location.hash); } catch (e) { /* ignore */ } }
function loadFromUrl() {
  const q = new URLSearchParams(location.search); if (!q.has('r')) return;
  S.rain = Math.max(0, Math.min(200, +q.get('r') || 100));
  const ids = (q.get('p') || '').split(',').filter((id) => LOC[id]); if (ids.length) S.places = ids.slice(0, 3);
  S.dep = +q.get('d') || S.dep; S.ret = +q.get('b') || S.ret; S.peak = +q.get('k') || S.peak;
}

/* simulation */
const WO = [
  { t: 0, x: 'Rain starts' }, { t: 1.5, x: 'Water rises on the road' }, { t: 2.5, x: 'Residents call helplines and post online' },
  { t: 4, x: 'Crew dispatched after complaints' }, { t: 6, x: 'Pump arrives; the road is already flooded' }, { t: 8, x: 'Water clears. Reopening is informal and unverified' }];
const WI = [
  { t: -24, x: 'Risk flagged 24 hours ahead', n: 'Risk flagged', nt: 'FlowSense: flood risk predicted. Drain inspection scheduled.' },
  { t: -20, x: 'Drain inspection scheduled', n: 'Drain inspected' }, { t: -12, x: 'Drain desilted' },
  { t: -6, x: 'Pump positioned nearby', n: 'Pump positioned', nt: 'Field team: pump positioned near your route.' },
  { t: -3, x: 'Residents alerted by SMS (predicted)', n: 'Residents alerted', nt: 'SMS' },
  { t: -2, x: 'Diversion requested. Traffic police approve' }, { t: 0, x: 'Rain starts' },
  { t: 1.5, x: 'Water rises. Pump already running' }, { t: 3, x: 'Water level falling' },
  { t: 4, x: 'Field team verifies the road is safe', n: 'Road verified', nt: 'Field-verified: road reopened.' }];
const T0 = -24, T1 = 8;
const SIM = { t: T0, playing: false, speed: 1, last: 0, raf: 0, auto: false };
const fmtT = (t) => (t > 0 ? '+' : t < 0 ? '−' : '') + Math.abs(t) + ' h';
function buildSim() {
  const mk = (arr, id) => { $(id).innerHTML = arr.map((e, i) => `<button class="mk" data-t="${e.t}" style="left:${(e.t - T0) / (T1 - T0) * 100}%" aria-label="${esc(e.x)}"></button>`).join(''); };
  mk(WO, '#mkWo'); mk(WI, '#mkWi');
  $('#listWo').innerHTML = WO.map((e) => `<li data-t="${e.t}"><b>${fmtT(e.t)}</b><span>${esc(e.x)}</span></li>`).join('');
  $('#listWi').innerHTML = WI.map((e) => `<li data-t="${e.t}"><b>${fmtT(e.t)}</b><span>${esc(e.x)}</span></li>`).join('');
  $('#pTrack').innerHTML = WI.filter((e) => e.n).map((e) => `<li data-t="${e.t}">${esc(e.n)}</li>`).join('');
  $('#stWarn').textContent = '24 h';
}
let lastNotif = -1;
function paintSim() {
  const t = SIM.t, p = (t - T0) / (T1 - T0);
  $('#playhead').style.setProperty('--p', p);
  $('#simScrub').value = t; fillRange($('#simScrub'));
  $('#fillWi').style.width = Math.max(0, p * 100) + '%';
  $('#fillWo').style.width = Math.max(0, Math.min(25, (Math.max(0, t) / T1) * 25)) + '%';
  const mark = (arr, ul, mkEl) => { let now = -1; arr.forEach((e, i) => { if (e.t <= t + 1e-9) now = i; });
    $$('li', $(ul)).forEach((li, i) => { li.classList.toggle('on', i <= now); li.classList.toggle('now', i === now); });
    $$('.mk', $(mkEl)).forEach((m, i) => m.classList.toggle('on', i <= now)); return now; };
  const nw = mark(WO, '#listWo', '#mkWo'), ni = mark(WI, '#listWi', '#mkWi');
  const tk = $('#ticker'), cur = ni >= 0 ? WI[ni] : null, curO = nw >= 0 ? WO[nw] : null, key = ni + ':' + nw;
  if (tk.dataset.k !== key) { tk.dataset.k = key;
    tk.innerHTML = `<small>${fmtT(Math.round(t * 2) / 2)} · ${t < 0 ? 'before the rain' : 'rain period'}</small><b>${cur ? '✓ With: ' + esc(cur.x) : 'Waiting for the first signal'}</b>` + (curO ? `<small style="margin-top:6px">Without: ${esc(curO.x)}</small>` : ''); }
  const done = t >= 4; $('#stHrs').innerHTML = done ? '4 h<s>8 h</s>' : '&ndash;';
  renderPhoneSim();
}
function renderPhoneSim() {
  const t = SIM.t, steps = WI.filter((e) => e.n); let now = -1;
  steps.forEach((e, i) => { if (e.t <= t + 1e-9) now = i; });
  $$('#pTrack li').forEach((li, i) => { li.classList.toggle('done', i <= now); li.classList.toggle('now', i === now); });
  const road = t >= 4, c = $('#pConf'); c.classList.toggle('on', road);
  c.innerHTML = road ? '<small>CONFIRMED BY FIELD TEAMS</small><strong>Road reopened</strong><span>Verified on site. Predictions and confirmations stay separate</span>' : '<small>CONFIRMED BY FIELD TEAMS</small><strong>None yet</strong><span>Predictions and confirmations stay separate</span>';
  const ns = steps.filter((e) => e.nt && e.t <= t + 1e-9);
  const sig2 = ns.map((e) => e.t).join(',') + ':' + S.lang + S.rain + S.places.join();
  const box = $('#pNotifs'); if (box.dataset.k === sig2) return; box.dataset.k = sig2;
  const d = planData();
  box.innerHTML = ns.slice(-2).map((e) => `<div class="ntf"><b>FlowSense · now</b>${esc(e.nt === 'SMS' ? smsText(d, S.lang) : e.nt)}</div>`).join('');
}
function simLoop(ts) {
  if (!SIM.playing) return;
  const dt = Math.min(0.1, (ts - SIM.last) / 1000); SIM.last = ts;
  SIM.t = Math.min(T1, SIM.t + dt * 2.6 * SIM.speed);
  paintSim();
  if (SIM.t >= T1) { setPlaying(false); toast('Simulation complete: 4 h to a verified-safe road vs 8 h'); return; }
  SIM.raf = requestAnimationFrame(simLoop);
}
function setPlaying(on) {
  SIM.playing = on; $('#simIcon').setAttribute('href', on ? '#i-pause' : '#i-play'); $('#simPlay').setAttribute('aria-label', on ? 'Pause' : 'Play');
  cancelAnimationFrame(SIM.raf);
  if (on) { if (SIM.t >= T1) SIM.t = T0; SIM.last = performance.now(); SIM.raf = requestAnimationFrame(simLoop); }
}

/* ---------- override log ---------- */
const KEY = 'flowsense_overrides_v1'; let memLog = null;
const readLog = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
const writeLog = (a) => { memLog = a; try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { /* memory only */ } };
const getLog = () => memLog || readLog();
function openOverride(id) {
  const x = currentRows().find((r) => r.loc.id === id);
  $('#ovLoc').value = x.loc.name; $('#ovFrom').value = x.cls; $('#ovTo').value = x.cls; $('#ovWhy').value = ''; $('#ovOfficer').value = '';
  $('#ovErr').hidden = true; $('#ovDialog').showModal();
}
function renderLog() {
  const log = getLog(); const dgs = log.filter((r) => CLS.indexOf(r.to) < CLS.indexOf(r.from)).length; $('#logCount').textContent = log.length + (dgs ? ' · ' + dgs + ' downgrade' + (dgs > 1 ? 's' : '') : '');
  $('#logTable tbody').innerHTML = log.length ? log.map((r) => `<tr><td class="tm">${esc(r.time).replace(', ', '<br>')}</td><td><b>${esc(r.loc)}</b></td><td>${esc(r.from)}</td><td class="to">${esc(r.to)}${CLS.indexOf(r.to) < CLS.indexOf(r.from) ? '<span class="dg">Downgrade: review</span>' : CLS.indexOf(r.to) > CLS.indexOf(r.from) ? '<span class="up">Upgrade</span>' : ''}</td><td>${esc(r.why)}</td><td>${esc(r.officer)}</td></tr>`).join('') : '<tr><td colspan="6" class="hint">No overrides logged yet.</td></tr>';
}
function exportLog() {
  const log = getLog(), q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const csv = ['time_ist,location,model_class,changed_to,justification,approving_officer'].concat(log.map((r) => [r.time, r.loc, r.from, r.to, r.why, r.officer].map(q).join(','))).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'flowsense_override_log.csv'; a.click();
}

/* ---------- evidence (backtest + method) ---------- */
function renderBacktest() {
  const b = M.backtest, m = b.mean, pe = b.per_event;
  $('#btIntro').textContent = `Forward-chained over ${b.n_events} events: to score each event, the model was trained only on earlier events. Mean AUC ${m.auc_model.toFixed(2)} (0.50 is chance). Mean top-k precision ${(m.precision_at_k_model * 100).toFixed(0)}% against ${(m.precision_at_k_random * 100).toFixed(0)}% for random picks.`;
  $('#btTable').innerHTML = '<thead><tr><th>Event</th><th>Rain</th><th>Reported</th><th>Top-k</th><th>AUC</th></tr></thead><tbody>' +
    pe.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${r.rain_mm ? r.rain_mm + ' mm' : 'n/s'}</td><td>${r.n_reported}</td><td>${Math.round(r.precision_at_k_model * 100)}%</td><td>${r.auc_model.toFixed(2)}</td></tr>`).join('') +
    `</tbody><tfoot><tr><td colspan="3"><b>Mean</b></td><td><b>${Math.round(m.precision_at_k_model * 100)}%</b></td><td><b>${m.auc_model.toFixed(2)}</b></td></tr></tfoot>`;
  const W = 520, H = 260, pl = 36, pb = 40, pt = 30, bw = (W - pl - 10) / pe.length;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Top-k precision of the model versus random picks, per event">`;
  [0, .25, .5, .75, 1].forEach((v) => { const y = H - pb - v * (H - pb - pt); svg += `<line x1="${pl}" x2="${W - 4}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--mut)">${Math.round(v * 100)}%</text>`; });
  pe.forEach((r, i) => { const x0 = pl + i * bw + bw * .14, w = bw * .34;
    [[r.precision_at_k_model, 'var(--teal)'], [r.precision_at_k_random, 'rgba(127,127,127,.4)']].forEach(([v, c], j) => { const h = v * (H - pb - pt);
      svg += `<rect x="${x0 + j * (w + 3)}" y="${H - pb - h}" width="${w}" height="${h}" rx="3" fill="${c}"/><text x="${x0 + j * (w + 3) + w / 2}" y="${H - pb - h - 4}" text-anchor="middle" font-size="9.5" fill="var(--fg)" font-weight="600">${Math.round(v * 100)}</text>`; });
    svg += `<text x="${pl + i * bw + bw / 2}" y="${H - pb + 15}" text-anchor="middle" font-size="10" fill="var(--mut)">${r.date.slice(5)}</text><text x="${pl + i * bw + bw / 2}" y="${H - pb + 28}" text-anchor="middle" font-size="9" fill="var(--mut)">${r.date.slice(0, 4)}</text>`; });
  svg += `<g font-size="10.5" fill="var(--fg)"><rect x="${pl}" y="2" width="10" height="10" rx="2" fill="var(--teal)"/><text x="${pl + 14}" y="11">Model</text><rect x="${pl + 70}" y="2" width="10" height="10" rx="2" fill="rgba(127,127,127,.4)"/><text x="${pl + 84}" y="11">Random picks</text></g></svg>`;
  $('#btChart').innerHTML = svg;
  const lo = Math.min(...pe.map((r) => r.auc_model)), hi = Math.max(...pe.map((r) => r.auc_model));
  $('#btHonest').innerHTML = `<b>How to read this honestly.</b> Rainfall is a strong signal for <i>how many</i> locations flood. Ranking <i>which</i> flood is only modestly better than chance (event AUC ${lo.toFixed(2)} to ${hi.toFixed(2)}) because v0.1 knows only rainfall and road type. With ${b.n_events} test events the uncertainty is wide. ${esc(b.caveat)} The planned fix is terrain-aware features, not a bigger model.`;
}
function renderMethod() {
  const [b0, b1, b2] = M.model.coef;
  $('#formula').textContent = `logit P(flood) = ${b0.toFixed(2)} + ${b1.toFixed(2)} x ln(R / 100) + ${b2.toFixed(2)} x [junction, road or corridor]    (R = rainfall in mm)`;
  const W = 520, H = 230, pl = 40, pb = 34, pt = 12, X = (r) => pl + (r / 200) * (W - pl - 10), Y = (p) => H - pb - p * (H - pb - pt);
  const line = (art) => { let d = ''; for (let r = 5; r <= 200; r += 5) d += (d ? 'L' : 'M') + X(r).toFixed(1) + ' ' + Y(sig(b0 + b1 * Math.log(r / 100) + (art ? b2 : 0))).toFixed(1); return d; };
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Flood probability against rainfall for junctions and roads versus other locations">`;
  [0, .25, .5, .75, 1].forEach((v) => s += `<line x1="${pl}" x2="${W - 8}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${pl - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="10" fill="var(--mut)">${Math.round(v * 100)}%</text>`);
  [0, 50, 100, 150, 200].forEach((r) => s += `<text x="${X(r)}" y="${H - pb + 14}" text-anchor="middle" font-size="10" fill="var(--mut)">${r}</text>`);
  s += `<text x="${W / 2}" y="${H - 4}" text-anchor="middle" font-size="10.5" fill="var(--mut)">Rainfall over the event (mm)</text>`;
  const t = M.model.class_thresholds; [['moderate', t.moderate], ['high', t.high], ['severe', t.severe]].forEach(([n, v]) => s += `<line x1="${pl}" x2="${W - 8}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--mut)" stroke-dasharray="3 4" stroke-opacity=".5"/><text x="${W - 10}" y="${Y(v) - 3}" text-anchor="end" font-size="9" fill="var(--mut)">${n}</text>`);
  s += `<path d="${line(false)}" fill="none" stroke="var(--mut)" stroke-width="2.2"/><path d="${line(true)}" fill="none" stroke="var(--teal)" stroke-width="2.8"/>`;
  EVENTS.filter((e) => e.rain_mm).forEach((e) => s += `<path d="M${X(e.rain_mm)} ${H - pb} l-4 7 h8 z" fill="var(--navy2)"/>`);
  s += `<g font-size="10.5" font-weight="600"><rect x="${pl + 10}" y="${pt + 2}" width="14" height="3" rx="1.5" fill="var(--teal)"/><text x="${pl + 30}" y="${pt + 7}" fill="var(--tealD)">Junction / road / corridor</text><rect x="${pl + 10}" y="${pt + 20}" width="14" height="3" rx="1.5" fill="var(--mut)"/><text x="${pl + 30}" y="${pt + 25}" fill="var(--mut)">Other locations</text></g>`;
  $('#curveChart').innerHTML = s + '</svg><p class="hint">Triangles mark the rainfall of past events used for training.</p>';
  $('#evTable').innerHTML = '<thead><tr><th>Date</th><th>Rain</th><th>Reported</th><th>Source</th></tr></thead><tbody>' + EVENTS.map((e) => `<tr><td>${fmtDate(e.date)}</td><td>${e.rain_mm ? e.rain_mm + ' mm' : 'not stated'}</td><td>${e.n_reported}</td><td><a href="${esc(e.source)}" target="_blank" rel="noopener">article</a></td></tr>`).join('') + '</tbody>';
  $('#srcList').innerHTML = SRC.map((x) => `<li>${esc(x.outlet)}, ${fmtDate(x.published)}: <a href="${esc(x.url)}" target="_blank" rel="noopener">link</a></li>`).join('');
}

/* ---------- decorative scenes ---------- */
function heroScene() {
  let rain = ''; for (let i = 0; i < 70; i++) { const x = Math.random() * 1440, len = 14 + Math.random() * 22, dur = 0.8 + Math.random() * 0.9, del = -Math.random() * 2;
    rain += `<line class="rain-l" x1="${x}" y1="${Math.random() * 300}" x2="${x - 5}" y2="${Math.random() * 300 + len}" style="animation-duration:${dur}s;animation-delay:${del}s"/>`; }
  let b = '', x = 0, seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  while (x < 1440) { const w = 46 + rnd() * 70, h = 90 + rnd() * 230, wins = Math.floor(h / 26);
    b += `<rect x="${x}" y="${600 - h}" width="${w}" height="${h}" fill="#0a1d38" stroke="#12315c"/>`;
    for (let i = 0; i < wins; i++) for (let j = 0; j < Math.floor(w / 18); j++) if (rnd() > .62) b += `<rect class="win" x="${x + 8 + j * 18}" y="${600 - h + 10 + i * 26}" width="8" height="11" rx="2" fill="#fcd581" opacity=".8" style="animation-delay:${-rnd() * 5}s"/>`;
    x += w + 6; }
  $('#heroScene').innerHTML = `<svg viewBox="0 0 1440 600" preserveAspectRatio="xMidYMax slice"><defs><linearGradient id="gw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2dd4bf" stop-opacity=".55"/><stop offset="1" stop-color="#2563eb" stop-opacity=".85"/></linearGradient></defs>
    <g>${b}</g><g>${rain}</g>
    <path class="wave1" d="M-60 520q90-26 180 0t180 0 180 0 180 0 180 0 180 0 180 0 180 0 180 0V620H-60z" fill="url(#gw)" opacity=".6"/>
    <path class="wave2" d="M-60 548q90-22 180 0t180 0 180 0 180 0 180 0 180 0 180 0 180 0 180 0V620H-60z" fill="url(#gw)"/></svg>`;
  let dr = ''; for (let i = 0; i < 46; i++) { const x = 20 + Math.random() * 920, d = 0.7 + Math.random() * 0.8;
    dr += `<line class="rain-l" x1="${x}" y1="${-Math.random() * 60}" x2="${x - 4}" y2="${-Math.random() * 60 + 20}" style="animation-duration:${d}s;animation-delay:${-Math.random() * 2}s;stroke:rgba(80,140,200,.55)"/>`; }
  $('#drainRain').innerHTML = dr;
}
function floats(rows) {
  const t = rows[0];
  $('#fl1').innerHTML = `<b>${esc(t.loc.name)}</b><span>${t.cls} · ${Math.round(t.p * 100)}% at 110 mm</span>`;
  $('#fl2').innerHTML = '<b>24 h ahead</b><span>Drain inspections scheduled</span>';
  $('#fl3').innerHTML = '<b>SMS sent</b><span>Predicted, not yet confirmed</span>';
  setTimeout(() => $$('.float').forEach((f) => f.classList.add('show')), 200);
}
const HOW = [
  ['Predict', 'Rainfall forecasts and road type become a flood probability for every tracked location, 24 to 48 hours ahead.', 'Logistic model · explainable inputs'],
  ['Map', 'Water flows downhill. Locations are ranked together so a blocked drain upstream is seen with the roads it floods downstream.', 'Terrain features are next on the roadmap'],
  ['Act', 'Each high-risk spot gets a plain-language action: inspect, desilt, stage a pump. Closures wait for traffic-police approval.', 'Human approval for every closure'],
  ['Notify', 'Residents get a short SMS in English or Hindi, labelled predicted, with when to travel and what to avoid.', 'SMS and IVR reach people without smartphones']];
let howI = 0, howAuto = true, howTimer;
function setHow(i, user) {
  if (user) { howAuto = false; clearInterval(howTimer); }
  howI = i; $$('.tabs button').forEach((b, k) => { b.classList.toggle('on', k === i); b.setAttribute('aria-selected', k === i); });
  $$('#howScene .sc').forEach((s, k) => s.classList.toggle('on', k === i));
  const h = HOW[i]; $('#howCopy').innerHTML = `<h3>${h[0]}</h3><p>${h[1]}</p><span class="meta">${h[2]}</span>`;
}

/* ---------- init ---------- */
function bindUI() {
  // theme
  const th = (m) => { const R = document.documentElement; R.classList.add('tt'); setTimeout(() => R.classList.remove('tt'), 700); const tb = $('#themeBtn'); tb.classList.remove('spin'); void tb.offsetWidth; tb.classList.add('spin'); R.dataset.theme = m; $('#themeIcon').setAttribute('href', m === 'dark' ? '#i-sun' : '#i-moon'); try { localStorage.setItem('fs_theme', m); } catch (e) { /* ignore */ } };
  let saved = null; try { saved = localStorage.getItem('fs_theme'); } catch (e) { /* ignore */ }
  const sysDark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved) th(saved); else if (sysDark) $('#themeIcon').setAttribute('href', '#i-sun');
  $('#themeBtn').addEventListener('click', () => th((document.documentElement.dataset.theme || (sysDark ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark'));
  // nav + reveal + counters
  const nav = $('#nav'), onScroll = () => nav.classList.toggle('scrolled', scrollY > 30); onScroll(); addEventListener('scroll', onScroll, { passive: true });
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (!e.isIntersecting) return; e.target.classList.add('in'); io.unobserve(e.target);
    $$('[data-count]', e.target).forEach((c) => countTo(c, +c.dataset.count, (v) => (c.dataset.prefix || '') + Math.round(v) + (c.dataset.suffix || ''), 1600)); }), { threshold: 0, rootMargin: '0px 0px -8% 0px' });
  armReveal = () => $$('.rv, .scene-card').forEach((el) => io.observe(el));
  const prog = $('#prog'); addEventListener('scroll', () => { const h = document.documentElement.scrollHeight - innerHeight; prog.style.transform = `scaleX(${h > 0 ? scrollY / h : 0})`; }, { passive: true });
  const links = $$('.links a'), box = $('.links'), ind = document.createElement('span'); ind.className = 'ind'; box.prepend(ind);
  const moveInd = () => { const a = links.find((x) => x.classList.contains('on')); if (!a) { ind.style.opacity = 0; return; }
    ind.style.opacity = 1; ind.style.left = a.offsetLeft + 'px'; ind.style.width = a.offsetWidth + 'px';
    if (box.scrollWidth > box.clientWidth) box.scrollTo({ left: a.offsetLeft - (box.clientWidth - a.offsetWidth) / 2, behavior: 'smooth' }); };
  const spy = new IntersectionObserver((es) => es.forEach((e) => { if (!e.isIntersecting) return; links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)); moveInd(); }), { rootMargin: '-45% 0px -50% 0px' });
  links.forEach((a) => { const t = document.querySelector(a.getAttribute('href')); if (t) spy.observe(t); }); spy.observe($('#top'));
  addEventListener('resize', moveInd);
  ['nPumps', 'nCrews'].forEach((id) => $('#' + id).addEventListener('input', () => renderPlanner(currentRows())));
  $('#btnBrief').addEventListener('click', openBrief);
  // how
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => setHow(+b.dataset.i, true)));
  howTimer = setInterval(() => { if (howAuto && !REDUCED) setHow((howI + 1) % 4); }, 5500); setHow(0);
  // console
  $('#rainSlider').addEventListener('input', (e) => { S.replay = ''; setRain(+e.target.value); render(); });
  $('.presets').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.id === 'btnLive') return loadLive(); S.replay = ''; setRain(+b.dataset.mm); render(); });
  $('#replayRow').addEventListener('click', (e) => { const b = e.target.closest('[data-ev]'); if (!b) return; S.replay = b.dataset.ev; S.liveOn = false;
    if (S.replay) { const ev = EVENTS.find((x) => x.id === S.replay); if (ev.rain_mm) setRain(ev.rain_mm, true); } setRain(S.rain, true); render(); });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-ov]'); if (b) openOverride(b.dataset.ov); });
  $('#btnAll').addEventListener('click', () => { S.showAll = !S.showAll; $('#drawer').classList.toggle('open', S.showAll); $('#btnAll').setAttribute('aria-expanded', S.showAll); });
  $('#search').addEventListener('input', (e) => { S.q = e.target.value; render(); });
  $('#filterType').addEventListener('change', (e) => { S.type = e.target.value; render(); });
  // plan
  $('#placeChips').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; S.places = S.places.filter((x) => x !== b.dataset.rm); render(); });
  $('#addPlace').addEventListener('change', (e) => { if (e.target.value && S.places.length < 3) { S.places.push(e.target.value); toast('Place added'); } render(); });
  $('#depart').addEventListener('input', (e) => { S.dep = +e.target.value; render(); });
  $('#ret').addEventListener('input', (e) => { S.ret = +e.target.value; render(); });
  $('#peak').addEventListener('input', (e) => { S.peak = +e.target.value; S.liveOn = false; render(); });
  $('#rainSrc').addEventListener('click', (e) => { const b = e.target.closest('[data-mm]'); if (!b) return; S.replay = ''; setRain(+b.dataset.mm); render(); });
  $('#lEn').addEventListener('click', () => { S.lang = 'en'; render(); }); $('#lHi').addEventListener('click', () => { S.lang = 'hi'; render(); });
  $('#btnCopy').addEventListener('click', () => copyText($('#smsBox .bubble').textContent, 'Alert copied'));
  $('#btnRwa').addEventListener('click', () => { copyText($('#smsBox .bubble').textContent, 'Alert copied. Paste it into your RWA group.'); });
  $('#btnIcs').addEventListener('click', icsDownload);
  $('#btnShare').addEventListener('click', () => { const u = shareUrl(); if (navigator.share) navigator.share({ title: 'My FlowSense plan', url: u }).catch(() => {}); else copyText(u, 'Plan link copied'); });
  // sim
  $('#simPlay').addEventListener('click', () => { SIM.auto = true; setPlaying(!SIM.playing); });
  $('#simReplay').addEventListener('click', () => { SIM.t = T0; paintSim(); setPlaying(true); });
  $('#simScrub').addEventListener('input', (e) => { setPlaying(false); SIM.t = +e.target.value; paintSim(); });
  $('#sp1').addEventListener('click', () => { SIM.speed = 1; $('#sp1').classList.add('on'); $('#sp2').classList.remove('on'); $('#sp1').setAttribute('aria-pressed', 'true'); $('#sp2').setAttribute('aria-pressed', 'false'); });
  $('#sp2').addEventListener('click', () => { SIM.speed = 2; $('#sp2').classList.add('on'); $('#sp1').classList.remove('on'); $('#sp2').setAttribute('aria-pressed', 'true'); $('#sp1').setAttribute('aria-pressed', 'false'); });
  $('#sim').addEventListener('click', (e) => { const el = e.target.closest('[data-t]'); if (!el) return; setPlaying(false); SIM.t = +el.dataset.t; paintSim(); });
  new IntersectionObserver((es, ob) => { if (es[0].isIntersecting && !SIM.auto) { SIM.auto = true; ob.disconnect(); setPlaying(true); } }, { threshold: 0.2 }).observe($("#sim"));
  // log
  $('#ovForm').addEventListener('submit', (e) => {
    if (!e.submitter || e.submitter.value !== 'save') return;
    if ($('#ovTo').value === $('#ovFrom').value) { e.preventDefault(); const er = $('#ovErr'); er.textContent = 'This is the same class the model already gave. Choose a different class to log an override.'; er.hidden = false; return; }
    $('#ovErr').hidden = true;
    const log = getLog(); log.unshift({ time: new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' }), loc: $('#ovLoc').value, from: $('#ovFrom').value, to: $('#ovTo').value, why: $('#ovWhy').value.trim(), officer: $('#ovOfficer').value.trim() });
    writeLog(log); renderLog(); toast('Override logged with justification and officer');
  });
  $('#btnExport').addEventListener('click', exportLog);
  ['depart', 'ret', 'peak', 'simScrub'].forEach((id) => fillRange($('#' + id)));
}
function parseCSV(t) { const [h, ...r] = t.trim().split(/\r?\n/); const k = h.split(','); return r.map((l) => { const v = l.split(','); const o = {}; k.forEach((c, i) => (o[c] = i === k.length - 1 ? v.slice(i).join(',') : v[i])); return o; }); }

/* loader: minimum display time, fonts (max 2.5 s) and the model must all be ready, then the rain curtain falls */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function loaderRain() {
  const L = $('#loader'); if (!L) return;
  const s = L.querySelector('.l-strips'); let h = '', n = Math.max(10, Math.min(24, Math.round(innerWidth / 70)));
  for (let k = 0; k < n; k++) h += '<i></i>'; s.innerHTML = h;
  let r = ''; for (let k = 0; k < 36; k++) r += `<b style="left:${Math.random() * 100}%;animation-duration:${0.7 + Math.random() * 0.8}s;animation-delay:${-Math.random() * 2}s;height:${30 + Math.random() * 50}px"></b>`;
  L.querySelector('.l-rain').innerHTML = r;
}
function exitLoader() {
  const L = $('#loader'); if (!L) { armReveal(); return; }
  const strips = [...L.querySelectorAll('.l-strips i')];
  strips.forEach((el) => { el.style.transitionDelay = (Math.random() * 0.55).toFixed(2) + 's'; });
  L.querySelector('.l-bar i').style.width = '100%';
  setTimeout(() => { L.classList.add('out'); setTimeout(armReveal, 450); }, 250);
  setTimeout(() => { L.classList.add('gone'); document.documentElement.classList.remove('loading'); }, REDUCED ? 700 : 2100);
}
async function init() {
  loaderRain();
  let seen = false; try { seen = sessionStorage.getItem('fs_seen') === '1'; sessionStorage.setItem('fs_seen', '1'); } catch (e) { /* ignore */ }
  const minT = wait(REDUCED ? 300 : seen ? 700 : 1700), fonts = Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), wait(2500)]);
  try { await run(); } catch (e) { console.error(e); stale('Something failed while starting: ' + e.message); }
  await Promise.all([minT, fonts]); exitLoader();
}
function stale(msg) {
  const c = $('#console .wrap') || document.body;
  c.insertAdjacentHTML('afterbegin', '<div class="callout"><b>' + esc(msg) + '</b></div>');
}
async function run() {
  heroScene();
  try { bindUI(); } catch (e) { console.error(e); stale('The page script and index.html are out of sync (' + e.message + '). Re-copy every file from the latest version, then hard-refresh.'); }
  try {
    M = await (await fetch('data/model.json')).json();
    try { SRC = parseCSV(await (await fetch('data/sources.csv')).text()); } catch (e) { SRC = []; }
    try { COORDS = await (await fetch('data/coords.json')).json(); } catch (e) { COORDS = {}; }
  } catch (e) {
    stale('Could not load the model. Open this page through a web server (for example python3 -m http.server), not by double-clicking the file. ' + e.message); return;
  }
  LOCS = M.locations; LOCS.forEach((l) => (LOC[l.id] = l)); REPLAY = M.replay; EVENTS = M.events;
  $('#filterType').innerHTML = '<option value="all">All types</option>' + [...new Set(LOCS.map((l) => l.type))].sort().map((t) => `<option value="${t}">${TYPE_LABEL[t] || t}</option>`).join('');
  $('.presets').insertAdjacentHTML('beforeend', '<button id="btnLive" class="live" type="button">Use live forecast</button>');
  const sub = LOCS.find((l) => l.name === 'Subhash Chowk');
  S.places = [sub, ...[...LOCS].sort((a, b) => b.pos - a.pos)].filter(Boolean).filter((l, i, a) => a.indexOf(l) === i).slice(0, 2).map((l) => l.id);
  loadFromUrl();
  setRain(S.rain); renderScatter(); renderBacktest(); renderMethod(); renderLog(); buildSim(); paintSim(); render();
  floats(currentRows().length ? LOCS.map((l) => ({ loc: l, p: prob(l, 110), cls: klass(prob(l, 110)) })).sort((a, b) => b.p - a.p || b.loc.pos - a.loc.pos) : []);
  if (location.hash) setTimeout(() => { const t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }, 50);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
})();
