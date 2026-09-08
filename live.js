/* live numbers on the front page. public apis, no keys, fails quietly.
   every tile has more than one source: coingecko is rate limited per visitor ip, and a vpn
   exit or a content blocker can shut one host off, so the next one is tried before a tile
   gives up. the switch on /privacy/ turns every request off; the clock keeps running. */
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
    el.classList.remove("skeleton", "up", "down", "amber");
    if (cls) el.classList.add(cls);
  }
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function get(url, opts, retry) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, 9000) : null;
    var o = Object.assign({ signal: ctrl ? ctrl.signal : undefined }, opts || {});
    return fetch(url, o).then(function (r) {
      if (t) clearTimeout(t);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }).catch(function (e) {
      if (t) clearTimeout(t);
      // one more try after a pause when the network said no. a 4xx is an answer (a rate
      // limit, mostly) and asking again would not change it: move on to the next source.
      if (retry !== false && !/^4\d\d$/.test(String(e && e.message))) {
        return wait(1500).then(function () { return get(url, opts, false); });
      }
      throw e;
    });
  }
  // the first source that answers wins
  function firstOf(fns) {
    return fns.reduce(function (p, fn) { return p.catch(function () { return fn(); }); }, Promise.reject(new Error("start")));
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

  // when a tile gives up, say why it usually happens and offer another go
  var FOOT = null;
  function fail(id, sub) {
    set(id, "—");
    if (sub) set(sub, "unavailable");
    var foot = document.querySelector(".live-foot");
    if (!foot || $("live-retry")) return;
    if (FOOT === null) FOOT = foot.innerHTML;
    foot.innerHTML = 'a source did not answer. a vpn exit, a content blocker or a rate limit usually explains it; ' +
      'nothing is stored either way. <a href="#" id="live-retry">try again</a> · ' + FOOT;
    var a = $("live-retry");
    if (a) a.addEventListener("click", function (ev) { ev.preventDefault(); run(); });
  }

  // prices: coingecko, then coinbase (open is 24 h ago, so the change comes out the same),
  // then kraken (spot only)
  function pricesCoinGecko() {
    return get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true")
      .then(function (d) {
        function row(x) { if (!x || !(x.usd > 0)) throw new Error("no price"); return [x.usd, x.usd_24h_change]; }
        return { btc: row(d.bitcoin), eth: row(d.ethereum), src: "coingecko" };
      });
  }
  function pricesCoinbase() {
    return Promise.all(["BTC", "ETH"].map(function (s) { return get("https://api.exchange.coinbase.com/products/" + s + "-USD/stats"); }))
      .then(function (r) {
        function row(x) {
          var last = parseFloat(x.last), open = parseFloat(x.open);
          if (!(last > 0)) throw new Error("no price");
          return [last, open > 0 ? (last / open - 1) * 100 : null];
        }
        return { btc: row(r[0]), eth: row(r[1]), src: "coinbase" };
      });
  }
  function pricesKraken() {
    return get("https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD")
      .then(function (d) {
        var res = d.result || {};
        function row(x) { var last = x && x.c ? parseFloat(x.c[0]) : 0; if (!(last > 0)) throw new Error("no price"); return [last, null]; }
        return { btc: row(res.XXBTZUSD), eth: row(res.XETHZUSD), src: "kraken" };
      });
  }
  function prices() {
    firstOf([pricesCoinGecko, pricesCoinbase, pricesKraken])
      .then(function (q) {
        [["btc", q.btc], ["eth", q.eth]].forEach(function (pair) {
          set(pair[0] + "-v", fmtUsd.format(pair[1][0]));
          var c = pair[1][1];
          if (typeof c === "number") set(pair[0] + "-s", fmtPct(c) + " · 24h", c >= 0 ? "up" : "down");
          else set(pair[0] + "-s", "spot · " + q.src);
        });
      })
      .catch(function () { fail("btc-v", "btc-s"); fail("eth-v", "eth-s"); });
  }

  // ethereum base fee, next block: four public rpcs, in this order
  var RPCS = ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://gateway.tenderly.co/public/mainnet", "https://rpc.mevblocker.io"];
  function baseFee() {
    firstOf(RPCS.map(function (url) {
      return function () {
        return get(url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_feeHistory", params: ["0x1", "latest", []] })
        }).then(function (d) {
          var arr = d.result && d.result.baseFeePerGas;
          if (!arr || !arr.length) throw new Error("no fee");
          return d.result;
        });
      };
    })).then(function (r) {
      var arr = r.baseFeePerGas, gwei = parseInt(arr[arr.length - 1], 16) / 1e9;
      set("gas-v", (gwei < 1 ? gwei.toPrecision(2) : gwei.toFixed(1)) + " gwei");
      var blob = r.baseFeePerBlobGas;
      if (blob && blob.length) {
        var b = parseInt(blob[blob.length - 1], 16) / 1e9;
        set("gas-s", "blob " + (b < 1 ? b.toPrecision(2) : b.toFixed(1)) + " gwei");
      } else {
        set("gas-s", "base fee, next block");
      }
    }).catch(function () { fail("gas-v", "gas-s"); });
  }

  // fear & greed: one public source, so it gets the retry inside get() and nothing else
  function fearGreed() {
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
  }

  // btc, 7 days: coingecko, then coinbase hourly candles, then kraken hourly candles
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
  function sparkCoinGecko() {
    return get("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7")
      .then(function (d) { drawSpark((d.prices || []).map(function (p) { return p[1]; }), "coingecko"); });
  }
  function sparkCoinbase() {
    // candles come newest first: [time, low, high, open, close, volume]
    return get("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600")
      .then(function (d) { drawSpark((d || []).slice(0, 168).reverse().map(function (c) { return c[4]; }), "coinbase"); });
  }
  function sparkKraken() {
    // candles come oldest first: [time, open, high, low, close, vwap, volume, count]
    return get("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60")
      .then(function (d) { drawSpark(((d.result || {}).XXBTZUSD || []).slice(-168).map(function (c) { return parseFloat(c[4]); }), "kraken"); });
  }
  function spark() {
    set("spark-cap", "btc, 7 days");
    wait(1200).then(function () { return firstOf([sparkCoinGecko, sparkCoinbase, sparkKraken]); })
      .catch(function () { fail(null, "spark-cap"); });
  }

  // berlin weather (open-meteo, no key)
  var wx = { 0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog", 51: "drizzle", 53: "drizzle", 55: "drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain", 71: "snow", 73: "snow", 75: "snow", 80: "showers", 81: "showers", 82: "showers", 95: "thunderstorm" };
  function weather() {
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
  }

  // latest pushes, from the public github events api (60 requests an hour per ip). the
  // events carry the head sha, not the message, so the newest three are looked up once more.
  function github() {
    var gh = $("gh-commits");
    if (!gh) return;
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
          get("https://api.github.com/repos/" + r.full + "/commits/" + r.sha, null, false)
            .then(function (c) { r.msg = ((c.commit || {}).message || "").split("\n")[0]; render(); })
            .catch(function () { /* the sha line stays */ });
        });
      })
      .catch(function () { gh.innerHTML = '<li class="muted">unavailable right now (github limits anonymous requests). the repositories are one click away above.</li>'; });
  }

  function run() {
    var foot = document.querySelector(".live-foot");
    if (foot && FOOT !== null) foot.innerHTML = FOOT;
    prices();
    baseFee();
    fearGreed();
    spark();
    weather();
    github();
    set("live-at", "updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  }
  run();
})();
