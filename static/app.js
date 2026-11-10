'use strict';
/* ChartLite front-end: chart (lightweight-charts v5) + Binance data + Python indicator scripts (backend) */
const LW = LightweightCharts;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const TFS = ['1s', '5s', '10s', '15s', '30s', '1m', '2m', '3m', '5m', '10m', '15m', '20m', '30m', '45m', '1h', '2h', '3h', '4h', '6h', '8h', '9h', '12h', '1d', '2d', '3d', '1w', '1M'];
const PIN_DEFAULT = ['1s', '5s', '15s', '30s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '3h', '4h', '6h', '9h', '12h', '1d', '1w', '1M'];
const NATIVE_TF = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']);
const UNIT_SEC = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, M: 2592000 };
// هر تایم‌فریم (حتی کاستوم) را به ثانیه تبدیل می‌کند
const TF_SEC = new Proxy({}, { get(_, k) { const m = /^(\d+)([smhdwM])$/.exec(String(k)); return m ? +m[1] * UNIT_SEC[m[2]] : undefined; } });
function normTf(n, unit) { // ورودی کاربر -> رشته‌ی نرمال یا خطا
  n = Math.floor(+n); const u = { sec: 1, min: 60, hour: 3600, day: 86400 }[unit];
  if (!(n >= 1) || !u) throw new Error('Enter a positive number.');
  const t = n * u;
  if (t > 30 * 86400) throw new Error('Maximum is 30 days.');
  if (t < 60) return t + 's';
  if (t % 60) throw new Error('Above 59 seconds the interval must be whole minutes.');
  if (t === 604800) return '1w';
  if (t % 86400 === 0) return (t / 86400) + 'd';
  if (t % 3600 === 0) return (t / 3600) + 'h';
  return (t / 60) + 'm';
}
const TF_LABEL = { '1d': 'D', '1w': 'W', '1M': 'M', '3d': '3D', '2d': '2D' };
const UP = '#26a69a', DN = '#f23645';
const PALETTE = ['#2962FF', '#FF6D00', '#00BCD4', '#E040FB', '#FDD835', '#26A69A', '#F23645'];
const LS_KEY = 'chartlite.v1';

/* ----------------------------------------------------------------- state */
const S = Object.assign({
  market: 'futures', symbol: 'BTCUSDT', tf: '1h', type: 'candles', log: false, vol: true, panel: true,
  pin: PIN_DEFAULT.slice(), customTfs: [], theme: 'dark', magnet: false, hideDraw: false, instances: [], fav: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ARBUSDT'], drawings: {}, firstRun: true,
}, (() => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } })());
const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };
const uid = () => Math.random().toString(36).slice(2, 9);

let bars = [];                 // {time(sec),open,high,low,close,volume}
let symbols = [];
let symInfo = { tick: 0.01 };
let prec = 2;
let allLoaded = false, loadingMore = false, loadGen = 0;
const RT = {};                 // instance id -> {res, series:[], prims:[], sig}
let library = [];
let editing = null;            // {id|null}

/* --------------------------------------------------------------- helpers */
async function api(path, opt) {
  const r = await fetch(path, opt);
  let j = {};
  try { j = await r.json(); } catch (e) { /* ignore */ }
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
const post = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const decimals = t => { const s = String(t); if (s.includes('e-')) return parseInt(s.split('e-')[1], 10); return (s.split('.')[1] || '').length; };
const guessTick = p => p >= 1000 ? 0.01 : p >= 100 ? 0.01 : p >= 10 ? 0.001 : p >= 1 ? 0.0001 : p >= 0.1 ? 0.00001 : p >= 0.01 ? 0.000001 : 0.0000001;
function fmt(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  const d = a >= 1000 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : a >= 0.1 ? 5 : a >= 0.001 ? 6 : 8;
  let s = v.toFixed(d);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
const fmtP = v => (v == null || !isFinite(v)) ? '—' : v.toFixed(prec);
const fmtVol = v => v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0);
const pad = n => String(n).padStart(2, '0');
function withAlpha(c, a) {
  const m = /^#([0-9a-f]{6})/i.exec(c || '');
  if (!m) return c || 'rgba(41,98,255,0.3)';
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
function toast(msg) {
  const d = document.createElement('div');
  d.className = 'toast'; d.textContent = msg;
  $('#toast').appendChild(d);
  setTimeout(() => d.remove(), 7000);
}
function setStatus(t, cls) { const e = $('#status'); e.textContent = t; e.className = 'status ' + (cls || ''); }
function logLine(text, cls) {
  const c = $('#console'); const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  c.appendChild(d); c.parentElement.scrollTop = c.parentElement.scrollHeight;
  while (c.childElementCount > 400) c.firstChild.remove();
}
function beep() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = 0.08;
    o.start(); setTimeout(() => { o.stop(); a.close(); }, 350);
  } catch (e) { /* ignore */ }
}
function notify(msg) {
  toast('🔔 ' + msg); beep(); logLine('ALERT: ' + msg, 'w');
  try { if (window.Notification && Notification.permission === 'granted') new Notification('ChartLite', { body: msg }); } catch (e) { /* ignore */ }
}
const tfLabel = tf => TF_LABEL[tf] || tf;

/* ------------------------------------------------------------------ chart */
const chart = LW.createChart($('#chart'), {
  autoSize: true,
  layout: { background: { type: 'solid', color: '#0e1117' }, textColor: '#b2b5be', fontSize: 12, panes: { separatorColor: '#2a2e39', separatorHoverColor: 'rgba(41,98,255,0.35)', enableResize: true } },
  grid: { vertLines: { color: '#151922' }, horzLines: { color: '#151922' } },
  crosshair: { mode: LW.CrosshairMode.Normal },
  rightPriceScale: { borderColor: '#2a2e39' },
  timeScale: {
    borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, rightOffset: 10, minBarSpacing: 0.3,
    tickMarkFormatter: (t, type) => {
      const d = new Date(t * 1000);
      if (type === 0) return String(d.getFullYear());
      if (type === 1) return d.toLocaleString('en', { month: 'short' });
      if (type === 2) return String(d.getDate());
      return pad(d.getHours()) + ':' + pad(d.getMinutes()) + (TF_SEC[S.tf] < 60 ? ':' + pad(d.getSeconds()) : '');
    },
  },
  localization: {
    timeFormatter: t => {
      const d = new Date(t * 1000);
      const ds = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
      return TF_SEC[S.tf] < 86400 ? `${ds} ${pad(d.getHours())}:${pad(d.getMinutes())}${TF_SEC[S.tf] < 60 ? ':' + pad(d.getSeconds()) : ''}` : ds;
    },
  },
});
let mainS = null, volS = null;
const owned = [];
const markerPlugs = [];

function haData() {
  const out = []; let po = null, pc = null;
  for (const b of bars) {
    const c = (b.open + b.high + b.low + b.close) / 4;
    const o = po == null ? (b.open + b.close) / 2 : (po + pc) / 2;
    out.push({ time: b.time, open: o, high: Math.max(b.high, o, c), low: Math.min(b.low, o, c), close: c });
    po = o; pc = c;
  }
  return out;
}
function barColors() {
  for (const inst of [...S.instances].reverse()) {
    const r = RT[inst.id] && RT[inst.id].res;
    if (inst.visible && r && r.ok && r.barcolor) return r.barcolor;
  }
  return null;
}
function mainPoints() {
  const t = S.type;
  if (t === 'line' || t === 'area') return bars.map(b => ({ time: b.time, value: b.close }));
  const base = t === 'ha' ? haData() : bars.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
  const bc = barColors();
  if (bc && t !== 'bars') base.forEach((p, i) => { if (bc[i]) { p.color = bc[i]; p.borderColor = bc[i]; p.wickColor = bc[i]; } });
  return base;
}
function updateMainLast() {
  const cur = bars[bars.length - 1];
  if (!mainS || !cur) return;
  if (S.type === 'ha' || barColors()) mainS.setData(mainPoints());
  else mainS.update(S.type === 'line' || S.type === 'area' ? { time: cur.time, value: cur.close } : { time: cur.time, open: cur.open, high: cur.high, low: cur.low, close: cur.close });
  if (volS) volS.update(volPoint(cur));
}
function createMain() {
  const pf = { type: 'price', precision: prec, minMove: symInfo.tick };
  const common = { priceFormat: pf, lastValueVisible: true, priceLineVisible: true };
  const t = S.type;
  if (t === 'candles' || t === 'ha') mainS = chart.addSeries(LW.CandlestickSeries, { ...common, upColor: UP, downColor: DN, borderVisible: false, wickUpColor: UP, wickDownColor: DN }, 0);
  else if (t === 'hollow') mainS = chart.addSeries(LW.CandlestickSeries, { ...common, upColor: 'rgba(0,0,0,0)', downColor: DN, borderVisible: true, borderUpColor: UP, borderDownColor: DN, wickUpColor: UP, wickDownColor: DN }, 0);
  else if (t === 'bars') mainS = chart.addSeries(LW.BarSeries, { ...common, upColor: UP, downColor: DN }, 0);
  else if (t === 'line') mainS = chart.addSeries(LW.LineSeries, { ...common, color: '#2962FF', lineWidth: 2 }, 0);
  else mainS = chart.addSeries(LW.AreaSeries, { ...common, lineColor: '#2962FF', topColor: 'rgba(41,98,255,0.35)', bottomColor: 'rgba(41,98,255,0)' }, 0);
  owned.push(mainS);
  mainS.setData(mainPoints());
  chart.priceScale('right', 0).applyOptions({ mode: S.log ? LW.PriceScaleMode.Logarithmic : LW.PriceScaleMode.Normal });
}
const volPoint = b => ({ time: b.time, value: b.volume, color: b.close >= b.open ? 'rgba(38,166,154,0.45)' : 'rgba(242,54,69,0.45)' });
function createVolume() {
  volS = null;
  if (!S.vol) return;
  volS = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false }, 0);
  volS.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  volS.setData(bars.map(volPoint));
  owned.push(volS);
}

/* ---------------------------------------------------------- fill primitive */
class FillPrim {
  constructor(a, b, color) { this.a = a; this.b = b; this.color = color; this._view = { zOrder: () => 'bottom', renderer: () => ({ draw: t => t.useBitmapCoordinateSpace(sc => this.paint(sc)) }) }; }
  attached(p) { this.chart = p.chart; this.series = p.series; this.req = p.requestUpdate; }
  detached() { this.chart = this.series = null; }
  setSides(a, b) { this.a = a; this.b = b; if (this.req) this.req(); }
  updateAllViews() { }
  paneViews() { return [this._view]; }
  val(side, i) { return side.arr ? side.arr[i] : side.c; }
  paint(sc) {
    if (!this.chart || !this.series) return;
    const ts = this.chart.timeScale(), r = ts.getVisibleLogicalRange();
    if (!r) return;
    const ctx = sc.context, hr = sc.horizontalPixelRatio, vr = sc.verticalPixelRatio;
    const len = Math.max(this.a.arr ? this.a.arr.length : 0, this.b.arr ? this.b.arr.length : 0, bars.length);
    const from = Math.max(0, Math.floor(r.from) - 1), to = Math.min(len - 1, Math.ceil(r.to) + 1);
    ctx.fillStyle = this.color;
    let seg = [];
    const flush = () => {
      if (seg.length > 1) {
        ctx.beginPath();
        seg.forEach((p, k) => k ? ctx.lineTo(p.x * hr, p.ya * vr) : ctx.moveTo(p.x * hr, p.ya * vr));
        for (let k = seg.length - 1; k >= 0; k--) ctx.lineTo(seg[k].x * hr, seg[k].yb * vr);
        ctx.closePath(); ctx.fill();
      }
      seg = [];
    };
    for (let i = from; i <= to; i++) {
      const a = this.val(this.a, i), b = this.val(this.b, i);
      const x = ts.logicalToCoordinate(i);
      const ya = a == null ? null : this.series.priceToCoordinate(a);
      const yb = b == null ? null : this.series.priceToCoordinate(b);
      if (x == null || ya == null || yb == null) flush(); else seg.push({ x, ya, yb });
    }
    flush();
  }
}

/* -------------------------------------------------------------- indicators */
function futureTimes(k) {
  const out = []; if (!bars.length) return out;
  const last = bars[bars.length - 1].time, st = TF_SEC[S.tf];
  for (let i = 1; i <= k; i++) out.push(last + i * st);
  return out;
}
function shiftArr(arr, off, len) {
  const out = new Array(len).fill(null);
  for (let i = 0; i < arr.length; i++) { const j = i + off; if (j >= 0 && j < len) out[j] = arr[i]; }
  return out;
}
const maxOff = r => Math.max(0, ...r.plots.map(p => p.offset || 0));
const CLEAR = 'rgba(0,0,0,0)';
// lightweight-charts خط را روی whitespace پیوسته می‌کشد؛ برای ایجاد "شکاف"، آخرین نقطه‌ی قبل از هر شکاف شفاف می‌شود
// (رنگ هر نقطه، رنگ قطعه‌ی خروجی از همان نقطه است).
function plotData(vals, colors, times, style) {
  const st = (style || 'line').toLowerCase();
  const gapTrick = st === 'line' || st === 'step' || st === 'stepline' || st === 'area';
  const d = new Array(times.length);
  for (let i = 0; i < times.length; i++) {
    const v = vals[i];
    if (v == null) { d[i] = { time: times[i] }; continue; }
    const pt = { time: times[i], value: v };
    if (colors && colors[i]) pt.color = colors[i];
    if (gapTrick && i + 1 < times.length && vals[i + 1] == null) {
      if (st === 'area') { pt.lineColor = CLEAR; pt.topColor = CLEAR; pt.bottomColor = CLEAR; } else pt.color = CLEAR;
    }
    d[i] = pt;
  }
  return d;
}
function createPlotSeries(p, pane, overlay, pi) {
  const color = p.color || PALETTE[pi % PALETTE.length];
  const base = { priceLineVisible: false, lastValueVisible: !overlay, crosshairMarkerVisible: false, title: '' };
  if (!overlay) base.priceFormat = { type: 'custom', formatter: fmt, minMove: 1e-8 };
  const st = (p.style || 'line').toLowerCase();
  if (st === 'histogram' || st === 'columns') return chart.addSeries(LW.HistogramSeries, { ...base, color, base: p.base || 0 }, pane);
  if (st === 'area') return chart.addSeries(LW.AreaSeries, { ...base, lineColor: color, topColor: withAlpha(color, 0.3), bottomColor: withAlpha(color, 0), lineWidth: p.width || 1 }, pane);
  const o = { ...base, color, lineWidth: Math.max(1, Math.min(4, Math.round(p.width || 1))) };
  if (st === 'circles' || st === 'cross') { o.lineVisible = false; o.pointMarkersVisible = true; o.pointMarkersRadius = st === 'cross' ? 3 : 2; }
  if (st === 'step' || st === 'stepline') o.lineType = LW.LineType.WithSteps;
  return chart.addSeries(LW.LineSeries, o, pane);
}
function structSig(r) {
  return JSON.stringify([r.overlay, r.plots.map(p => [p.title, p.style, p.hidden, p.offset, p.color]), r.hlines, r.markers.length, r.fills.length, !!(r.lines && r.lines.length), !!(r.labels && r.labels.length), !!(r.boxes && r.boxes.length), r.bgs.length, !!r.barcolor]);
}
function renderInst(inst, rt, paneNext, addMarkers) {
  const r = rt.res; rt.series = []; rt.prims = []; rt.eq = null;
  const overlay = !!r.overlay;
  const pane = overlay ? 0 : paneNext;
  if (!overlay) paneNext++;
  const n = bars.length;
  const times = bars.map(b => b.time).concat(futureTimes(maxOff(r)));
  let anchor = overlay ? mainS : null;
  const vals = {}, sers = {};
  r.plots.forEach((p, pi) => {
    const sv = shiftArr(p.values, p.offset || 0, times.length);
    const sc = p.colors ? shiftArr(p.colors, p.offset || 0, times.length) : null;
    vals[p.id] = sv;
    if (p.hidden) return;
    const s = createPlotSeries(p, pane, overlay, pi);
    s.setData(plotData(sv, sc, times, p.style));
    owned.push(s); sers[p.id] = s;
    rt.series.push({ series: s, plot: p, values: sv, colors: sc, times, color: p.color || PALETTE[pi % PALETTE.length] });
    if (!anchor) anchor = s;
  });
  if (!anchor) {
    anchor = chart.addSeries(LW.LineSeries, { color: 'rgba(0,0,0,0)', lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }, pane);
    owned.push(anchor);
  }
  const styleMap = { solid: 0, dotted: 1, dashed: 2 };
  r.hlines.forEach(h => anchor.createPriceLine({ price: h.price, color: h.color, lineWidth: h.width || 1, lineStyle: styleMap[h.style] ?? 2, axisLabelVisible: !overlay, title: '' }));
  const side = ref => {
    if (ref.kind === 'plot') return { arr: vals[ref.id] };
    if (ref.kind === 'hline') return { c: r.hlines[ref.id].price };
    return { c: ref.value };
  };
  if ((r.lines && r.lines.length) || (r.labels && r.labels.length) || (r.boxes && r.boxes.length)) { rt.shapes = new ShapesPrim(r); anchor.attachPrimitive(rt.shapes); } else rt.shapes = null;
  r.fills.forEach(f => { const pr = new FillPrim(side(f.a), side(f.b), f.color); anchor.attachPrimitive(pr); rt.prims.push({ pr, f, side }); rt.vals = vals; });
  r.bgs.forEach((cs, bi) => {
    const s = chart.addSeries(LW.HistogramSeries, { priceScaleId: 'bg' + inst.id + bi, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }) }, pane);
    s.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    s.setData(bars.map((b, i) => cs[i] ? { time: b.time, value: 1, color: cs[i] } : { time: b.time }));
    owned.push(s);
  });
  const mk = list => list.filter(m => bars[m.i]).map(m => ({ time: bars[m.i].time, position: m.position, shape: m.shape, color: m.color, text: m.text || '', size: m.size || 1 }));
  addMarkers(anchor, mk(r.markers));
  rt.sig = structSig(r);
  return paneNext;
}
function renderAll() {
  const vr = chart.timeScale().getVisibleLogicalRange();
  owned.splice(0).forEach(s => { try { chart.removeSeries(s); } catch (e) { /* ignore */ } });
  markerPlugs.length = 0;
  if (!bars.length) { refreshLegend(); return; }
  createMain(); createVolume();
  let paneNext = 1;
  const mm = new Map();
  const addMarkers = (s, list) => { if (!list.length) return; mm.set(s, (mm.get(s) || []).concat(list)); };
  for (const inst of S.instances) {
    const rt = RT[inst.id];
    if (!rt) continue;
    rt.series = []; rt.prims = [];
    if (!inst.visible || !rt.res || !rt.res.ok) continue;
    paneNext = renderInst(inst, rt, paneNext, addMarkers);
  }
  mm.forEach((list, s) => { list.sort((a, b) => a.time - b.time); markerPlugs.push(LW.createSeriesMarkers(s, list)); });
  const panes = chart.panes();
  if (panes.length > 1) { panes[0].setStretchFactor(3.2); panes.slice(1).forEach(p => p.setStretchFactor(1)); }
  if (vr) chart.timeScale().setVisibleLogicalRange(vr);
  refreshLegend(); drawAll();
}
function updateInPlace(inst) {
  // فقط داده‌ی plot ها را عوض می‌کند (ساختار ثابت است)
  const rt = RT[inst.id], r = rt.res;
  const n = bars.length;
  const times = bars.map(b => b.time).concat(futureTimes(maxOff(r)));
  const vals = {};
  let k = 0;
  r.plots.forEach(p => {
    const sv = shiftArr(p.values, p.offset || 0, times.length);
    const sc = p.colors ? shiftArr(p.colors, p.offset || 0, times.length) : null;
    vals[p.id] = sv;
    if (p.hidden) return;
    const item = rt.series[k++];
    item.series.setData(plotData(sv, sc, times, p.style));
    item.values = sv; item.colors = sc; item.times = times;
  });
  if (rt.shapes) { rt.shapes.r = r; if (rt.shapes.req) rt.shapes.req(); }
  (rt.prims || []).forEach(({ pr, f, side }) => {
    const sd = ref => ref.kind === 'plot' ? { arr: vals[ref.id] } : ref.kind === 'hline' ? { c: r.hlines[ref.id].price } : { c: ref.value };
    pr.setSides(sd(f.a), sd(f.b));
  });
  return n;
}

/* --------------------------------------------------------- script running */
const candlesPayload = () => bars.map(b => [b.time, b.open, b.high, b.low, b.close, b.volume]);
async function runInst(inst, payload) {
  const rt = RT[inst.id] || (RT[inst.id] = { series: [], prims: [] });
  try {
    const res = await post('/api/run', { code: inst.code, overrides: inst.overrides || {}, candles: payload || candlesPayload(), meta: { symbol: S.symbol, interval: S.tf, market: S.market, mintick: symInfo.tick } });
    rt.res = res;
    if (res.logs) res.logs.trim().split('\n').forEach(l => l && logLine(`[${inst.name}] ${l}`));
    if (!res.ok) logLine(`[${inst.name}] ERROR line ${res.error.line}: ${res.error.message}`, 'e');
  } catch (e) {
    rt.res = { ok: false, error: { message: e.message, line: null } };
    logLine(`[${inst.name}] ${e.message}`, 'e');
  }
  return rt.res;
}
const alertSeen = new Set();
function scriptAlerts(inst) {
  const r = RT[inst.id].res;
  if (!r || !r.ok || !bars.length) return;
  r.alerts.forEach(a => {
    const key = inst.id + a.message + bars[bars.length - 1].time;
    if (a.last && !alertSeen.has(key)) { alertSeen.add(key); notify(`${S.symbol} ${tfLabel(S.tf)}: ${a.message}`); }
  });
}
let recomputing = false, recomputeQueued = false;
async function recomputeAll(forceRender) {
  if (recomputing) { recomputeQueued = true; return; }
  recomputing = true;
  try {
    const payload = candlesPayload();
    const vis = S.instances.filter(i => i.visible);
    const old = Object.fromEntries(vis.map(i => [i.id, RT[i.id] && RT[i.id].sig]));
    await Promise.all(vis.map(i => runInst(i, payload)));
    let need = !!forceRender;
    for (const inst of vis) {
      const r = RT[inst.id].res;
      if (!r || !r.ok) { need = true; continue; }
      if (structSig(r) !== old[inst.id] || r.bgs.length || r.barcolor) need = true;
    }
    if (need) renderAll();
    else vis.forEach(i => updateInPlace(i));
    vis.forEach(scriptAlerts);
    renderActiveList(); showEditorError();
  } finally {
    recomputing = false;
    if (recomputeQueued) { recomputeQueued = false; setTimeout(() => recomputeAll(), 50); }
  }
}
let recTimer = null, lastRec = 0;
function scheduleRecompute() {
  if (recTimer) return;
  const wait = Math.max(0, 1500 - (Date.now() - lastRec));
  recTimer = setTimeout(() => { recTimer = null; lastRec = Date.now(); recomputeAll(); }, wait);
}

/* ------------------------------------------------------------------ legend */
function idxOf(t) {
  let lo = 0, hi = bars.length - 1;
  if (!bars.length) return -1;
  if (t >= bars[hi].time) return hi + Math.round((t - bars[hi].time) / TF_SEC[S.tf]);
  while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].time < t) lo = m + 1; else hi = m; }
  return lo;
}
let hoverT = null;
function refreshLegend() {
  const L = $('#legend');
  if (!bars.length) { L.innerHTML = ''; return; }
  const n = bars.length;
  let i = hoverT != null ? idxOf(hoverT) : n - 1;
  const hovering = hoverT != null && i >= 0 && i < n;
  if (!hovering) i = n - 1;
  const b = bars[i], prev = bars[i - 1] || b;
  const chg = b.close - prev.close, pct = prev.close ? chg / prev.close * 100 : 0, cls = chg >= 0 ? 'up' : 'down';
  let h = `<div class="lrow"><b>${S.symbol}</b> · ${tfLabel(S.tf)} · Binance ${S.market === 'futures' ? 'Perp' : 'Spot'}</div>`;
  h += `<div class="lrow ohlc ${cls}"><span>O ${fmtP(b.open)}</span><span>H ${fmtP(b.high)}</span><span>L ${fmtP(b.low)}</span><span>C ${fmtP(b.close)}</span><span>${chg >= 0 ? '+' : ''}${fmtP(chg)} (${pct.toFixed(2)}%)</span><span style="color:#787b86">Vol ${fmtVol(b.volume)}</span></div>`;
  for (const inst of S.instances) {
    const rt = RT[inst.id]; const r = rt && rt.res;
    const title = (r && r.ok && r.title) || inst.name;
    let vals = '';
    if (r && r.ok && inst.visible) {
      vals = rt.series.map(s => {
        const v = s.values ? s.values[i] : null;
        const c = (s.colors && s.colors[i]) || s.color;
        return `<span style="color:${c}">${v == null ? '' : fmt(v)}</span>`;
      }).join(' ');
    } else if (r && !r.ok) vals = `<span class="down">error</span>`;
    const params = r && r.ok && r.inputs.length ? ' (' + r.inputs.filter(x => x.type !== 'color').map(x => x.value).join(', ') + ')' : '';
    h += `<div class="lrow" data-id="${inst.id}" style="opacity:${inst.visible ? 1 : 0.45}"><span>${title}${params}</span>${vals}
      <span class="lbtn" data-act="vis">${inst.visible ? '👁' : '🚫'}</span><span class="lbtn" data-act="set">⚙</span><span class="lbtn" data-act="code">&lt;/&gt;</span><span class="lbtn" data-act="del">✕</span></div>`;
  }
  L.innerHTML = h;
}
$('#legend').addEventListener('click', e => {
  const act = e.target.dataset.act; if (!act) return;
  const id = e.target.closest('.lrow').dataset.id;
  instAction(id, act);
});
chart.subscribeCrosshairMove(p => { hoverT = p && p.time != null ? p.time : null; refreshLegend(); });

/* -------------------------------------------------------- instance actions */
async function addInstance(name, code, overrides) {
  const inst = { id: uid(), name, code, overrides: overrides || {}, visible: true };
  S.instances.push(inst); save();
  await runInst(inst);
  renderAll(); renderActiveList();
  return inst;
}
function instAction(id, act) {
  const inst = S.instances.find(i => i.id === id); if (!inst) return;
  if (act === 'vis') { inst.visible = !inst.visible; save(); if (inst.visible && !(RT[id] && RT[id].res)) recomputeAll(true); else renderAll(); renderActiveList(); }
  else if (act === 'del') { S.instances = S.instances.filter(i => i !== inst); delete RT[id]; save(); renderAll(); renderActiveList(); }
  else if (act === 'set') openSettings(inst);
  else if (act === 'code') openInEditor(inst);
}
function renderActiveList() {
  const box = $('#activeList');
  if (!S.instances.length) { box.innerHTML = '<div class="item muted">No indicators. Add from the library below.</div>'; return; }
  box.innerHTML = '';
  S.instances.forEach(inst => {
    const r = RT[inst.id] && RT[inst.id].res;
    const d = document.createElement('div'); d.className = 'item';
    d.innerHTML = `<span class="nm" title="${inst.name}">${inst.name}</span>${r && !r.ok ? '<span class="badge" style="color:#f23645">error</span>' : ''}
      <button class="ib" data-act="vis">${inst.visible ? '👁' : '🚫'}</button><button class="ib" data-act="set">⚙</button><button class="ib" data-act="code">&lt;/&gt;</button><button class="ib" data-act="del">✕</button>`;
    d.onclick = e => { const a = e.target.dataset.act; if (a) instAction(inst.id, a); };
    box.appendChild(d);
  });
}
function renderLibrary() {
  const f = $('#indFilter').value.toLowerCase();
  const box = $('#libList'); box.innerHTML = '';
  library.filter(s => s.name.toLowerCase().includes(f)).forEach(s => {
    const d = document.createElement('div'); d.className = 'item';
    d.innerHTML = `<span class="nm" title="Add to chart">${s.name}</span><span class="badge">${s.kind === 'user' ? 'mine' : 'built-in'}</span>
      <button class="ib" data-act="code" title="Open in editor">&lt;/&gt;</button>${s.kind === 'user' ? '<button class="ib" data-act="rm" title="Delete">✕</button>' : ''}`;
    d.onclick = async e => {
      const a = e.target.dataset.act;
      if (a === 'code') { openCode(s.name, s.code, null); return; }
      if (a === 'rm') { if (confirm('Delete script "' + s.name + '"?')) { await api('/api/scripts/' + encodeURIComponent(s.name), { method: 'DELETE' }); loadLibrary(); } return; }
      addInstance(s.name, s.code);
    };
    box.appendChild(d);
  });
}
async function loadLibrary() { try { library = await api('/api/scripts'); } catch (e) { library = []; } renderLibrary(); }
$('#indFilter').oninput = renderLibrary;

/* --------------------------------------------------------- settings modal */
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
function openSettings(inst) {
  const rt = RT[inst.id], r = rt && rt.res;
  const box = $('#modalBox');
  box.innerHTML = `<h3>${(r && r.title) || inst.name} — Settings</h3>`;
  if (!r || !r.ok || !r.inputs.length) box.innerHTML += '<div class="muted">This script has no inputs. Use <code>input("Name", default)</code> in the code.</div>';
  else r.inputs.forEach(inp => {
    const row = document.createElement('div'); row.className = 'field';
    row.innerHTML = `<label>${inp.title}</label>`;
    let el;
    if (inp.type === 'bool') { el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!inp.value; }
    else if (inp.type === 'select') { el = document.createElement('select'); inp.options.forEach(o => { const op = document.createElement('option'); op.value = o; op.textContent = o; el.appendChild(op); }); el.value = inp.value; }
    else if (inp.type === 'color') { el = document.createElement('input'); el.type = 'color'; el.value = inp.value; }
    else if (inp.type === 'string') { el = document.createElement('input'); el.type = 'text'; el.value = inp.value; }
    else { el = document.createElement('input'); el.type = 'number'; el.value = inp.value; if (inp.min != null) el.min = inp.min; if (inp.max != null) el.max = inp.max; el.step = inp.step != null ? inp.step : (inp.type === 'int' ? 1 : 'any'); }
    let t = null;
    const onch = () => {
      const v = inp.type === 'bool' ? el.checked : (inp.type === 'int' || inp.type === 'float') ? parseFloat(el.value) : el.value;
      if ((inp.type === 'int' || inp.type === 'float') && isNaN(v)) return;
      inst.overrides = inst.overrides || {}; inst.overrides[inp.key] = v; save();
      clearTimeout(t); t = setTimeout(async () => { await runInst(inst); renderAll(); renderActiveList(); }, 350);
    };
    el.addEventListener('input', onch); el.addEventListener('change', onch);
    row.appendChild(el); box.appendChild(row);
  });
  const foot = document.createElement('div'); foot.className = 'row'; foot.style.justifyContent = 'flex-end';
  foot.innerHTML = '<button class="btn" id="mReset">Reset defaults</button><button class="btn primary" id="mClose">Close</button>';
  box.appendChild(foot);
  $('#mClose').onclick = closeModal;
  $('#mReset').onclick = async () => { inst.overrides = {}; save(); await runInst(inst); renderAll(); renderActiveList(); openSettings(inst); };
  $('#modal').classList.remove('hidden');
}

/* ------------------------------------------------------------ code editor */
const NEW_TEMPLATE = `indicator("My Indicator", overlay=True)

length = input("Length", 20, min=1)
ma = ta.sma(df.close, length)
plot(ma, "MA", color=color.orange, width=2)
`;
function openCode(name, code, instId) {
  editing = { id: instId };
  $('#scName').value = name; $('#editor').value = code;
  $('#scInfo').textContent = instId ? 'editing script on chart' : 'new instance';
  showTab('code'); showEditorError();
}
function openInEditor(inst) { openCode(inst.name, inst.code, inst.id); }
function showEditorError() {
  const box = $('#editorErr');
  const inst = editing && editing.id && S.instances.find(i => i.id === editing.id);
  const r = inst && RT[inst.id] && RT[inst.id].res;
  box.textContent = r && !r.ok ? `Line ${r.error.line}: ${r.error.message}` : '';
}
async function runEditor() {
  const code = $('#editor').value, name = $('#scName').value.trim() || 'Untitled';
  if (editing && editing.id) {
    const inst = S.instances.find(i => i.id === editing.id);
    if (inst) { inst.code = code; inst.name = name; inst.overrides = inst.overrides || {}; save(); await runInst(inst); renderAll(); renderActiveList(); showEditorError(); return; }
  }
  const inst = await addInstance(name, code);
  editing = { id: inst.id }; $('#scInfo').textContent = 'editing script on chart'; showEditorError();
}
$('#scRun').onclick = runEditor;
$('#editor').addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; t.setRangeText('    ', s, t.selectionEnd, 'end'); }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runEditor(); }
});
$('#scNew').onclick = () => openCode('My Indicator', NEW_TEMPLATE, null);
$('#scSave').onclick = async () => {
  const name = $('#scName').value.trim().replace(/[^\w\- ]+/g, '');
  if (!name) { toast('Enter a script name first'); return; }
  await post('/api/scripts/' + encodeURIComponent(name), { code: $('#editor').value });
  toast('Saved to my_scripts/' + name + '.py'); loadLibrary();
};

/* ------------------------------------------------------------------ tabs */
function showTab(name) {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $$('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + name));
  if (name === 'watch') loadWatch();
}
$$('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
$('#panelBtn').onclick = () => { S.panel = !S.panel; $('#panel').classList.toggle('hidden', !S.panel); $('#panelBtn').classList.toggle('on', S.panel); save(); };
$('#clrLog').onclick = () => { $('#console').innerHTML = ''; };

/* -------------------------------------------------------------- watchlist */
let watchData = [], watchTimer = null;
async function loadWatch() {
  clearTimeout(watchTimer);
  if (!$('#tab-watch').classList.contains('on')) return;
  try { watchData = await api('/api/tickers?market=' + S.market); renderWatch(); } catch (e) { $('#watchList').innerHTML = `<div class="err" style="padding:8px">${e.message}</div>`; }
  watchTimer = setTimeout(loadWatch, 10000);
}
function renderWatch() {
  const by = Object.fromEntries(watchData.map(d => [d.symbol, d]));
  const favs = S.fav.filter(s => by[s]);
  const top = watchData.filter(d => !S.fav.includes(d.symbol)).sort((a, b) => b.qvol - a.qvol).slice(0, 30);
  const row = d => `<div class="wl" data-s="${d.symbol}"><span class="star ${S.fav.includes(d.symbol) ? 'on' : ''}" data-star="1">★</span><span>${d.symbol}</span><span>${fmt(d.price)}</span><span class="${d.change >= 0 ? 'up' : 'down'}">${d.change.toFixed(2)}%</span></div>`;
  $('#watchList').innerHTML = '<div class="sect">Favorites</div>' + favs.map(s => row(by[s])).join('') + '<div class="sect">Top by volume (24h)</div>' + top.map(row).join('');
}
$('#watchList').addEventListener('click', e => {
  const w = e.target.closest('.wl'); if (!w) return;
  const s = w.dataset.s;
  if (e.target.dataset.star) { S.fav = S.fav.includes(s) ? S.fav.filter(x => x !== s) : S.fav.concat(s); save(); renderWatch(); return; }
  setSymbol(s);
});


/* ------------------------------------------------------------ live data */
let ws = null, liveGen = 0, pollT = null;
function stopLive() {
  liveGen++; stopTrades();
  if (ws) { ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close(); } catch (e) { /* ignore */ } ws = null; }
  clearInterval(pollT);
}
function startLive() {
  stopLive();
  const gen = liveGen;
  if (isSec(S.tf)) { startTrades(gen, () => startPolling(gen)); return; }
  if (!NATIVE_TF.has(S.tf)) { startPolling(gen); return; }
  const stream = `${S.symbol.toLowerCase()}@kline_${S.tf}`;
  const urls = S.market === 'futures'
    ? [`wss://fstream.binance.com/market/ws/${stream}`, `wss://fstream.binance.com/ws/${stream}`]
    : [`wss://stream.binance.com:9443/ws/${stream}`, `wss://data-stream.binance.vision/ws/${stream}`];
  let k = 0;
  const tryNext = () => {
    if (gen !== liveGen) return;
    if (k >= urls.length) { startPolling(gen); return; }
    let got = false, w;
    try { w = new WebSocket(urls[k++]); } catch (e) { tryNext(); return; }
    ws = w;
    const to = setTimeout(() => { if (!got && gen === liveGen) { w.onclose = null; try { w.close(); } catch (e) { /* ignore */ } tryNext(); } }, 7000);
    w.onmessage = ev => {
      if (gen !== liveGen) return;
      if (!got) { got = true; clearTimeout(to); setStatus('● live', 'live'); }
      try { const m = JSON.parse(ev.data); const kk = m.k || (m.data && m.data.k); if (kk) onKline({ time: Math.floor(kk.t / 1000), open: +kk.o, high: +kk.h, low: +kk.l, close: +kk.c, volume: +kk.v }); } catch (e) { /* ignore */ }
    };
    w.onclose = () => { clearTimeout(to); if (gen !== liveGen) return; if (got) { setStatus('reconnecting…'); setTimeout(() => { if (gen === liveGen) startLive(); }, 2000); } else tryNext(); };
  };
  tryNext();
}
function startPolling(gen) {
  setStatus('◐ polling (3s)', 'live');
  const tick = async () => {
    if (gen !== liveGen) return;
    try {
      const j = await api(`/api/klines?market=${S.market}&symbol=${S.symbol}&interval=${S.tf}&limit=2`);
      if (gen !== liveGen) return;
      j.candles.forEach(c => onKline({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
    } catch (e) { setStatus('offline: ' + e.message, 'err'); }
  };
  pollT = setInterval(tick, 3000); tick();
}
function onKline(c) {
  const last = bars[bars.length - 1];
  if (!last || c.time < last.time) return;
  if (c.time === last.time) Object.assign(last, c); else bars.push(c);
  const cur = bars[bars.length - 1];
  updateMainLast();
  updatePriceBox(); refreshLegend();
  if (S.instances.some(i => i.visible)) scheduleRecompute();
}
function updatePriceBox() {
  if (!bars.length) return;
  const b = bars[bars.length - 1], p = bars[bars.length - 2] || b;
  const pct = (b.close - p.close) / p.close * 100;
  $('#lastPrice').textContent = fmtP(b.close);
  $('#lastPrice').className = b.close >= p.close ? 'up' : 'down';
  $('#lastChg').textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
  $('#lastChg').className = pct >= 0 ? 'up' : 'down';
  document.title = `${fmtP(b.close)} ${S.symbol} · ChartLite`;
}

/* ------------------------------------------------------------ data loading */
const toBar = c => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] });
const PAGE = () => (isSec(S.tf) || !NATIVE_TF.has(S.tf)) ? 1000 : 1500;
async function loadSymbol() {
  try { chart.priceScale('right', 0).applyOptions({ autoScale: true }); } catch (e) { /* ignore */ }
  const gen = ++loadGen;
  stopLive(); setStatus('loading…');
  try {
    const j = await api(`/api/klines?market=${S.market}&symbol=${S.symbol}&interval=${S.tf}&limit=${PAGE()}`);
    if (gen !== loadGen) return;
    bars = j.candles.map(toBar);
    allLoaded = bars.length < PAGE() || (isSec(S.tf) && S.market === 'futures');
    const si = symbols.find(s => s.symbol === S.symbol);
    symInfo = { tick: si ? si.tick : guessTick(bars.length ? bars[bars.length - 1].close : 1) };
    prec = decimals(symInfo.tick);
    await recomputeAll(true);
    const n = bars.length;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(-5, n - 160), to: n + 12 });
    updatePriceBox(); renderActiveList(); drawAll();
    try { chart.timeScale().applyOptions({ secondsVisible: isSec(S.tf) }); } catch (e) { /* ignore */ }
    startLive();
  } catch (e) {
    if (gen !== loadGen) return;
    setStatus('error: ' + e.message, 'err'); logLine('Load failed: ' + e.message, 'e');
    toast('Cannot load data from Binance: ' + e.message + '\n(set a proxy in config.json if needed)');
  }
}
async function loadMore() {
  if (loadingMore || allLoaded || !bars.length) return;
  loadingMore = true;
  const gen = loadGen;
  try {
    const j = await api(`/api/klines?market=${S.market}&symbol=${S.symbol}&interval=${S.tf}&limit=${PAGE()}&endTime=${bars[0].time * 1000 - 1}`);
    if (gen !== loadGen) return;
    if (j.candles.length < PAGE() - 5) allLoaded = true;
    if (j.candles.length) {
      const range = chart.timeScale().getVisibleLogicalRange();
      bars = j.candles.map(toBar).concat(bars);
      const add = j.candles.length;
      await recomputeAll(true);
      if (range) chart.timeScale().setVisibleLogicalRange({ from: range.from + add, to: range.to + add });
    }
  } catch (e) { logLine('Load more failed: ' + e.message, 'e'); } finally { loadingMore = false; }
}
chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r && r.from < 20) loadMore(); });

async function loadSymbols() {
  try {
    symbols = await api('/api/symbols?market=' + S.market);
    const si = symbols.find(s => s.symbol === S.symbol);
    if (si && si.tick !== symInfo.tick) { symInfo.tick = si.tick; prec = decimals(si.tick); }
  } catch (e) { logLine('Symbols: ' + e.message, 'e'); }
}
function setSymbol(sym) {
  sym = sym.trim().toUpperCase(); if (!sym) return;
  S.symbol = sym; $('#symInput').value = sym; save(); loadSymbol();
}
$('#symInput').addEventListener('click', () => openSymModal());
$('#symInput').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSymModal(); } });
$('#marketSel').onchange = async e => {
  S.market = e.target.value; save(); await loadSymbols();
  if (!symbols.some(s => s.symbol === S.symbol)) { S.symbol = 'BTCUSDT'; $('#symInput').value = S.symbol; }
  loadSymbol();
};
const allTfs = () => TFS.concat((S.customTfs || []).filter(t => !TFS.includes(t))).sort((a, b) => TF_SEC[a] - TF_SEC[b]);
function pickTf(tf) { S.tf = tf; save(); buildTfBar(); closeTfPop(); loadSymbol(); }
function buildTfBar() {
  const box = $('#tfBar'); box.innerHTML = '';
  const shown = allTfs().filter(t => S.pin.includes(t) || t === S.tf);
  shown.forEach(tf => {
    const b = document.createElement('button'); b.className = 'tfb' + (tf === S.tf ? ' on' : ''); b.textContent = tfLabel(tf);
    b.onclick = () => pickTf(tf);
    box.appendChild(b);
  });
  const more = document.createElement('button'); more.className = 'tfb'; more.id = 'tfMore'; more.textContent = '⋯'; more.title = 'All timeframes / custom timeframe';
  more.onclick = e => { e.stopPropagation(); toggleTfPop(); };
  box.appendChild(more);
}
function closeTfPop() { const p = $('#tfPop'); if (p) p.remove(); }
function toggleTfPop() {
  if ($('#tfPop')) { closeTfPop(); return; }
  const pop = document.createElement('div'); pop.id = 'tfPop';
  const r = $('#tfMore').getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - 330)) + 'px'; pop.style.top = (r.bottom + 6) + 'px';
  pop.onclick = e => e.stopPropagation();
  const draw = () => {
    const chips = allTfs().map(t => {
      const custom = !TFS.includes(t), pinned = S.pin.includes(t);
      return `<span class="chip${t === S.tf ? ' on' : ''}" data-tf="${t}"><span data-pick>${tfLabel(t)}</span><i data-pin title="${pinned ? 'Unpin from bar' : 'Pin to bar'}">${pinned ? '★' : '☆'}</i>${custom ? '<i data-del title="Remove custom">✕</i>' : ''}</span>`;
    }).join('');
    pop.innerHTML = `<div class="ptitle">Custom timeframe</div>
      <div class="prow"><input id="ctN" type="number" min="1" value="${pop._n || 4}" style="width:70px"><select id="ctU"><option value="sec">seconds</option><option value="min">minutes</option><option value="hour" selected>hours</option><option value="day">days</option></select><button class="btn primary" id="ctGo">Apply</button></div>
      <div class="muted" id="ctErr" style="min-height:16px;font-size:11px"></div>
      <div class="ptitle">All timeframes <small>(★ = show in bar)</small></div><div class="chips">${chips}</div>
      <div class="muted" style="font-size:11px;margin-top:6px">Non-native timeframes (3h, 9h, 45m…) are built from the nearest Binance interval. Under 1m uses trades (spot: 1s history).</div>`;
  };
  draw(); document.body.appendChild(pop);
  const q = sel => pop.querySelector(sel);
  const apply = () => {
    try {
      const tf = normTf(q('#ctN').value, q('#ctU').value);
      if (!TFS.includes(tf) && !S.customTfs.includes(tf)) S.customTfs.push(tf);
      if (!S.pin.includes(tf)) S.pin.push(tf);
      pickTf(tf);
    } catch (e) { q('#ctErr').textContent = '⚠ ' + e.message; q('#ctErr').style.color = '#f23645'; }
  };
  pop.addEventListener('click', e => {
    const chip = e.target.closest('.chip'), tf = chip && chip.dataset.tf;
    if (e.target.id === 'ctGo') { apply(); return; }
    if (!chip) return;
    if (e.target.dataset.pin !== undefined) { S.pin = S.pin.includes(tf) ? S.pin.filter(x => x !== tf) : S.pin.concat(tf); save(); const n = q('#ctN').value, u = q('#ctU').value; draw(); q('#ctN').value = n; q('#ctU').value = u; buildTfBar(); document.querySelector('#tfPop') || document.body.appendChild(pop); return; }
    if (e.target.dataset.del !== undefined) { S.customTfs = S.customTfs.filter(x => x !== tf); S.pin = S.pin.filter(x => x !== tf); if (S.tf === tf) { S.tf = '1h'; loadSymbol(); } save(); draw(); buildTfBar(); return; }
    pickTf(tf);
  });
  pop.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
}
document.addEventListener('click', e => { const p = $('#tfPop'); if (p && !p.contains(e.target) && e.target.id !== 'tfMore') closeTfPop(); });
$('#typeSel').onchange = e => { S.type = e.target.value; save(); renderAll(); };
$('#logBtn').onclick = () => { S.log = !S.log; $('#logBtn').classList.toggle('on', S.log); save(); if (mainS) chart.priceScale('right', 0).applyOptions({ mode: S.log ? LW.PriceScaleMode.Logarithmic : LW.PriceScaleMode.Normal }); };
$('#volBtn').onclick = () => { S.vol = !S.vol; $('#volBtn').classList.toggle('on', S.vol); save(); renderAll(); };
$('#fitBtn').onclick = () => { const n = bars.length; chart.timeScale().setVisibleLogicalRange({ from: Math.max(-5, n - 160), to: n + 12 }); chart.priceScale('right', 0).applyOptions({ autoScale: true }); };
$('#shotBtn').onclick = () => {
  const cv = chart.takeScreenshot();
  const ctx = cv.getContext('2d'); try { ctx.drawImage(dc, 0, 0, cv.width, cv.height); } catch (e) { /* ignore */ }
  cv.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${S.symbol}_${S.tf}.png`; a.click(); });
};

/* ------------------------------------------------------------------ theme */
const THEMES = {
  dark: { bg: '#0e1117', txt: '#b2b5be', grid: '#151922', border: '#2a2e39' },
  light: { bg: '#ffffff', txt: '#131722', grid: '#eef0f5', border: '#d6dae3' },
};
function applyTheme() {
  const t = THEMES[S.theme] || THEMES.dark;
  document.body.classList.toggle('light', S.theme === 'light');
  chart.applyOptions({
    layout: { background: { type: 'solid', color: t.bg }, textColor: t.txt, panes: { separatorColor: t.border } },
    grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
    rightPriceScale: { borderColor: t.border }, timeScale: { borderColor: t.border },
  });
  $('#themeBtn').textContent = S.theme === 'light' ? '🌙' : '☀';
  drawAll();
}
$('#themeBtn').onclick = () => { S.theme = S.theme === 'light' ? 'dark' : 'light'; save(); applyTheme(); };

/* --------------------------------------------------------------- drawings */
const dc = $('#draw'), dctx = dc.getContext('2d'), wrap = $('#chartWrap');
let tool = 'cursor', draft = null, sel = null, drag = null, measure = null, lastSig = '';
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COL = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#26a69a', '#00bcd4', '#787b86'];
const dkey = () => S.market + ':' + S.symbol;
const drawings = () => S.drawings[dkey()] || (S.drawings[dkey()] = []);
const defColor = () => S.theme === 'light' ? '#2962ff' : '#ffd54f';
const stepSec = () => TF_SEC[S.tf];
const areaW = () => chart.timeScale().width();
const paneH = () => { const p = chart.panes(); return p.length ? p[0].getHeight() : wrap.clientHeight; };
function timeToLogical(t) {
  const n = bars.length; if (!n) return 0;
  if (t >= bars[n - 1].time) return n - 1 + (t - bars[n - 1].time) / stepSec();
  if (t <= bars[0].time) return (t - bars[0].time) / stepSec();
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (bars[m].time <= t) lo = m; else hi = m; }
  return lo + (t - bars[lo].time) / ((bars[hi].time - bars[lo].time) || 1);
}
function logicalToTime(l) {
  const n = bars.length;
  if (l >= n - 1) return bars[n - 1].time + (l - (n - 1)) * stepSec();
  if (l <= 0) return bars[0].time + l * stepSec();
  const i = Math.floor(l);
  return bars[i].time + (l - i) * (bars[i + 1].time - bars[i].time);
}
const toXY = p => { if (!mainS || !p) return null; const x = chart.timeScale().logicalToCoordinate(timeToLogical(p.t)), y = mainS.priceToCoordinate(p.p); return x == null || y == null ? null : { x, y }; };
function pointAt(x, y, snap) {
  if (!mainS || !bars.length) return null;
  const l = chart.timeScale().coordinateToLogical(x); let p = mainS.coordinateToPrice(y);
  if (l == null || p == null) return null;
  let t = logicalToTime(l);
  if (snap && S.magnet) {
    const b = bars[Math.round(l)];
    if (b) {
      let best = null, bd = 20;
      [b.open, b.high, b.low, b.close].forEach(v => { const yy = mainS.priceToCoordinate(v); if (yy != null && Math.abs(yy - y) < bd) { bd = Math.abs(yy - y); best = v; } });
      if (best != null) { p = best; t = b.time; }
    }
  }
  return { t, p };
}
const localXY = e => { const r = wrap.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
function sizeCanvas() {
  const w = wrap.clientWidth, h = wrap.clientHeight, r = window.devicePixelRatio || 1;
  if (dc.width !== Math.round(w * r) || dc.height !== Math.round(h * r)) { dc.width = Math.round(w * r); dc.height = Math.round(h * r); dc.style.width = w + 'px'; dc.style.height = h + 'px'; }
  dctx.setTransform(r, 0, 0, r, 0, 0);
  return { w, h };
}
function rayEnd(a, b, W) {
  if (b.x === a.x) return { x: b.x, y: b.y > a.y ? 5000 : -5000 };
  const k = (b.y - a.y) / (b.x - a.x), x = b.x > a.x ? W + 80 : -80;
  return { x, y: a.y + k * (x - a.x) };
}
function handlePts(d) {
  const a = toXY(d.p1), b = d.p2 ? toXY(d.p2) : null, W = areaW();
  if (!a) return [];
  if (d.type === 'hline') return [{ k: 'p1', x: Math.max(14, Math.min(W - 14, a.x)), y: a.y }];
  if (d.type === 'vline') return [{ k: 'p1', x: a.x, y: paneH() / 2 }];
  if (d.type === 'text') return [{ k: 'p1', x: a.x, y: a.y }];
  return b ? [{ k: 'p1', x: a.x, y: a.y }, { k: 'p2', x: b.x, y: b.y }] : [];
}
function drawShape(d, selected, preview) {
  const c = dctx, col = d.color || defColor(), W = areaW(), a = toXY(d.p1), b = d.p2 ? toXY(d.p2) : null;
  c.lineWidth = d.w || 2; c.strokeStyle = col; c.fillStyle = col; c.font = '12px sans-serif'; c.setLineDash(dashOf(d.style));
  if (d.type === 'hline') { if (a) { c.beginPath(); c.moveTo(0, a.y); c.lineTo(W, a.y); c.stroke(); c.fillText(fmtP(d.p1.p), W - 72, a.y - 4); } }
  else if (d.type === 'vline') { if (a) { c.beginPath(); c.moveTo(a.x, 0); c.lineTo(a.x, 5000); c.stroke(); } }
  else if (d.type === 'text') { if (a) { c.font = '14px sans-serif'; c.fillText(d.text || '', a.x, a.y); } }
  else if (a && b) {
    if (d.type === 'trend' || d.type === 'ray') {
      const e = d.type === 'ray' ? rayEnd(a, b, W) : b;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(e.x, e.y); c.stroke();
    } else if (d.type === 'rect') {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      c.globalAlpha = 0.12; c.fillRect(x, y, w, h); c.globalAlpha = 1; c.strokeRect(x, y, w, h);
    } else if (d.type === 'fib') {
      const x1 = Math.min(a.x, b.x), x2 = Math.max(Math.max(a.x, b.x), x1 + 90);
      c.setLineDash([4, 3]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
      FIB.forEach((lv, k) => {
        const price = d.p2.p + (d.p1.p - d.p2.p) * lv, y = mainS.priceToCoordinate(price); if (y == null) return;
        c.lineWidth = 1; c.strokeStyle = FIB_COL[k]; c.fillStyle = FIB_COL[k];
        c.beginPath(); c.moveTo(x1, y); c.lineTo(x2, y); c.stroke(); c.fillText(`${lv}  (${fmtP(price)})`, x1 + 4, y - 3);
      });
    } else if (d.type === 'measure') {
      c.setLineDash([4, 3]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
      const dp = d.p2.p - d.p1.p, pct = dp / d.p1.p * 100, nb = Math.round(timeToLogical(d.p2.t) - timeToLogical(d.p1.t));
      const txt = `${dp >= 0 ? '+' : ''}${fmtP(dp)} (${pct.toFixed(2)}%)  ${nb} bars`;
      c.fillStyle = dp >= 0 ? UP : DN; c.fillRect(b.x + 6, b.y - 16, c.measureText(txt).width + 10, 18);
      c.fillStyle = '#fff'; c.fillText(txt, b.x + 11, b.y - 3);
    }
  }
  if (selected) {
    handlePts(d).forEach(h => {
      c.setLineDash([]); c.lineWidth = 2; c.strokeStyle = col; c.fillStyle = S.theme === 'light' ? '#fff' : '#0e1117';
      c.beginPath(); c.arc(h.x, h.y, 5, 0, 7); c.fill(); c.stroke();
    });
  }
}
function drawAll() {
  const { w, h } = sizeCanvas();
  dctx.clearRect(0, 0, w, h);
  if (!mainS || !bars.length) return;
  dctx.save(); dctx.beginPath(); dctx.rect(0, 0, areaW(), paneH()); dctx.clip();
  if (!S.hideDraw) drawings().forEach(d => { if (visibleOn(d)) drawShape(d, d === sel); });
  if (draft && draft.p2) drawShape(draft, false, true);
  if (measure) drawShape(measure, false);
  dctx.restore();
}
(function loop() {
  try {
    if (mainS && bars.length) {
      const vr = chart.timeScale().getVisibleLogicalRange();
      const sig = [vr && vr.from, vr && vr.to, mainS.priceToCoordinate(1), mainS.priceToCoordinate(1000), wrap.clientWidth, wrap.clientHeight].join('|');
      if (sig !== lastSig) { lastSig = sig; drawAll(); }
    }
  } catch (e) { /* ignore */ }
  requestAnimationFrame(loop);
})();

function distSeg(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
function hitBody(d, x, y) {
  const a = toXY(d.p1), b = d.p2 ? toXY(d.p2) : null, W = areaW(); if (!a) return false;
  if (d.type === 'hline') return Math.abs(y - a.y) < 7;
  if (d.type === 'vline') return Math.abs(x - a.x) < 7;
  if (d.type === 'text') return x >= a.x - 4 && x <= a.x + 12 + (d.text || '').length * 8 && Math.abs(y - a.y + 5) < 12;
  if (!b) return false;
  if (d.type === 'trend') return distSeg(x, y, a, b) < 7;
  if (d.type === 'ray') return distSeg(x, y, a, rayEnd(a, b, W)) < 7;
  if (d.type === 'rect') { const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y); return x >= x1 - 6 && x <= x2 + 6 && y >= y1 - 6 && y <= y2 + 6; }
  if (d.type === 'fib') { const x1 = Math.min(a.x, b.x), x2 = Math.max(Math.max(a.x, b.x), x1 + 90); return x >= x1 - 6 && x <= x2 + 6 && (FIB.some(lv => { const yy = mainS.priceToCoordinate(d.p2.p + (d.p1.p - d.p2.p) * lv); return yy != null && Math.abs(y - yy) < 6; }) || distSeg(x, y, a, b) < 7); }
  return false;
}
function hitTest(x, y) {
  if (S.hideDraw) return null;
  if (sel) { const h = handlePts(sel).find(p => Math.hypot(p.x - x, p.y - y) < 10); if (h) return { d: sel, part: h.k }; }
  const L = drawings();
  for (let i = L.length - 1; i >= 0; i--) if (visibleOn(L[i]) && hitBody(L[i], x, y)) return { d: L[i], part: 'body' };
  return null;
}

/* انتخاب / جابه‌جایی / ویرایش: قبل از چارت (capture) می‌گیریم تا وقتی روی یک رسم کلیک شد، چارت pan نشود */
wrap.addEventListener('mousedown', e => {
  if (e.button !== 0 || tool !== 'cursor' || e.target.closest('#legend,#dtool,#toast')) return;
  const { x, y } = localXY(e);
  if (x > areaW() || y > paneH()) return;
  const h = hitTest(x, y);
  if (!h) { if (sel) { sel = null; updateDTool(); drawAll(); } return; }
  e.stopPropagation(); e.preventDefault();
  sel = h.d; drag = { part: h.part, sx: x, sy: y, orig: JSON.parse(JSON.stringify(h.d)) };
  updateDTool(); drawAll();
}, true);
window.addEventListener('mousemove', e => {
  if (!drag || !sel) return;
  const { x, y } = localXY(e), o = drag.orig;
  if (drag.part === 'p1' || drag.part === 'p2') { const p = pointAt(x, y, true); if (p) sel[drag.part] = p; }
  else {
    const dx = x - drag.sx, dy = y - drag.sy;
    ['p1', 'p2'].forEach(k => { if (!o[k]) return; const q = toXY(o[k]); if (!q) return; const np = pointAt(q.x + dx, q.y + dy, false); if (np) sel[k] = np; });
  }
  drawAll();
});
window.addEventListener('mouseup', () => { if (drag) { drag = null; save(); } });

/* ساخت رسم جدید */
chart.subscribeCrosshairMove(p => { if (draft && p && p.point) { draft.p2 = pointAt(p.point.x, p.point.y, true); drawAll(); } });
// کلیک را خودمان از DOM می‌گیریم (subscribeClick چارت کلیک دوم در <۵۰۰ms را نادیده می‌گیرد)
let downPos = null;
wrap.addEventListener('mousedown', e => { downPos = { x: e.clientX, y: e.clientY }; }, true);
wrap.addEventListener('click', e => {
  if (e.target.closest('#legend,#dtool,#toast')) return;
  if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 5) return;
  const { x, y } = localXY(e);
  onChartClick(x, y);
});
function onChartClick(x, y) {
  if (tool === 'cursor') return;
  if (y > paneH() || x > areaW()) return;
  const p = pointAt(x, y, tool !== 'eraser');
  if (!p) return;
  if (tool === 'eraser') {
    const L = drawings(); for (let i = L.length - 1; i >= 0; i--) if (hitBody(L[i], x, y)) { if (sel === L[i]) sel = null; L.splice(i, 1); save(); break; }
    drawAll(); return;
  }
  const finish = d => { drawings().push(d); sel = d; save(); setTool('cursor'); updateDTool(); };
  if (tool === 'hline' || tool === 'vline') { finish({ type: tool, p1: p, color: defColor(), w: 2 }); return; }
  if (tool === 'text') { const t = prompt('Text:'); if (t) finish({ type: 'text', p1: p, text: t, color: defColor(), w: 2 }); else setTool('cursor'); return; }
  if (!draft) { measure = null; draft = { type: tool, p1: p, p2: null, color: tool === 'measure' ? '#2962ff' : defColor(), w: 2 }; return; }
  draft.p2 = p;
  if (draft.type === 'measure') { measure = draft; draft = null; drawAll(); return; }
  const d = draft; draft = null; finish(d);
}
function setTool(t) {
  tool = t; draft = null; if (t !== 'measure') measure = null;
  if (t !== 'cursor') { sel = null; updateDTool(); }
  $$('.tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  document.body.classList.toggle('drawing', t !== 'cursor');
  drawAll();
}
$$('.tool[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
$('#clearDraw').onclick = () => { if (confirm('Delete all drawings for ' + S.symbol + '?')) { S.drawings[dkey()] = []; sel = null; save(); updateDTool(); drawAll(); } };
$('#magnetBtn').onclick = () => { S.magnet = !S.magnet; $('#magnetBtn').classList.toggle('on', S.magnet); save(); };
$('#hideDraw').onclick = () => { S.hideDraw = !S.hideDraw; $('#hideDraw').classList.toggle('on', S.hideDraw); if (S.hideDraw) sel = null; save(); updateDTool(); drawAll(); };

/* نوار تنظیم رسم انتخاب‌شده */
function updateDTool() {
  const el = $('#dtool');
  if (!sel || S.hideDraw) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden'); restoreDt();
  $('#dtColor').value = /^#[0-9a-f]{6}$/i.test(sel.color || '') ? sel.color : defColor();
  $('#dtW').value = String(Math.round(sel.w || 2));
  $('#dtText').style.display = sel.type === 'text' ? '' : 'none';
}
$('#dtColor').oninput = e => { if (sel) { sel.color = e.target.value; save(); drawAll(); } };
$('#dtW').onchange = e => { if (sel) { sel.w = parseFloat(e.target.value); save(); drawAll(); } };
$('#dtText').onclick = () => { if (sel && sel.type === 'text') { const t = prompt('Text:', sel.text); if (t != null) { sel.text = t; save(); drawAll(); } } };
$('#dtDel').onclick = () => deleteSel();
$('#dtDup').onclick = () => {
  if (!sel) return;
  const c = JSON.parse(JSON.stringify(sel)), off = stepSec() * 3;
  ['p1', 'p2'].forEach(k => { if (c[k]) c[k].t += off; });
  drawings().push(c); sel = c; save(); updateDTool(); drawAll();
};
function deleteSel() {
  if (!sel) return;
  const L = drawings(), i = L.indexOf(sel); if (i >= 0) L.splice(i, 1);
  sel = null; save(); updateDTool(); drawAll();
}
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
window.addEventListener('keydown', e => {
  if (typing()) return;
  if (e.key === 'Escape') { setTool('cursor'); sel = null; updateDTool(); drawAll(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteSel(); }
});
new ResizeObserver(() => { drawAll(); }).observe(wrap);

/* ------------------------------------------- pan آزاد (افقی + عمودی) با کلیک چپ */
let vpan = null;
wrap.addEventListener('mousedown', e => {
  if (e.button !== 0 || drag || e.target.closest('#legend,#dtool,#toast')) return;
  const { x, y } = localXY(e);
  if (x > areaW()) return;                       // محور قیمت را خود چارت مدیریت می‌کند
  const ps = chart.panes(); let acc = 0, k = -1;
  for (let i = 0; i < ps.length; i++) { const h = ps[i].getHeight(); if (y >= acc && y < acc + h) { k = i; break; } acc += h + 1; }
  if (k < 0) return;
  const ser = k === 0 ? mainS : ps[k].getSeries()[0];
  if (!ser) return;
  vpan = { ser, h: ps[k].getHeight(), lastY: e.clientY, startY: e.clientY, active: false, k };
}, true);
window.addEventListener('mousemove', e => {
  if (!vpan) return;
  if (!(e.buttons & 1)) { vpan = null; return; }
  if (!vpan.active) { if (Math.abs(e.clientY - vpan.startY) < 3) return; vpan.active = true; vpan.ser.priceScale().setAutoScale(false); }
  const dy = e.clientY - vpan.lastY; if (!dy) return;
  vpan.lastY = e.clientY;
  const o = vpan.ser.priceScale().options(), m = o.scaleMargins || { top: 0.2, bottom: 0.1 };   // setVisibleRange حاشیه‌ها را خودش اضافه می‌کند
  const t = vpan.ser.coordinateToPrice(m.top * vpan.h - dy), b = vpan.ser.coordinateToPrice(vpan.h * (1 - m.bottom) - dy);
  if (t == null || b == null) return;
  vpan.ser.priceScale().setVisibleRange({ from: Math.min(t, b), to: Math.max(t, b) });
});
window.addEventListener('mouseup', () => { vpan = null; });

/* ------------------------------------------- پنجره‌های شناور قابل جابه‌جایی */
function makeDraggable(el, key) {
  let st = null;
  const clamp = (l, t) => ({ l: Math.max(0, Math.min(wrap.clientWidth - el.offsetWidth, l)), t: Math.max(0, Math.min(wrap.clientHeight - el.offsetHeight, t)) });
  const place = (l, t) => { const c = clamp(l, t); el.style.transform = 'none'; el.style.bottom = 'auto'; el.style.left = c.l + 'px'; el.style.top = c.t + 'px'; };
  el.style.cursor = 'move';
  el.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('button,select,input,textarea')) return;
    const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    place(r.left - w.left, r.top - w.top);
    st = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault(); e.stopPropagation();
  });
  window.addEventListener('mousemove', e => {
    if (!st) return;
    const w = wrap.getBoundingClientRect(); place(e.clientX - w.left - st.dx, e.clientY - w.top - st.dy);
  });
  window.addEventListener('mouseup', () => {
    if (!st) return; st = null;
    S[key] = { l: parseFloat(el.style.left), t: parseFloat(el.style.top) }; save();
  });
  return () => { const p = S[key]; if (p) place(p.l, p.t); };   // بازگرداندن موقعیت ذخیره‌شده
}
const restoreDt = makeDraggable($('#dtool'), 'dtPos');

/* ------------------------------------------------------------------- init */
async function init() {
  $('#symInput').value = S.symbol; $('#marketSel').value = S.market; $('#typeSel').value = S.type;
  $('#logBtn').classList.toggle('on', S.log); $('#volBtn').classList.toggle('on', S.vol);
  $('#panel').classList.toggle('hidden', !S.panel); $('#panelBtn').classList.toggle('on', S.panel);
  $('#magnetBtn').classList.toggle('on', S.magnet); $('#hideDraw').classList.toggle('on', S.hideDraw);
  applyTheme(); buildTfBar(); renderActiveList();
  $('#editor').value = NEW_TEMPLATE; $('#scName').value = 'My Indicator';
  await loadLibrary();
  if (S.firstRun) {
    S.firstRun = false;
    ['Supertrend', 'RSI'].forEach(n => { const s = library.find(l => l.name === n); if (s) S.instances.push({ id: uid(), name: s.name, code: s.code, overrides: {}, visible: true }); });
    save();
  }
  loadSymbols();
  await loadSymbol();
}
window.__tv = { S, RT, chart, get bars() { return bars; }, setSymbol, renderAll, recomputeAll };
init();
