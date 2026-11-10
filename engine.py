"""
engine - اجرای اسکریپت‌های پایتونی کاربر روی کندل‌ها و تبدیل خروجی به JSON برای چارت.
"""
import contextlib
import io
import math
import traceback

import numpy as np
import pandas as pd

import tvta

MAX_LOG = 20000


class Color:
    red = "#F23645"
    green = "#26A69A"
    blue = "#2962FF"
    orange = "#FF9800"
    yellow = "#FDD835"
    lime = "#00E676"
    aqua = "#00BCD4"
    teal = "#089981"
    purple = "#9C27B0"
    fuchsia = "#E040FB"
    white = "#FFFFFF"
    gray = "#787B86"
    silver = "#B2B5BE"
    black = "#131722"
    maroon = "#880E4F"
    navy = "#311B92"
    olive = "#808000"

    @staticmethod
    def rgba(color, alpha=0.2):
        """color.rgba('#26A69A', 0.15) -> 'rgba(38,166,154,0.15)'"""
        c = color.lstrip("#")
        r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
        return f"rgba({r},{g},{b},{alpha})"


class Handle:
    def __init__(self, kind, id_):
        self.kind = kind
        self.id = id_


def _vals(x, n, what="series"):
    """Series/array/scalar -> list با None به جای NaN"""
    if x is None:
        return [None] * n
    if np.isscalar(x):
        v = float(x)
        return [None if not math.isfinite(v) else v] * n
    arr = np.asarray(x, dtype=float)
    if arr.shape[0] != n:
        raise ValueError(f"طول {what} ({arr.shape[0]}) با تعداد کندل‌ها ({n}) برابر نیست")
    return [float(v) if math.isfinite(v) else None for v in arr]


def _bools(x, n):
    if x is None:
        return np.zeros(n, dtype=bool)
    if isinstance(x, pd.Series):
        x = x.fillna(False)
    arr = np.asarray(x)
    if arr.shape == ():
        return np.full(n, bool(arr))
    return arr.astype(bool)


def _colors(x, n):
    """رنگ ثابت یا Series رنگ -> (color|None, list|None)"""
    if x is None:
        return None, None
    if isinstance(x, str):
        return x, None
    arr = list(x)
    if len(arr) != n:
        raise ValueError("طول سری رنگ با تعداد کندل‌ها برابر نیست")
    return None, [c if isinstance(c, str) else None for c in arr]


class Ctx:
    def __init__(self, df, overrides, meta):
        self.df = df
        self.n = len(df)
        self.overrides = overrides or {}
        self.meta = meta or {}
        self.title = None
        self.overlay = False
        self.inputs = []
        self.plots = []
        self.hlines = []
        self.markers = []
        self.fills = []
        self.bgs = []
        self.barcolor = None
        self.alerts = []
        self.lines = []
        self.labels = []
        self.boxes = []
        self.log_buf = io.StringIO()

    # ---------------------------------------------------------- API for scripts
    def api(self):
        ctx = self
        n = self.n

        def indicator(title=None, overlay=False):
            """عنوان و اینکه روی قیمت (overlay=True) یا در پنل جدا رسم شود."""
            ctx.title = title
            ctx.overlay = bool(overlay)

        def input(title, default, min=None, max=None, step=None, options=None):  # noqa: A001
            """پارامتر قابل تنظیم از UI. نوع از روی default تشخیص داده می‌شود."""
            key = title
            if any(i["key"] == key for i in ctx.inputs):
                key = f"{title}#{len(ctx.inputs)}"
            if options:
                typ = "select"
            elif isinstance(default, bool):
                typ = "bool"
            elif isinstance(default, int):
                typ = "int"
            elif isinstance(default, float):
                typ = "float"
            elif isinstance(default, str) and default.startswith("#"):
                typ = "color"
            else:
                typ = "string"
            val = ctx.overrides.get(key, default)
            try:
                if typ == "int":
                    val = int(float(val))
                elif typ == "float":
                    val = float(val)
                elif typ == "bool":
                    val = bool(val)
            except (TypeError, ValueError):
                val = default
            ctx.inputs.append({"key": key, "title": title, "type": typ, "default": default, "value": val,
                               "min": min, "max": max, "step": step, "options": options})
            return val

        def plot(series, title=None, color=None, width=2, style="line", offset=0, hidden=False, base=0):
            """style: line | histogram | columns | circles | step | area | cross
            color: رنگ ثابت یا Series از رنگ‌ها (برای رنگ متغیر هر کندل)"""
            c, cs = _colors(color, n)
            p = {"id": len(ctx.plots), "title": title or f"Plot {len(ctx.plots) + 1}", "style": style,
                 "width": width, "color": c, "colors": cs, "offset": int(offset), "hidden": bool(hidden),
                 "base": base, "values": _vals(series, n, f"plot '{title}'")}
            ctx.plots.append(p)
            return Handle("plot", p["id"])

        def hline(price, title=None, color="#787B86", style="dashed", width=1):
            ctx.hlines.append({"price": float(price), "title": title or "", "color": color, "style": style, "width": width})
            return Handle("hline", len(ctx.hlines) - 1)

        def marker(cond, text="", position="above", shape="arrowUp", color=None, size=1):
            """نشانه روی کندل‌هایی که cond=True. position: above|below|inBar  shape: arrowUp|arrowDown|circle|square"""
            m = _bools(cond, n)
            col = color or ("#26A69A" if shape == "arrowUp" else "#F23645" if shape == "arrowDown" else "#FDD835")
            pos = {"above": "aboveBar", "below": "belowBar", "inBar": "inBar"}.get(position, position)
            for i in np.flatnonzero(m):
                ctx.markers.append({"i": int(i), "position": pos, "shape": shape, "color": col, "text": text, "size": size})

        def fill(a, b, color="rgba(41,98,255,0.12)"):
            """ناحیه بین دو plot / hline / عدد"""
            def ref(h):
                if isinstance(h, Handle):
                    return {"kind": h.kind, "id": h.id}
                return {"kind": "value", "value": float(h)}
            ctx.fills.append({"a": ref(a), "b": ref(b), "color": color})

        def bgcolor(colors):
            """رنگ پس‌زمینه‌ی کندل‌ها؛ Series از رنگ (یا None)."""
            _, cs = _colors(colors, n)
            ctx.bgs.append(cs)

        def barcolor(colors):
            """رنگ بدنه‌ی کندل‌ها؛ Series از رنگ (یا None)."""
            _, cs = _colors(colors, n)
            ctx.barcolor = cs

        def alert(cond, message="Alert"):
            """هشدار: اگر روی آخرین کندل cond درست باشد در UI اعلان می‌دهد."""
            m = _bools(cond, n)
            idx = np.flatnonzero(m)
            ctx.alerts.append({"message": message, "last": bool(n and m[-1]), "bars": [int(i) for i in idx[-50:]]})

        def line(i1, p1, i2, p2, color="#2962FF", width=2, style="solid", extend=False):
            """خط بین دو نقطه (index کندل، قیمت). extend=True یعنی تا آخر چارت ادامه دارد."""
            ctx.lines.append({"i1": int(i1), "p1": float(p1), "i2": int(i2), "p2": float(p2), "color": color,
                              "width": width, "style": style, "extend": bool(extend)})

        def label(i, price, text, color="#D1D4DC", bg="rgba(41,98,255,0.85)", size=11, pos="above"):
            ctx.labels.append({"i": int(i), "price": float(price), "text": str(text), "color": color, "bg": bg,
                               "size": size, "pos": pos})

        def box(i1, p1, i2, p2, color="rgba(41,98,255,0.9)", bg="rgba(41,98,255,0.10)", width=1):
            ctx.boxes.append({"i1": int(i1), "p1": float(p1), "i2": int(i2), "p2": float(p2), "color": color,
                              "bg": bg, "width": width})

        def log(*a):
            print(*a)

        ns = dict(indicator=indicator, input=input, plot=plot, hline=hline, marker=marker, fill=fill,
                  bgcolor=bgcolor, barcolor=barcolor, alert=alert, log=log, color=Color, line=line, label=label, box=box)
        return ns


# ------------------------------------------------------------------- runner
def run_script(code, candles, overrides=None, meta=None):
    """candles: [[time_sec, o, h, l, c, v], ...]"""
    df = pd.DataFrame(candles, columns=["time", "open", "high", "low", "close", "volume"], dtype=float)
    df["time"] = df["time"].astype("int64")
    df["hl2"] = (df.high + df.low) / 2.0
    df["hlc3"] = (df.high + df.low + df.close) / 3.0
    df["ohlc4"] = (df.open + df.high + df.low + df.close) / 4.0
    ctx = Ctx(df, overrides, meta)
    ns = {"__name__": "__tvscript__", "df": df, "ta": tvta, "np": np, "pd": pd, "math": math,
          "meta": dict(meta or {})}
    ns.update(ctx.api())
    buf = ctx.log_buf
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(code, "<script>", "exec"), ns)
    except BaseException as e:  # noqa: BLE001 - نمایش هر خطای اسکریپت به کاربر
        line = None
        tb = traceback.extract_tb(e.__traceback__)
        for fr in reversed(tb):
            if fr.filename == "<script>":
                line = fr.lineno
                break
        if isinstance(e, SyntaxError) and e.filename == "<script>":
            line = e.lineno
        return {"ok": False, "error": {"message": f"{type(e).__name__}: {e}", "line": line,
                                       "trace": "".join(traceback.format_exception(type(e), e, e.__traceback__))[-3000:]},
                "logs": buf.getvalue()[-MAX_LOG:]}
    out = {
        "ok": True,
        "title": ctx.title,
        "overlay": ctx.overlay,
        "inputs": ctx.inputs,
        "plots": ctx.plots,
        "hlines": ctx.hlines,
        "markers": ctx.markers,
        "fills": ctx.fills,
        "bgs": ctx.bgs,
        "barcolor": ctx.barcolor,
        "alerts": ctx.alerts,
        "lines": ctx.lines,
        "labels": ctx.labels,
        "boxes": ctx.boxes,
        "logs": buf.getvalue()[-MAX_LOG:],
    }
    return out
