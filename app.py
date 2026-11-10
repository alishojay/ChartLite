"""
ChartLite - local charting app with Binance market data and Python indicator scripts.
Run:  python app.py   (the browser opens at http://127.0.0.1:8765)
"""
import json
import os
import re
import threading
import time
import webbrowser
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_from_directory

import engine

BASE = Path(__file__).resolve().parent
SCRIPTS = BASE / "scripts"
MY_SCRIPTS = BASE / "my_scripts"
MY_SCRIPTS.mkdir(exist_ok=True)

DEFAULT_CFG = {
    "port": 8765,
    "proxy": None,  # مثلا "http://127.0.0.1:10809" یا "socks5h://127.0.0.1:10808"
    "futures_base": "https://fapi.binance.com",
    "spot_base": "https://api.binance.com",
    "spot_fallback_base": "https://data-api.binance.vision",
}
CFG = dict(DEFAULT_CFG)
cfg_file = BASE / "config.json"
if cfg_file.exists():
    CFG.update(json.loads(cfg_file.read_text(encoding="utf-8")))
if os.environ.get("CHARTLITE_PROXY"):
    CFG["proxy"] = os.environ["CHARTLITE_PROXY"]
DEMO = os.environ.get("CHARTLITE_DEMO") == "1"

app = Flask(__name__, static_folder=str(BASE / "static"), static_url_path="")
session = requests.Session()
if CFG["proxy"]:
    session.proxies = {"http": CFG["proxy"], "https": CFG["proxy"]}

_cache = {}
_lock = threading.Lock()


def cached(key, ttl, fn):
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _lock:
        _cache[key] = (time.time(), val)
    return val


_wt = {"t": time.time(), "used": 0}
WEIGHT_PER_MIN = 1800  # بالاتر از این صبر می‌کنیم (سقف واقعی 2400)


def _throttle(weight):
    with _lock:
        now = time.time()
        if now - _wt["t"] >= 60:
            _wt["t"], _wt["used"] = now, 0
        if _wt["used"] + weight > WEIGHT_PER_MIN:
            wait = 60 - (now - _wt["t"]) + 0.2
        else:
            wait = 0
            _wt["used"] += weight
    if wait > 0:
        time.sleep(min(wait, 30))
        with _lock:
            _wt["t"], _wt["used"] = time.time(), weight


def binance_get(market, path, params, weight=2):
    _throttle(weight)
    if market == "futures":
        bases = [CFG["futures_base"]]
        path = "/fapi/v1/" + path
    else:
        bases = [CFG["spot_base"], CFG["spot_fallback_base"]]
        path = "/api/v3/" + path
    err = None
    for b in bases:
        try:
            r = session.get(b + path, params=params, timeout=15)
            if r.status_code == 200:
                return r.json()
            err = f"{b}: HTTP {r.status_code} {r.text[:200]}"
        except requests.RequestException as e:
            err = f"{b}: {e}"
    raise RuntimeError(err)



# ----------------------------------------------------------- timeframes (native + custom)
NATIVE = {"1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "2h": 7200, "4h": 14400,
          "6h": 21600, "8h": 28800, "12h": 43200, "1d": 86400, "3d": 259200, "1w": 604800, "1M": 2592000}
_UNIT = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800, "M": 2592000}


def tf_seconds(iv):
    if iv in NATIVE:
        return NATIVE[iv]
    m = re.fullmatch(r"(\d+)([smhdw])", str(iv))
    if not m or int(m.group(1)) < 1:
        raise ValueError(f"bad interval {iv}")
    sec = int(m.group(1)) * _UNIT[m.group(2)]
    if sec > 30 * 86400:
        raise ValueError("interval too long")
    if sec >= 60 and sec % 60:
        raise ValueError("intervals above 59s must be whole minutes")
    return sec


def native_rows(market, symbol, interval, limit, end_time):
    if DEMO:
        raw = demo_klines(symbol, interval, end_time, limit)
    else:
        params = {"symbol": symbol, "interval": interval, "limit": limit}
        if end_time:
            params["endTime"] = end_time
        raw = binance_get(market, "klines", params, weight=5)
    return [[int(k[0]) // 1000, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])] for k in raw]


def klines_any(market, symbol, interval, limit, end_time=None):
    """هر تایم‌فریم: بومی بایننس، ثانیه‌ای، یا کاستوم (مثل 3h/9h/45m) که از یک تایم‌فریم پایه‌ی بومی ساخته می‌شود."""
    sec = tf_seconds(interval)
    if interval in NATIVE:
        return native_rows(market, symbol, interval, min(limit, 1500), end_time)
    if sec < 60:
        return seconds_klines(market, symbol, interval, min(limit, 1000), end_time)
    base_iv, base = max(((k, v) for k, v in NATIVE.items() if v < sec and sec % v == 0 and k != "1M"),
                        key=lambda kv: kv[1])
    factor = sec // base
    limit = min(limit, 1000)
    need = limit * factor + factor
    rows, end = [], end_time
    while len(rows) < need and len(rows) < 20000:
        ask = min(1500, need - len(rows))
        page = native_rows(market, symbol, base_iv, ask, end)
        if not page:
            break
        rows = page + rows
        if len(page) < ask:
            break
        end = page[0][0] * 1000 - 1
    buckets = {}
    for t, o, h, l, c, v in rows:
        b = t // sec * sec
        r = buckets.get(b)
        if r is None:
            buckets[b] = [b, o, h, l, c, v]
        else:
            r[2] = max(r[2], h)
            r[3] = min(r[3], l)
            r[4] = c
            r[5] += v
    out = [buckets[k] for k in sorted(buckets)]
    if out and rows and out[0][0] < rows[0][0]:
        out = out[1:]  # اولین بسته‌ی ناقص
    return out[-limit:]


# --------------------------------------------------------------------- demo data
def demo_klines(symbol, interval, end_time, limit):
    import numpy as np
    sec = tf_seconds(interval)
    end = (int(end_time) // 1000 if end_time else int(time.time())) // sec * sec
    total = 3000
    seed = sum(map(ord, symbol))
    rng = np.random.default_rng(seed)
    steps = rng.normal(0, 0.012, total).cumsum() + np.sin(np.arange(total) / 60.0) * 0.15
    closes = 100 * np.exp(steps)
    all_t = [(int(time.time()) // sec * sec) - sec * (total - 1 - i) for i in range(total)]
    rows = []
    for i in range(total):
        t = all_t[i]
        if t > end:
            continue
        c = closes[i]
        o = closes[i - 1] if i else c
        hi = max(o, c) * (1 + abs(rng.normal(0, 0.004)))
        lo = min(o, c) * (1 - abs(rng.normal(0, 0.004)))
        rows.append([t * 1000, o, hi, lo, c, float(rng.uniform(100, 1000))])
    return rows[-limit:]



# ---------------------------------------------------------------- seconds / trades


def agg_backward(market, symbol, max_trades, min_time_ms):
    """آخرین معاملات را از آخر به اول (با fromId) می‌خواند تا min_time یا سقف تعداد."""
    out = []
    first = binance_get(market, "aggTrades", {"symbol": symbol, "limit": 1000}, weight=20 if market == "futures" else 2)
    if not first:
        return out
    out = list(first)
    while len(out) < max_trades and out[0]["T"] > min_time_ms:
        from_id = out[0]["a"] - 1000
        if from_id < 0:
            break
        chunk = binance_get(market, "aggTrades", {"symbol": symbol, "fromId": from_id, "limit": 1000},
                            weight=20 if market == "futures" else 2)
        if not chunk:
            break
        chunk = [c for c in chunk if c["a"] < out[0]["a"]]
        if not chunk:
            break
        out = chunk + out
    return out


def demo_trades(symbol, t0_ms, t1_ms, n_per_sec=6):
    import numpy as np
    rng = np.random.default_rng(sum(map(ord, symbol)) + int(t0_ms // 60000))
    n = int((t1_ms - t0_ms) / 1000 * n_per_sec)
    ts = np.sort(rng.uniform(t0_ms, t1_ms, n)).astype(np.int64)
    base = 100 * np.exp(np.sin(ts / 3.6e6) * 0.05 + rng.normal(0, 0.0006, n).cumsum() * 0.05)
    qty = rng.exponential(2.0, n) + 0.01
    sell = rng.random(n) < 0.5
    return [{"a": i, "p": str(round(float(base[i]), 2)), "q": str(round(float(qty[i]), 3)),
             "T": int(ts[i]), "m": bool(sell[i])} for i in range(n)]


def trades_to_candles(trades, sec):
    rows = {}
    for tr in trades:
        b = int(tr["T"] // 1000) // sec * sec
        p, q = float(tr["p"]), float(tr["q"])
        r = rows.get(b)
        if r is None:
            rows[b] = [b, p, p, p, p, q]
        else:
            r[2] = max(r[2], p)
            r[3] = min(r[3], p)
            r[4] = p
            r[5] += q
    return [rows[k] for k in sorted(rows)]


def seconds_klines(market, symbol, interval, limit, end_time):
    sec = tf_seconds(interval)
    if DEMO:
        end_ms = int(end_time) if end_time else int(time.time() * 1000)
        tr = demo_trades(symbol, end_ms - limit * sec * 1000, end_ms, 3)
        return trades_to_candles(tr, sec)[-limit:]
    if market == "spot":
        # اسپات 1s بومی دارد؛ بقیه از روی آن ساخته می‌شود
        lim = min(1000, limit * sec)
        params = {"symbol": symbol, "interval": "1s", "limit": lim}
        if end_time:
            params["endTime"] = end_time
        raw = binance_get("spot", "klines", params)
        base = [[int(k[0]) // 1000, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])] for k in raw]
        if sec == 1:
            return base[-limit:]
        rows = {}
        for t, o, h, l, c, v in base:
            b = t // sec * sec
            r = rows.get(b)
            if r is None:
                rows[b] = [b, o, h, l, c, v]
            else:
                r[2] = max(r[2], h); r[3] = min(r[3], l); r[4] = c; r[5] += v
        return [rows[k] for k in sorted(rows)][-limit:]
    # فیوچرز: ثانیه بومی ندارد → از aggTrades (عمق محدود)
    end_ms = int(end_time) if end_time else int(time.time() * 1000)
    tr = agg_backward(market, symbol, 20000, end_ms - limit * sec * 1000)
    tr = [t for t in tr if t["T"] <= end_ms]
    return trades_to_candles(tr, sec)[-limit:]


# ------------------------------------------------------------------------- routes
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/klines")
def klines():
    market = request.args.get("market", "futures")
    symbol = request.args.get("symbol", "BTCUSDT").upper()
    interval = request.args.get("interval", "1h")
    limit = min(int(request.args.get("limit", 1000)), 1500)
    end_time = request.args.get("endTime")
    try:
        rows = klines_any(market, symbol, interval, limit, end_time)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 502
    return jsonify({"candles": rows, "ts": time.time() * 1000})


@app.route("/api/symbols")
def symbols():
    market = request.args.get("market", "futures")

    def load():
        if DEMO:
            return [{"symbol": s, "base": s[:-4], "tick": 0.01, "quote": "USDT",
                     "contract": "PERPETUAL" if market == "futures" else None}
                    for s in ("BTCUSDT", "ETHUSDT", "ARBUSDT", "SOLUSDT", "ZECUSDT", "HYPEUSDT", "XRPUSDT", "DOGEUSDT")]
        info = binance_get(market, "exchangeInfo", {})
        res = []
        for s in info["symbols"]:
            if s.get("status") != "TRADING":
                continue
            tick = 0.01
            for f in s.get("filters", []):
                if f.get("filterType") == "PRICE_FILTER":
                    tick = float(f["tickSize"])
            res.append({"symbol": s["symbol"], "base": s.get("baseAsset"), "tick": tick, "quote": s.get("quoteAsset"),
                        "contract": s.get("contractType")})
        return res

    try:
        return jsonify(cached(("sym", market), 3600, load))
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 502


@app.route("/api/tickers")
def tickers():
    market = request.args.get("market", "futures")

    def load():
        if DEMO:
            return [{"symbol": s, "price": 100.0 + i, "change": 1.5 - i * 0.4, "qvol": 1e9 / (i + 1)}
                    for i, s in enumerate(("BTCUSDT", "ETHUSDT", "ARBUSDT", "SOLUSDT", "ZECUSDT", "HYPEUSDT", "XRPUSDT", "DOGEUSDT"))]
        data = binance_get(market, "ticker/24hr", {}, weight=40)
        return [{"symbol": d["symbol"], "price": float(d["lastPrice"]), "change": float(d["priceChangePercent"]),
                 "qvol": float(d["quoteVolume"])} for d in data if (all_ or d["symbol"].endswith("USDT"))]

    all_ = request.args.get("all") == "1"
    try:
        return jsonify(cached(("tick", market, all_), 5, load))
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 502


@app.route("/api/run", methods=["POST"])
def run():
    body = request.get_json(force=True)
    res = engine.run_script(body.get("code", ""), body.get("candles", []), body.get("overrides") or {},
                            body.get("meta") or {})
    return jsonify(res)



def safe_name(name):
    name = re.sub(r"[^\w\- ]+", "", name, flags=re.UNICODE).strip()
    if not name:
        raise ValueError("نام نامعتبر")
    return name


@app.route("/api/scripts")
def list_scripts():
    out = []
    for kind, folder in (("builtin", SCRIPTS), ("user", MY_SCRIPTS)):
        if not folder.exists():
            continue
        for p in sorted(folder.glob("*.py")):
            out.append({"name": p.stem, "kind": kind, "code": p.read_text(encoding="utf-8")})
    return jsonify(out)


@app.route("/api/scripts/<name>", methods=["POST", "DELETE"])
def script_file(name):
    try:
        name = safe_name(name)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    path = MY_SCRIPTS / f"{name}.py"
    if request.method == "DELETE":
        if path.exists():
            path.unlink()
        return jsonify({"ok": True})
    path.write_text(request.get_json(force=True).get("code", ""), encoding="utf-8")
    return jsonify({"ok": True, "name": name})


def main():
    port = int(CFG["port"])
    url = f"http://127.0.0.1:{port}"
    print(f"ChartLite is running at {url}   (Ctrl+C to quit)")
    if not os.environ.get("CHARTLITE_NO_BROWSER"):
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=port, threaded=True, debug=False)


if __name__ == "__main__":
    main()
