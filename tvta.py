"""
tvta - technical-analysis helper library on top of pandas (used as `ta.*` inside scripts).

همه توابع Series (یا چند Series) برمی‌گردانند و هم‌اندازه‌ی df هستند.
در اسکریپت‌ها به شکل `ta.ema(df.close, 20)` در دسترس است.
"""
import numpy as np
import pandas as pd


# ----------------------------------------------------------------- helpers
def _ser(x, ref=None):
    if isinstance(x, pd.Series):
        return x
    if ref is not None:
        return pd.Series(x, index=ref.index, dtype=float) if np.isscalar(x) else pd.Series(np.asarray(x, dtype=float), index=ref.index)
    return pd.Series(x, dtype=float)


def _like(arr, ref):
    return pd.Series(arr, index=ref.index)


def _seeded(arr, alpha, length):
    """EMA/RMA seeded with an SMA of the first `length` values."""
    n = len(arr)
    out = np.full(n, np.nan)
    s = 0.0
    cnt = 0
    prev = np.nan
    for i in range(n):
        v = arr[i]
        if v != v:
            continue
        if prev != prev:
            s += v
            cnt += 1
            if cnt >= length:
                prev = s / length
                out[i] = prev
        else:
            prev = alpha * v + (1 - alpha) * prev
            out[i] = prev
    return out


# ----------------------------------------------------------- moving averages
def sma(src, length):
    return _ser(src).rolling(int(length)).mean()


def ema(src, length):
    length = int(length)
    src = _ser(src)
    return _like(_seeded(src.to_numpy(float), 2.0 / (length + 1), length), src)


def rma(src, length):
    length = int(length)
    src = _ser(src)
    return _like(_seeded(src.to_numpy(float), 1.0 / length, length), src)


def wma(src, length):
    length = int(length)
    w = np.arange(1, length + 1, dtype=float)
    return _ser(src).rolling(length).apply(lambda x: np.dot(x, w) / w.sum(), raw=True)


def hma(src, length):
    length = int(length)
    half = max(int(length / 2), 1)
    root = max(int(round(np.sqrt(length))), 1)
    return wma(2 * wma(src, half) - wma(src, length), root)


def vwma(src, volume, length):
    length = int(length)
    return (_ser(src) * volume).rolling(length).sum() / volume.rolling(length).sum()


def dema(src, length):
    e = ema(src, length)
    return 2 * e - ema(e, length)


def tema(src, length):
    e1 = ema(src, length)
    e2 = ema(e1, length)
    e3 = ema(e2, length)
    return 3 * (e1 - e2) + e3


# ------------------------------------------------------------- basic helpers
def highest(src, length):
    return _ser(src).rolling(int(length)).max()


def lowest(src, length):
    return _ser(src).rolling(int(length)).min()


def stdev(src, length, ddof=0):
    return _ser(src).rolling(int(length)).std(ddof=ddof)


def change(src, length=1):
    return _ser(src).diff(int(length))


def mom(src, length=10):
    return change(src, length)


def roc(src, length=10):
    src = _ser(src)
    return 100.0 * (src - src.shift(int(length))) / src.shift(int(length))


def cum(src):
    return _ser(src).fillna(0).cumsum()


def fixnan(src):
    return _ser(src).ffill()


def crossover(a, b):
    ref = a if isinstance(a, pd.Series) else (b if isinstance(b, pd.Series) else None)
    a, b = _ser(a, ref), _ser(b, ref)
    return (a > b) & (a.shift(1) <= b.shift(1))


def crossunder(a, b):
    ref = a if isinstance(a, pd.Series) else (b if isinstance(b, pd.Series) else None)
    a, b = _ser(a, ref), _ser(b, ref)
    return (a < b) & (a.shift(1) >= b.shift(1))


def cross(a, b):
    return crossover(a, b) | crossunder(a, b)


def barssince(cond):
    cond = cond.fillna(False).astype(bool)
    pos = pd.Series(np.arange(len(cond), dtype=float), index=cond.index)
    last = pos.where(cond).ffill()
    return pos - last


def valuewhen(cond, src, occurrence=0):
    cond = cond.fillna(False).astype(bool)
    vals = _ser(src).where(cond).dropna()
    return vals.shift(int(occurrence)).reindex(src.index).ffill() if occurrence else _ser(src).where(cond).ffill()


def linreg(src, length, offset=0):
    length = int(length)
    x = np.arange(length, dtype=float)
    xm = x.mean()
    sxx = ((x - xm) ** 2).sum()

    def f(y):
        slope = ((x - xm) * (y - y.mean())).sum() / sxx
        intercept = y.mean() - slope * xm
        return intercept + slope * (length - 1 - offset)

    return _ser(src).rolling(length).apply(f, raw=True)


# ----------------------------------------------------------------- oscillators
def rsi(src, length=14):
    src = _ser(src)
    d = src.diff()
    up = rma(d.clip(lower=0), length)
    dn = rma((-d).clip(lower=0), length)
    out = 100.0 - 100.0 / (1.0 + up / dn)
    out = out.where(dn != 0, 100.0)
    out = out.where(up.notna() & dn.notna())
    return out


def macd(src, fast=12, slow=26, signal=9):
    m = ema(src, fast) - ema(src, slow)
    s = ema(m, signal)
    return m, s, m - s


def stoch(df, k=14, d=3, smooth=1):
    ll = df.low.rolling(int(k)).min()
    hh = df.high.rolling(int(k)).max()
    raw = 100.0 * (df.close - ll) / (hh - ll)
    kk = sma(raw, smooth) if smooth > 1 else raw
    return kk, sma(kk, d)


def stochrsi(src, rsi_len=14, stoch_len=14, k=3, d=3):
    r = rsi(src, rsi_len)
    ll = r.rolling(int(stoch_len)).min()
    hh = r.rolling(int(stoch_len)).max()
    raw = 100.0 * (r - ll) / (hh - ll)
    kk = sma(raw, k)
    return kk, sma(kk, d)


def cci(df, length=20):
    tp = (df.high + df.low + df.close) / 3.0
    ma = tp.rolling(int(length)).mean()
    dev = tp.rolling(int(length)).apply(lambda x: np.abs(x - x.mean()).mean(), raw=True)
    return (tp - ma) / (0.015 * dev)


def williams_r(df, length=14):
    hh = df.high.rolling(int(length)).max()
    ll = df.low.rolling(int(length)).min()
    return 100.0 * (df.close - hh) / (hh - ll)


def mfi(df, length=14):
    tp = (df.high + df.low + df.close) / 3.0
    raw = tp * df.volume
    pos = raw.where(tp > tp.shift(1), 0.0).rolling(int(length)).sum()
    neg = raw.where(tp < tp.shift(1), 0.0).rolling(int(length)).sum()
    return 100.0 - 100.0 / (1.0 + pos / neg)


def obv(df):
    sign = np.sign(df.close.diff()).fillna(0.0)
    return (sign * df.volume).cumsum()


# ------------------------------------------------------------ volatility/bands
def tr(df):
    pc = df.close.shift(1)
    return pd.concat([df.high - df.low, (df.high - pc).abs(), (df.low - pc).abs()], axis=1).max(axis=1)


def atr(df, length=14):
    return rma(tr(df), length)


def bbands(src, length=20, mult=2.0, ddof=0):
    """-> (basis, upper, lower)"""
    src = _ser(src)
    basis = src.rolling(int(length)).mean()
    dev = mult * src.rolling(int(length)).std(ddof=ddof)
    return basis, basis + dev, basis - dev


def kc(df, length=20, mult=1.5, atr_len=None, use_ema=True):
    """Keltner Channel -> (mid, upper, lower)"""
    mid = ema(df.close, length) if use_ema else sma(df.close, length)
    rng = atr(df, atr_len or length)
    return mid, mid + mult * rng, mid - mult * rng


def donchian(df, length=20):
    """-> (upper, lower, mid)"""
    up = df.high.rolling(int(length)).max()
    lo = df.low.rolling(int(length)).min()
    return up, lo, (up + lo) / 2.0


def supertrend(df, period=10, mult=3.0):
    """-> (line, direction)  direction: -1 = uptrend (line below price), 1 = downtrend"""
    a = atr(df, period).to_numpy(float)
    src = ((df.high + df.low) / 2.0).to_numpy(float)
    c = df.close.to_numpy(float)
    n = len(c)
    st = np.full(n, np.nan)
    dr = np.full(n, np.nan)
    pl = pu = 0.0
    pst = np.nan
    prev_atr = np.nan
    for i in range(n):
        if a[i] != a[i]:
            prev_atr = a[i]
            continue
        up = src[i] + mult * a[i]
        lo = src[i] - mult * a[i]
        pc = c[i - 1] if i > 0 else np.nan
        lo = lo if (lo > pl or pc < pl) else pl
        up = up if (up < pu or pc > pu) else pu
        if prev_atr != prev_atr:
            d = 1
        elif pst == pu:
            d = -1 if c[i] > up else 1
        else:
            d = 1 if c[i] < lo else -1
        s = lo if d == -1 else up
        st[i] = s
        dr[i] = d
        pl, pu, pst, prev_atr = lo, up, s, a[i]
    return _like(st, df), _like(dr, df)


def adx(df, di_len=14, adx_len=14):
    """-> (plus_di, minus_di, adx)"""
    up = df.high.diff()
    dn = -df.low.diff()
    pdm = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=df.index).where(up.notna())
    mdm = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=df.index).where(up.notna())
    t = rma(tr(df), di_len)
    plus = 100.0 * rma(pdm, di_len) / t
    minus = 100.0 * rma(mdm, di_len) / t
    s = (plus + minus).replace(0, 1.0)
    return plus, minus, 100.0 * rma((plus - minus).abs() / s, adx_len)


def ichimoku(df, conv=9, base=26, span_b=52):
    """-> (conversion, base, span_a, span_b, lagging)
    To display it like the usual cloud: plot the spans with offset=25 and the lagging span with offset=-25."""
    def mid(n):
        return (df.high.rolling(n).max() + df.low.rolling(n).min()) / 2.0
    c, b = mid(conv), mid(base)
    return c, b, (c + b) / 2.0, mid(span_b), df.close


def vwap(df, anchor="D"):
    """VWAP با ریست روزانه (UTC). anchor: 'D' روز، 'W' هفته، 'M' ماه"""
    t = pd.to_datetime(df["time"], unit="s")
    key = {"D": t.dt.floor("D"), "W": t.dt.to_period("W").dt.start_time, "M": t.dt.to_period("M").dt.start_time}[anchor]
    hlc3 = (df.high + df.low + df.close) / 3.0
    pv = (hlc3 * df.volume).groupby(key).cumsum()
    v = df.volume.groupby(key).cumsum()
    return pv / v


def sar(df, start=0.02, inc=0.02, maximum=0.2):
    """Parabolic SAR"""
    h = df.high.to_numpy(float)
    l = df.low.to_numpy(float)
    c = df.close.to_numpy(float)
    n = len(c)
    out = np.full(n, np.nan)
    if n < 2:
        return _like(out, df)
    up = c[1] >= c[0]
    s = l[0] if up else h[0]
    ep = h[1] if up else l[1]
    af = start
    out[1] = s
    for i in range(2, n):
        ns = s + af * (ep - s)
        if up:
            ns = min(ns, l[i - 1], l[i - 2])
            if l[i] < ns:
                up = False
                ns = ep
                ep = l[i]
                af = start
            elif h[i] > ep:
                ep = h[i]
                af = min(af + inc, maximum)
        else:
            ns = max(ns, h[i - 1], h[i - 2])
            if h[i] > ns:
                up = True
                ns = ep
                ep = h[i]
                af = start
            elif l[i] < ep:
                ep = l[i]
                af = min(af + inc, maximum)
        s = ns
        out[i] = s
    return _like(out, df)


def pivots(df, left=5, right=5):
    """-> (pivot_high, pivot_low) روی خود کندل پیوت (نیاز به `right` کندل بعدی دارد؛ در استراتژی مراقب look-ahead باش)."""
    w = int(left) + int(right) + 1
    hmax = df.high.rolling(w, center=True).max()
    lmin = df.low.rolling(w, center=True).min()
    return df.high.where(df.high == hmax), df.low.where(df.low == lmin)


def heikin_ashi(df):
    o = df.open.to_numpy(float)
    h = df.high.to_numpy(float)
    l = df.low.to_numpy(float)
    c = df.close.to_numpy(float)
    hc = (o + h + l + c) / 4.0
    ho = np.empty_like(hc)
    ho[0] = (o[0] + c[0]) / 2.0
    for i in range(1, len(hc)):
        ho[i] = (ho[i - 1] + hc[i - 1]) / 2.0
    hh = np.maximum.reduce([h, ho, hc])
    hl = np.minimum.reduce([l, ho, hc])
    return pd.DataFrame({"open": ho, "high": hh, "low": hl, "close": hc}, index=df.index)
