/* live numbers on the front page. public apis, no keys, fails quietly.
   the switch on /privacy/ turns every request off; the clock keeps running. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var fmtUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  var fmtPct = function (x) { return (x >= 0 ? "+" : "") + x.toFixed(1) + "%"; };
  var OFF = false;
  try { OFF = localStorage.getItem("live") === "off"; } catch (e) { /* storage blocked: treat as on */ }

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
  function ago(iso) {
    var s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  }

  // berlin, right now: local time. no network needed.
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

  if (OFF) {
    ["btc-v", "eth-v", "gas-v", "fng-v", "bln-temp"].forEach(function (id) { set(id, "off"); });
    ["btc-s", "eth-s", "gas-s", "fng-s"].forEach(function (id) { set(id, "live numbers are off"); });
    set("bln-wx", "live numbers are off");
    set("spark-cap", "btc, 7 days · off");
    set("live-at", "off");
    var p = document.querySelector(".pulse");
    if (p) p.classList.add("off");
    var foot = document.querySelector(".live-foot");
    if (foot) foot.innerHTML = 'live numbers are off. nothing was fetched. turn them on at <a href="/privacy/">privacy</a>.';
    var gc = $("gh-commits");
    if (gc) gc.innerHTML = '<li class="muted">live numbers are off. <a href="/privacy/">privacy</a></li>';
    return;
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
  function drawSpark(pts, source) {
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
    set("spark-cap", "btc, 7 days · " + fmtPct(chg) + " · " + fmtUsd.format(lo) + " – " + fmtUsd.format(hi) + " · " + source, chg >= 0 ? "up" : "down");
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
    viaCoinGecko().then(function (p) { drawSpark(p, "coingecko"); })
      .catch(function () { return viaCoinbase().then(function (p) { drawSpark(p, "coinbase"); }); })
      .catch(function () { return viaCryptoCompare().then(function (p) { drawSpark(p, "cryptocompare"); }); })
      .catch(function () { set("spark-cap", "btc, 7 days · unavailable"); });
  }, 1200);

  // berlin weather (open-meteo, no key)
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

  // latest pushes, from the public github events api (60 requests an hour per ip). the
  // events carry the head sha, not the message, so the newest three are looked up once more.
  var gh = $("gh-commits");
  if (gh) {
    get("https://api.github.com/users/alinaschanz/events/public?per_page=30")
      .then(function (events) {
        var rows = [], seen = {};
        (events || []).forEach(function (e) {
          if (e.type !== "PushEvent" || !e.payload || !e.payload.head || rows.length >= 5) return;
          var k = e.repo.name + "@" + e.payload.head;
          if (seen[k]) return;
          seen[k] = 1;
          rows.push({ repo: e.repo.name.replace("alinaschanz/", ""), full: e.repo.name, sha: e.payload.head,
            ref: (e.payload.ref || "").replace("refs/heads/", ""), at: e.created_at, msg: "" });
        });
        if (!rows.length) throw new Error("no pushes");
        function render() {
          gh.innerHTML = "";
          rows.forEach(function (r) {
            var a = document.createElement("a");
            a.href = "https://github.com/" + r.full + "/commit/" + r.sha;
            a.rel = "noopener";
            var text = r.msg || ("pushed " + r.sha.slice(0, 7) + (r.ref ? " to " + r.ref : ""));
            a.textContent = text.length > 96 ? text.slice(0, 95) + "…" : text;
            var repo = document.createElement("span"); repo.className = "repo"; repo.textContent = r.repo;
            var msg = document.createElement("span"); msg.className = "msg"; msg.appendChild(repo); msg.appendChild(a);
            var when = document.createElement("span"); when.className = "when"; when.textContent = ago(r.at);
            var li = document.createElement("li"); li.appendChild(msg); li.appendChild(when);
            gh.appendChild(li);
          });
        }
        render();
        var note = $("gh-note");
        if (note) note.textContent = "· fetched by your browser just now";
        rows.slice(0, 3).forEach(function (r) {
          get("https://api.github.com/repos/" + r.full + "/commits/" + r.sha)
            .then(function (c) { r.msg = ((c.commit || {}).message || "").split("\n")[0]; render(); })
            .catch(function () { /* the sha line stays */ });
        });
      })
      .catch(function () { gh.innerHTML = '<li class="muted">unavailable right now (github limits anonymous requests). the repositories are one click away above.</li>'; });
  }

  var now = new Date();
  set("live-at", "updated " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
})();
