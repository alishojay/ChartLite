'use strict';
/* ChartLite extras: script shapes (line/label/box), trade stream for seconds timeframes, symbol search */

/* ------------------------------------------------- script shapes (line/label/box) */
class ShapesPrim {
  constructor(r) { this.r = r; }
  attached(p) { this.chart = p.chart; this.series = p.series; this.req = p.requestUpdate; this._view = { zOrder: () => 'top', renderer: () => ({ draw: t => t.useMediaCoordinateSpace(sc => this.paint(sc)) }) }; }
  detached() { this.chart = this.series = null; }
  paneViews() { return this._view ? [this._view] : []; }
  paint(sc) {
    if (!this.chart) return;
    const ctx = sc.context, ts = this.chart.timeScale(), W = sc.mediaSize.width, r = this.r;
    const X = i => ts.logicalToCoordinate(i), Y = p => this.series.priceToCoordinate(p);
    (r.boxes || []).forEach(b => {
      const x1 = X(b.i1), x2 = X(b.i2), y1 = Y(b.p1), y2 = Y(b.p2); if ([x1, x2, y1, y2].some(v => v == null)) return;
      ctx.fillStyle = b.bg; ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.strokeStyle = b.color; ctx.lineWidth = b.width || 1; ctx.setLineDash([3, 3]); ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); ctx.setLineDash([]);
    });
    (r.lines || []).forEach(l => {
      let x1 = X(l.i1), x2 = X(l.i2), y1 = Y(l.p1), y2 = Y(l.p2); if ([x1, x2, y1, y2].some(v => v == null)) return;
      if (l.extend && x2 !== x1) { const k = (y2 - y1) / (x2 - x1); y2 = y2 + k * (W - x2); x2 = W; }
      ctx.strokeStyle = l.color; ctx.lineWidth = l.width || 1; ctx.setLineDash(l.style === 'dashed' ? [6, 4] : l.style === 'dotted' ? [2, 3] : []);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    });
    (r.labels || []).forEach(l => {
      const x = X(l.i), y = Y(l.price); if (x == null || y == null) return;
      ctx.font = `${l.size || 11}px sans-serif`; const w = ctx.measureText(l.text).width + 10, h = (l.size || 11) + 8;
      const by = l.pos === 'below' ? y + 4 : y - h - 4;
      ctx.fillStyle = l.bg; ctx.beginPath(); ctx.roundRect(x - w / 2, by, w, h, 4); ctx.fill();
      ctx.fillStyle = l.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(l.text, x, by + h / 2);
    });
  }
}

/* -------------------------------------------------------- trade stream (ثانیه‌ای / فوت‌پرینت) */
let tws = null, tGen = 0, tFailed = false;
const isSec = tf => (TF_SEC[tf] || 60) < 60;
function stopTrades() { tGen++; if (tws) { tws.onmessage = tws.onclose = tws.onerror = null; try { tws.close(); } catch (e) { /* ignore */ } tws = null; } }
function onTrade(p, q, T, isSell) {
  const sec = TF_SEC[S.tf], bt = Math.floor(T / 1000 / sec) * sec, last = bars[bars.length - 1];
  if (isSec(S.tf)) {
    if (last && bt === last.time) onKline({ time: bt, open: last.open, high: Math.max(last.high, p), low: Math.min(last.low, p), close: p, volume: last.volume + q });
    else if (last && bt > last.time) onKline({ time: bt, open: p, high: p, low: p, close: p, volume: q });
  }
}
function startTrades(gen, onFail) {
  stopTrades(); const g = ++tGen;
  const stream = `${S.symbol.toLowerCase()}@aggTrade`;
  const urls = S.market === 'futures'
    ? [`wss://fstream.binance.com/market/ws/${stream}`, `wss://fstream.binance.com/ws/${stream}`]
    : [`wss://stream.binance.com:9443/ws/${stream}`, `wss://data-stream.binance.vision/ws/${stream}`];
  let k = 0;
  const next = () => {
    if (g !== tGen) return;
    if (k >= urls.length) { if (onFail) onFail(); return; }
    let got = false, w; try { w = new WebSocket(urls[k++]); } catch (e) { next(); return; }
    tws = w;
    const to = setTimeout(() => { if (!got && g === tGen) { w.onclose = null; try { w.close(); } catch (e) { /* ignore */ } next(); } }, 7000);
    w.onmessage = ev => {
      if (g !== tGen) return;
      if (!got) { got = true; clearTimeout(to); setStatus('● live (trades)', 'live'); }
      try { const m = JSON.parse(ev.data), d = m.data || m; if (d.p) onTrade(+d.p, +d.q, d.T, !!d.m); } catch (e) { /* ignore */ }
    };
    w.onclose = () => { clearTimeout(to); if (g !== tGen) return; if (got) setTimeout(() => { if (g === tGen) startTrades(gen, onFail); }, 2000); else next(); };
  };
  next();
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ======================================================================= جستجوی نماد */
const QUOTE_NAME = { USDT: 'TetherUS', USDC: 'USDC', BUSD: 'Binance USD', FDUSD: 'First Digital USD', BTC: 'Bitcoin', ETH: 'Ethereum', BNB: 'BNB', TRY: 'Turkish Lira', EUR: 'Euro', BRL: 'Brazilian Real', DAI: 'Dai', TUSD: 'TrueUSD' };
const COIN_NAME = { BTC: 'Bitcoin', ETH: 'Ethereum', BNB: 'BNB', SOL: 'Solana', XRP: 'XRP', ADA: 'Cardano', DOGE: 'Dogecoin', AVAX: 'Avalanche', DOT: 'Polkadot', LINK: 'Chainlink', MATIC: 'Polygon', POL: 'Polygon Ecosystem Token', LTC: 'Litecoin', BCH: 'Bitcoin Cash', UNI: 'Uniswap', ATOM: 'Cosmos', ETC: 'Ethereum Classic', XLM: 'Stellar', NEAR: 'NEAR Protocol', APT: 'Aptos', ARB: 'Arbitrum', OP: 'Optimism', FIL: 'Filecoin', INJ: 'Injective', SUI: 'Sui', TIA: 'Celestia', SEI: 'Sei', TRX: 'TRON', TON: 'Toncoin', SHIB: 'Shiba Inu', PEPE: 'Pepe', WIF: 'dogwifhat', BONK: 'Bonk', FET: 'Fetch.ai', RNDR: 'Render', RENDER: 'Render', AAVE: 'Aave', MKR: 'Maker', CRV: 'Curve DAO', LDO: 'Lido DAO', ZEC: 'Zcash', XMR: 'Monero', DASH: 'Dash', HYPE: 'Hyperliquid', XAU: 'Gold', XAG: 'Silver', EOS: 'EOS', ALGO: 'Algorand', VET: 'VeChain', ICP: 'Internet Computer', HBAR: 'Hedera', SAND: 'The Sandbox', MANA: 'Decentraland', AXS: 'Axie Infinity', GALA: 'Gala', APE: 'ApeCoin', GMT: 'STEPN', DYDX: 'dYdX', STX: 'Stacks', IMX: 'Immutable', RUNE: 'THORChain', SNX: 'Synthetix', COMP: 'Compound', ENS: 'Ethereum Name Service', PENDLE: 'Pendle', JUP: 'Jupiter', WLD: 'Worldcoin', ORDI: 'ORDI', ENA: 'Ethena', TAO: 'Bittensor', ONDO: 'Ondo', JTO: 'Jito', PYTH: 'Pyth Network', W: 'Wormhole', STRK: 'Starknet', AR: 'Arweave', GRT: 'The Graph', FTM: 'Fantom', S: 'Sonic', KAS: 'Kaspa', NOT: 'Notcoin', TRUMP: 'Official Trump', ETHFI: 'Ether.fi', EIGEN: 'EigenLayer', ZRO: 'LayerZero', ZK: 'ZKsync', MOVE: 'Movement', VIRTUAL: 'Virtuals Protocol', AI16Z: 'ai16z', PNUT: 'Peanut the Squirrel', NEIRO: 'Neiro', FLOKI: 'FLOKI', THETA: 'Theta Network', CHZ: 'Chiliz', EGLD: 'MultiversX', FLOW: 'Flow', KAVA: 'Kava', ZIL: 'Zilliqa', ZRX: '0x', BAT: 'Basic Attention Token', SUSHI: 'SushiSwap', YFI: 'yearn.finance', CAKE: 'PancakeSwap', GMX: 'GMX', RAY: 'Raydium', LUNA: 'Terra', LUNC: 'Terra Classic', USDC: 'USD Coin', PAXG: 'PAX Gold' };
const baseKey = b => String(b || '').replace(/^(1000000|1000|1M)/, '');
const coinName = b => COIN_NAME[b] || COIN_NAME[baseKey(b)] || b;
const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const SYM = { futures: [], spot: [], tick: {}, sel: 0, rows: [], q: '', mk: 'futures', quote: 'ALL', favOnly: false, shown: 60 };
const favs = () => S.favSyms || (S.favSyms = []);
function symMeta(s, mk) {
  const base = s.base || s.symbol.replace(new RegExp((s.quote || 'USDT') + '$'), ''), qn = QUOTE_NAME[s.quote] || s.quote || '';
  const c = s.contract || '';
  const kind = mk === 'spot' ? 'SPOT' : c === 'PERPETUAL' ? 'PERPETUAL CONTRACT' : c ? c.replace('_', ' ') + ' FUTURES' : 'FUTURES';
  const badge = mk === 'spot' ? 'SPOT CRYPTO' : c === 'PERPETUAL' ? 'SWAP CRYPTO' : 'FUTURES CRYPTO';
  return { base, name: coinName(base), desc: `${coinName(base)} / ${qn} ${kind}`.trim(), badge };
}
async function symEnsure(mk) {
  if (!SYM[mk].length) { try { SYM[mk] = await api('/api/symbols?market=' + mk); } catch (e) { SYM[mk] = []; } }
  try { const t = await api('/api/tickers?all=1&market=' + mk); SYM.tick[mk] = Object.fromEntries(t.map(d => [d.symbol, d])); } catch (e) { SYM.tick[mk] = SYM.tick[mk] || {}; }
}
function symFilter() {
  const mk = SYM.mk, q = SYM.q.trim().toUpperCase(), tk = SYM.tick[mk] || {}, fv = favs();
  let list = SYM[mk].filter(s => (SYM.quote === 'ALL' || s.quote === SYM.quote) && (!SYM.favOnly || fv.includes(mk + ':' + s.symbol)));
  const qs = q.split(/\s+/).filter(Boolean);
  const scored = [];
  list.forEach(s => {
    const m = symMeta(s, mk); let sc = 0;
    const hay = (s.symbol + ' ' + m.name + ' ' + m.base).toUpperCase();
    if (qs.length) {
      if (!qs.every(w => hay.includes(w))) return;
      sc = s.symbol === q ? 1000 : s.symbol.startsWith(qs[0]) ? 500 : m.base.toUpperCase() === qs[0] ? 400 : m.name.toUpperCase().startsWith(qs[0]) ? 200 : 50;
    }
    const v = (tk[s.symbol] || {}).qvol || 0;
    scored.push({ s, m, sc, v, fav: fv.includes(mk + ':' + s.symbol) });
  });
  scored.sort((a, b) => (b.sc - a.sc) || (b.fav - a.fav) || (b.v - a.v) || a.s.symbol.localeCompare(b.s.symbol));
  return scored;
}
function icon(base) {
  const b = baseKey(base).toLowerCase(), h = hue(base);
  return `<span class="sico" style="background:hsl(${h} 45% 32%)">${esc(base[0] || '?')}<img src="https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color/${esc(b)}.png" onerror="this.remove()" alt=""></span>`;
}
function hl(txt, q) {
  const t = esc(txt); const w = q.trim().split(/\s+/)[0]; if (!w) return t;
  const i = txt.toUpperCase().indexOf(w.toUpperCase()); if (i < 0) return t;
  return esc(txt.slice(0, i)) + '<mark>' + esc(txt.slice(i, i + w.length)) + '</mark>' + esc(txt.slice(i + w.length));
}
function symRender() {
  const box = $('#symRows'); if (!box) return;
  SYM.rows = symFilter();
  const tk = SYM.tick[SYM.mk] || {}, fv = favs();
  SYM.sel = Math.max(0, Math.min(SYM.sel, SYM.rows.length - 1));
  const vis = SYM.rows.slice(0, SYM.shown);
  box.innerHTML = vis.map((r, i) => {
    const t = tk[r.s.symbol], ch = t ? `<span class="${t.change >= 0 ? 'up' : 'dn'}">${t.change >= 0 ? '+' : ''}${t.change.toFixed(2)}%</span>` : '';
    return `<div class="srow${i === SYM.sel ? ' sel' : ''}" data-i="${i}">${icon(r.m.base)}
      <div class="smain"><div class="sname">${hl(r.s.symbol, SYM.q)}${r.s.contract === 'PERPETUAL' && SYM.mk === 'futures' ? '<span class="sp">.P</span>' : ''}</div><div class="sdesc">${hl(r.m.desc, SYM.q)} <span class="sbadge">${r.m.badge}</span></div></div>
      <div class="sright">${ch}<span class="sx">Binance</span><i class="sstar${r.fav ? ' on' : ''}" data-fav title="Favorite">${r.fav ? '★' : '☆'}</i></div></div>`;
  }).join('') || '<div class="sempty">No symbols found</div>';
  const cur = box.querySelector('.srow.sel'); if (cur) cur.scrollIntoView({ block: 'nearest' });
}
async function pickSymbol(sym, mk) {
  closeSymModal();
  if (mk && mk !== S.market) { S.market = mk; $('#marketSel').value = mk; save(); await loadSymbols(); }
  setSymbol(sym);
}
let symKeyFn = null;
function closeSymModal() { const m = $('#symModal'); if (m) m.remove(); if (symKeyFn) { window.removeEventListener('keydown', symKeyFn, true); symKeyFn = null; } try { $('#symInput').blur(); } catch (e) { /* ignore */ } }
async function openSymModal(prefill) {
  if ($('#symModal')) { closeSymModal(); return; }
  SYM.mk = S.market; SYM.q = prefill || ''; SYM.sel = 0; SYM.shown = 60; SYM.quote = SYM.quote || 'ALL';
  const m = document.createElement('div'); m.id = 'symModal';
  m.innerHTML = `<div id="symBox"><div class="shead"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M16 16l5 5"/></svg><input id="symQ" placeholder="Search (e.g. BTC, Zcash, ARBUSDT)" spellcheck="false" autocomplete="off"><button id="symX" title="Close (Esc)">✕</button></div>
    <div class="schips"><span class="chipf" data-mk="futures">Futures</span><span class="chipf" data-mk="spot">Spot</span><span class="sepv"></span>
      ${['ALL', 'USDT', 'USDC', 'FDUSD', 'BTC'].map(q => `<span class="chipf" data-q="${q}">${q === 'ALL' ? 'All quotes' : q}</span>`).join('')}<span class="sepv"></span><span class="chipf" data-fav>★ Favorites</span></div>
    <div id="symRows"></div><div class="sfoot">↑↓ navigate · Enter select · Esc close · click ☆ to favorite</div></div>`;
  document.body.appendChild(m);
  const inp = $('#symQ'); inp.value = SYM.q;
  const chips = () => { m.querySelectorAll('[data-mk]').forEach(c => c.classList.toggle('on', c.dataset.mk === SYM.mk)); m.querySelectorAll('[data-q]').forEach(c => c.classList.toggle('on', c.dataset.q === SYM.quote)); m.querySelector('[data-fav]').classList.toggle('on', SYM.favOnly); };
  chips(); symRender(); inp.focus();
  m.addEventListener('mousedown', e => { if (e.target === m) closeSymModal(); });
  $('#symX').onclick = closeSymModal;
  inp.oninput = () => { SYM.q = inp.value; SYM.sel = 0; SYM.shown = 60; symRender(); };
  m.querySelector('.schips').onclick = async e => {
    const c = e.target.closest('.chipf'); if (!c) return;
    if (c.dataset.mk) { SYM.mk = c.dataset.mk; await symEnsure(SYM.mk); }
    else if (c.dataset.q) SYM.quote = c.dataset.q; else SYM.favOnly = !SYM.favOnly;
    SYM.sel = 0; SYM.shown = 60; chips(); symRender(); inp.focus();
  };
  $('#symRows').onclick = e => {
    const row = e.target.closest('.srow'); if (!row) return; const r = SYM.rows[+row.dataset.i];
    if (e.target.dataset.fav !== undefined) { const k = SYM.mk + ':' + r.s.symbol, f = favs(), i = f.indexOf(k); if (i >= 0) f.splice(i, 1); else f.push(k); save(); symRender(); return; }
    pickSymbol(r.s.symbol, SYM.mk);
  };
  $('#symRows').onscroll = e => { const el = e.target; if (el.scrollTop + el.clientHeight > el.scrollHeight - 120 && SYM.shown < SYM.rows.length) { SYM.shown += 60; const st = el.scrollTop; symRender(); el.scrollTop = st; } };
  $('#symRows').onmousemove = e => { const row = e.target.closest('.srow'); if (row && +row.dataset.i !== SYM.sel) { const old = $('#symRows .srow.sel'); if (old) old.classList.remove('sel'); row.classList.add('sel'); SYM.sel = +row.dataset.i; } };
  symKeyFn = e => {
    if (!$('#symModal')) return;
    if (e.key === 'Escape') { closeSymModal(); e.stopPropagation(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); SYM.sel = Math.min(SYM.sel + 1, Math.min(SYM.rows.length, SYM.shown) - 1); symRender(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); SYM.sel = Math.max(SYM.sel - 1, 0); symRender(); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = SYM.rows[SYM.sel]; if (r) pickSymbol(r.s.symbol, SYM.mk); else if (SYM.q.trim()) pickSymbol(SYM.q.trim().toUpperCase(), SYM.mk); }
    else if (e.target !== inp && e.key.length === 1 && !e.ctrlKey && !e.metaKey) inp.focus();
  };
  window.addEventListener('keydown', symKeyFn, true);
  await symEnsure(SYM.mk);
  symRender();
}
window.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || !/[a-z0-9]/i.test(e.key)) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') || $('#symModal') || $('#modal:not(.hidden)')) return;
  e.preventDefault(); openSymModal(e.key.toUpperCase());
});

/* drawing helpers */
const dashOf = st => st === 'dashed' ? [7, 4] : st === 'dotted' ? [2, 3] : [];
const tfClass = () => { const s = TF_SEC[S.tf]; return s < 60 ? 's' : s < 3600 ? 'm' : s < 86400 ? 'h' : s < 604800 ? 'd' : 'w'; };
const visibleOn = d => !d.vis || d.vis[tfClass()] !== false;
