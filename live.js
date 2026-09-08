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
  var rpcs = ["https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com", "https://eth.llamarpc.com"];
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
      set("fng-v", String(v));
      var label = (rows[0].value_classification || "").toLowerCase();
      var wk = rows[7] ? parseInt(rows[7].value, 10) : null;
      set("fng-s", label + (wk ? " · " + wk + " a week ago" : ""));
    })
    .catch(function () { fail("fng-v", "fng-s"); });

  // btc, 7 days
  get("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7")
    .then(function (d) {
      var pts = (d.prices || []).map(function (p) { return p[1]; });
      var svg = $("spark");
      if (!svg || pts.length < 10) return;
      var W = 600, H = 64, lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts);
      var path = pts.map(function (p, i) {
        var x = (W * i) / (pts.length - 1), y = H - ((p - lo) / ((hi - lo) || 1)) * (H - 6) - 3;
        return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }).join("");
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      svg.innerHTML = '<path class="area" d="' + path + " L" + W + " " + H + " L0 " + H + ' Z"/><path d="' + path + '"/>';
      var chg = ((pts[pts.length - 1] / pts[0]) - 1) * 100;
      set("spark-cap", "btc, 7 days · " + fmtPct(chg), chg >= 0 ? "up" : "down");
    })
    .catch(function () { set("spark-cap", "btc, 7 days · unavailable"); });

  var now = new Date();
  set("live-at", "updated " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
})();
