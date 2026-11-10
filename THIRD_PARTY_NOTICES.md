# Third-party notices

## TradingView Lightweight Charts™ (bundled)

`static/lightweight-charts.js` is the unmodified standalone production build of
**TradingView Lightweight Charts™ v5.2.1**, licensed under the
**Apache License 2.0** (full text: `static/LICENSE-lightweight-charts.txt`).

Attribution notice (from the project's NOTICE file, `static/NOTICE-lightweight-charts.txt`):

> TradingView Lightweight Charts™
> Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/

This product is built with TradingView Lightweight Charts: <https://www.tradingview.com/>.
The TradingView attribution logo is displayed on the chart (the library's
`attributionLogo` option is left enabled). Please do not disable it.

ChartLite is an independent project and is **not affiliated with, endorsed by
or sponsored by TradingView, Inc. or Binance**.

## Python dependencies (installed via `requirements.txt`, not bundled)

| Package  | License      |
|----------|--------------|
| Flask    | BSD-3-Clause |
| pandas   | BSD-3-Clause |
| NumPy    | BSD-3-Clause |
| requests | Apache-2.0   |

## Runtime resources

- Market data is read from Binance public endpoints. Check Binance's terms of
  use before redistributing the data or using it commercially.
- Coin icons in the symbol search are loaded at runtime from the
  `spothq/cryptocurrency-icons` repository through the jsDelivr CDN. If an icon
  cannot be loaded, the first letter of the coin is shown instead.
