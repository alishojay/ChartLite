# ChartLite

A free, lightweight charting app that runs on your own computer. It shows live
**Binance** candles (spot and USDT-M futures) and lets you write your own
indicators in **Python**.

> Not financial advice. See the disclaimer below.

## Features

- Candles, hollow candles, bars, Heikin Ashi, line and area charts, volume, log scale
- Symbol search with favorites, a watchlist (top coins by 24h volume), keyboard navigation
- Timeframes from 1 second to 1 month, plus **custom timeframes** (for example 9h or 45m)
- Live updates over Binance WebSocket (automatic fallback to polling)
- Drawing tools: trend line, ray, horizontal and vertical line, rectangle, Fib retracement, text, measure, magnet mode
- Dark and light themes, PNG screenshot export
- 21 built-in indicators (SMA, EMA, Bollinger Bands, RSI, MACD, Stochastic, ATR, Supertrend, Ichimoku, VWAP and more)
- A code editor: write your own indicator in Python (`pandas` / `numpy`), save it and add it to the chart
- Demo mode that works without internet access

## Quick start

Requires Python 3.10 or newer (tested on Python 3.13).

**Windows:** double-click `run.bat`.

**macOS / Linux:** `./run.sh`

Or manually:

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows
# source .venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
python app.py
```

The browser opens at <http://127.0.0.1:8765>. The server only listens on your own machine.

### Configuration (optional)

Copy `config.example.json` to `config.json` and edit it. For example, if Binance is blocked
in your country, set a proxy:

```json
{ "proxy": "http://127.0.0.1:10809" }
```

You can also use the `CHARTLITE_PROXY` environment variable.

### Demo mode

`CHARTLITE_DEMO=1 python app.py` runs the whole app on synthetic data, with no Binance access needed.

## Writing an indicator

Open the **Code** tab, paste a script and press **Ctrl+Enter**:

```python
indicator("My EMA", overlay=True)

length = input("Length", 20, min=1)
ma = ta.ema(df.close, length)

plot(ma, "EMA", color=color.orange, width=2)
marker(ta.crossover(df.close, ma), "", position="below", shape="arrowUp", color=color.green)
```

Available in every script: `df` (columns `open high low close volume time hl2 hlc3 ohlc4`), `ta`, `np`, `pd`,
`indicator`, `input`, `plot`, `hline`, `fill`, `marker`, `bgcolor`, `barcolor`, `line`, `label`, `box`, `alert`,
`log` and `color`. The `ta` module has moving averages (`sma ema rma wma hma vwma dema tema`), oscillators
(`rsi macd stoch stochrsi cci williams_r mfi obv`), volatility and bands (`atr bbands kc donchian supertrend`),
`adx`, `ichimoku`, `vwap`, `sar`, `pivots`, `heikin_ashi` and helpers such as `crossover`, `crossunder`,
`highest`, `lowest`, `change`, `roc`, `linreg`. See the files in `scripts/` for examples. Scripts you save go to `my_scripts/`.

> **Security:** scripts are executed as normal Python code on your computer. Only run scripts you trust.
> The server is bound to `127.0.0.1` on purpose; do not expose it to a network.

## ChartLite Pro

This free edition is the core of the project. The Pro edition adds, among other things, Elliott Wave / NEoWave tools,
advanced drawing tools, order-flow views, server-side alerts (Telegram / webhook) and a strategy back-tester.

Contact: `ali.shzh2@gmail.com`

## Disclaimer

This software is provided for educational and informational purposes only and is **not financial advice**.
Trading cryptocurrencies involves substantial risk of loss. Use it at your own risk.

ChartLite is an independent project and is not affiliated with, endorsed by or sponsored by Binance or TradingView, Inc.
Market data comes from Binance public endpoints; check their terms before any commercial use of the data.

## License and credits

Free for personal, non-commercial use, see [LICENSE](LICENSE).

Charts are rendered with [TradingView Lightweight Charts™](https://www.tradingview.com/) (Apache-2.0).
Full attribution and the other third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
