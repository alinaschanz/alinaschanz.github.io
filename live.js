/* live numbers on the front page. public apis, no keys, fails quietly. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var fmtUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  var fmtPct = function (x) { return (x >= 0 ? "+" : "") + x.toFixed(1) + "%"; };

  function set(id, text, cls) {
    var el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove("skeleton");
    if (cls) el.classList.add(cls);
  }
  function fail(id, sub) {
    set(id, "—");
    if (sub) set(sub, "unavailable");
  }
  function get(url, opts) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, 9000) : null;
    var o = Object.assign({ signal: ctrl ? ctrl.signal : undefined }, opts || {});
    return fetch(url, o).then(function (r) {
      if (t) clearTimeout(t);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }

  // prices
  get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true")
    .then(function (d) {
      [["bitcoin", "btc"], ["ethereum", "eth"]].forEach(function (pair) {
        var row = d[pair[0]];
        if (!row) return fail(pair[1] + "-v", pair[1] + "-s");
        set(pair[1] + "-v", fmtUsd.format(row.usd));
        var c = row.usd_24h_change;
        if (typeof c === "number") set(pair[1] + "-s", fmtPct(c) + " · 24h", c >= 0 ? "up" : "down");
      });
    })
    .catch(function () { fail("btc-v", "btc-s"); fail("eth-v", "eth-s"); });

  // ethereum base fee, next block
  var rpcs = ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://rpc.mevblocker.io"];
  (function tryRpc(i) {
    if (i >= rpcs.length) return fail("gas-v", "gas-s");
    get(rpcs[i], {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_feeHistory", params: ["0x1", "latest", []] })
    }).then(function (d) {
      var arr = d.result && d.result.baseFeePerGas;
      if (!arr || !arr.length) throw new Error("no fee");
      var gwei = parseInt(arr[arr.length - 1], 16) / 1e9;
      set("gas-v", (gwei < 1 ? gwei.toPrecision(2) : gwei.toFixed(1)) + " gwei");
      var blob = d.result.baseFeePerBlobGas;
      if (blob && blob.length) {
        var b = parseInt(blob[blob.length - 1], 16) / 1e9;
        set("gas-s", "blob " + (b < 1 ? b.toPrecision(2) : b.toFixed(1)) + " gwei");
      } else {
        set("gas-s", "base fee, next block");
      }
    }).catch(function () { tryRpc(i + 1); });
  })(0);

  // fear & greed
  get("https://api.alternative.me/fng/?limit=8")
    .then(function (d) {
      var rows = d.data || [];
      if (!rows.length) throw new Error("empty");
      var v = parseInt(rows[0].value, 10);
      set("fng-v", String(v), v >= 60 ? "amber" : "");
      var label = (rows[0].value_classification || "").toLowerCase();
      var wk = rows[7] ? parseInt(rows[7].value, 10) : null;
      set("fng-s", label + (wk ? " · " + wk + " a week ago" : ""));
    })
    .catch(function () { fail("fng-v", "fng-s"); });

  // btc, 7 days. three public sources, first one that answers wins: coingecko is rate
  // limited per visitor ip, so coinbase and cryptocompare stand behind it.
  function drawSpark(pts) {
    var svg = $("spark");
    if (!svg || !pts || pts.length < 10) throw new Error("no points");
    var W = 600, H = 76, lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts);
    var path = pts.map(function (p, i) {
      var x = (W * i) / (pts.length - 1), y = H - ((p - lo) / ((hi - lo) || 1)) * (H - 8) - 4;
      return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }).join("");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.innerHTML =
      '<defs><linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="currentColor" stop-opacity=".22"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>' +
      '<path class="area" d="' + path + " L" + W + " " + H + " L0 " + H + ' Z"/><path d="' + path + '"/>';
    svg.style.color = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#146c66";
    var chg = ((pts[pts.length - 1] / pts[0]) - 1) * 100;
    set("spark-cap", "btc, 7 days · " + fmtPct(chg) + " · " + fmtUsd.format(lo) + " – " + fmtUsd.format(hi), chg >= 0 ? "up" : "down");
    // day labels, assuming hourly points ending now
    var axis = $("spark-axis");
    if (axis) {
      var days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], out = [], now = new Date();
      for (var k = 6; k >= 0; k--) { var dd = new Date(now.getTime() - k * 864e5); out.push("<span>" + days[dd.getDay()] + "</span>"); }
      axis.innerHTML = out.join("");
    }
  }
  function viaCoinGecko() {
    return get("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7")
      .then(function (d) { return (d.prices || []).map(function (p) { return p[1]; }); });
  }
  function viaCoinbase() {
    // candles come newest first: [time, low, high, open, close, volume]
    return get("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600")
      .then(function (d) { return (d || []).slice(0, 168).reverse().map(function (c) { return c[4]; }); });
  }
  function viaCryptoCompare() {
    return get("https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=168")
      .then(function (d) { return (((d || {}).Data || {}).Data || []).map(function (c) { return c.close; }); });
  }
  setTimeout(function () {
    viaCoinGecko().then(drawSpark)
      .catch(function () { return viaCoinbase().then(drawSpark); })
      .catch(function () { return viaCryptoCompare().then(drawSpark); })
      .catch(function () { set("spark-cap", "btc, 7 days · unavailable"); });
  }, 1200);

  // berlin, right now: local time and weather (open-meteo, no key)
  function berlinClock() {
    try {
      var t = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date());
      set("bln-time", t);
      var pill = $("pill-time");
      if (pill) pill.textContent = t;
    } catch (e) { /* old browser */ }
  }
  berlinClock();
  setInterval(berlinClock, 30000);
  var wx = { 0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog", 51: "drizzle", 53: "drizzle", 55: "drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain", 71: "snow", 73: "snow", 75: "snow", 80: "showers", 81: "showers", 82: "showers", 95: "thunderstorm" };
  get("https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.405&current=temperature_2m,weather_code&timezone=Europe%2FBerlin")
    .then(function (d) {
      var c = d.current || {};
      if (typeof c.temperature_2m !== "number") throw new Error("no temp");
      var word = wx[c.weather_code] || "";
      set("bln-temp", Math.round(c.temperature_2m) + "°C");
      set("bln-wx", word || "weather");
      var pill = $("pill-wx");
      if (pill) pill.textContent = Math.round(c.temperature_2m) + "°C" + (word ? ", " + word : "");
    })
    .catch(function () { set("bln-temp", "—"); set("bln-wx", "weather unavailable"); });

  var now = new Date();
  set("live-at", "updated " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
})();
