/* the daily base fee dataset, read from the gasweek repository on github.
   one csv, parsed here, drawn as an svg. nothing is stored. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var CSV = "https://raw.githubusercontent.com/alinaschanz/gasweek/main/data/daily.csv";
  var OFF = false;
  try { OFF = localStorage.getItem("live") === "off"; } catch (e) { /* on */ }

  function set(id, text) {
    var el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove("skeleton");
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function gwei(x) { return x < 1 ? x.toPrecision(2) : x.toFixed(2); }
  function hh(h) { return (h < 10 ? "0" : "") + h + ":00"; }

  if (OFF) {
    ["d-days", "d-median", "d-cheap", "d-full"].forEach(function (id) { set(id, "off"); });
    set("gas-note", "live numbers are off, so daily.csv was not fetched. turn them on at /privacy/ or open the csv on github.");
    var tb = $("gas-table").querySelector("tbody");
    tb.innerHTML = '<tr><td colspan="12" class="muted">off</td></tr>';
    return;
  }

  function parse(text) {
    var lines = text.trim().split(/\r?\n/);
    var cols = lines.shift().split(",");
    return lines.filter(Boolean).map(function (l) {
      var v = l.split(","), row = {};
      cols.forEach(function (c, i) { row[c] = i === 0 ? v[i] : parseFloat(v[i]); });
      return row;
    }).filter(function (r) { return r.date_utc && isFinite(r.median_gwei); });
  }

  function draw(rows) {
    var svg = $("gas-chart");
    var W = 600, H = 220, padL = 44, padR = 10, padT = 12, padB = 8;
    var n = rows.length;
    var vals = [];
    rows.forEach(function (r) { vals.push(r.p25_gwei, r.p75_gwei, r.median_gwei, r.max_gwei, r.min_gwei); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    // log scale: base fees span orders of magnitude, a linear axis hides the band under the max
    var L = function (v) { return Math.log10(Math.max(v, 1e-4)); };
    var ylo = Math.floor(L(lo)), yhi = Math.ceil(L(hi));
    if (yhi <= ylo) yhi = ylo + 1;
    var X = function (i) { return n === 1 ? (padL + W - padR) / 2 : padL + (W - padL - padR) * i / (n - 1); };
    var Y = function (v) { return padT + (H - padT - padB) * (1 - (L(v) - ylo) / (yhi - ylo)); };
    var out = [];
    // grid at each power of ten
    for (var e = ylo; e <= yhi; e++) {
      var y = Y(Math.pow(10, e));
      out.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="var(--line)" stroke-width="1"/>');
      out.push('<text x="' + (padL - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="10" font-family="var(--mono)" fill="var(--faint)">' + (e < 0 ? Math.pow(10, e).toFixed(-e) : Math.pow(10, e)) + '</text>');
    }
    if (n >= 2) {
      var band = rows.map(function (r, i) { return X(i).toFixed(1) + " " + Y(r.p75_gwei).toFixed(1); })
        .concat(rows.slice().reverse().map(function (r, i) { return X(n - 1 - i).toFixed(1) + " " + Y(r.p25_gwei).toFixed(1); }));
      out.push('<polygon points="' + band.join(" ") + '" fill="var(--accent)" opacity=".18"/>');
      out.push('<polyline points="' + rows.map(function (r, i) { return X(i).toFixed(1) + "," + Y(r.max_gwei).toFixed(1); }).join(" ") + '" fill="none" stroke="var(--amber)" stroke-width="1.4" stroke-dasharray="3 3"/>');
      out.push('<polyline points="' + rows.map(function (r, i) { return X(i).toFixed(1) + "," + Y(r.median_gwei).toFixed(1); }).join(" ") + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
    }
    rows.forEach(function (r, i) {
      var x = X(i);
      if (n === 1) {
        out.push('<line x1="' + x + '" x2="' + x + '" y1="' + Y(r.p25_gwei).toFixed(1) + '" y2="' + Y(r.p75_gwei).toFixed(1) + '" stroke="var(--accent)" stroke-width="10" opacity=".18"/>');
        out.push('<circle cx="' + x + '" cy="' + Y(r.max_gwei).toFixed(1) + '" r="3" fill="var(--amber)"/>');
      }
      if (n <= 40) out.push('<circle cx="' + x.toFixed(1) + '" cy="' + Y(r.median_gwei).toFixed(1) + '" r="' + (n === 1 ? 4 : 2.5) + '" fill="var(--accent)"/>');
    });
    svg.innerHTML = out.join("");
    var axis = $("gas-axis");
    if (axis) {
      var labels = n === 1 ? [rows[0].date_utc] : [rows[0].date_utc, rows[Math.floor((n - 1) / 2)].date_utc, rows[n - 1].date_utc];
      axis.innerHTML = labels.map(function (d) { return "<span>" + esc(d) + "</span>"; }).join("");
    }
    set("gas-scale", "log scale, gwei");
  }

  function table(rows) {
    var tb = $("gas-table").querySelector("tbody");
    var last = rows.slice().reverse().slice(0, 60);
    tb.innerHTML = last.map(function (r) {
      return "<tr><td>" + esc(r.date_utc) + "</td><td>" + r.blocks.toLocaleString("en-US") + "</td><td>" + gwei(r.min_gwei) + "</td><td>" + gwei(r.p25_gwei) +
        "</td><td>" + gwei(r.median_gwei) + "</td><td>" + gwei(r.p75_gwei) + "</td><td>" + gwei(r.p90_gwei) + "</td><td>" + gwei(r.max_gwei) +
        "</td><td>" + hh(r.cheapest_hour_utc) + "</td><td>" + hh(r.priciest_hour_utc) + "</td><td>" + Math.round(r.gas_used_ratio_mean * 100) + "%</td><td>" + gwei(r.blob_median_gwei) + "</td></tr>";
    }).join("");
  }

  fetch(CSV, { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
    .then(function (text) {
      var rows = parse(text);
      if (!rows.length) throw new Error("empty");
      var last = rows[rows.length - 1];
      set("d-days", String(rows.length));
      set("d-since", "since " + rows[0].date_utc);
      set("d-median", gwei(last.median_gwei) + " gwei");
      set("d-date", last.date_utc + " · p25 " + gwei(last.p25_gwei) + " · p75 " + gwei(last.p75_gwei));
      set("d-cheap", hh(last.cheapest_hour_utc));
      set("d-cheap-s", "utc · priciest " + hh(last.priciest_hour_utc));
      set("d-full", Math.round(last.gas_used_ratio_mean * 100) + "%");
      draw(rows);
      table(rows);
      var pricey = rows.map(function (r) { return r.max_gwei; });
      var mx = Math.max.apply(null, pricey), at = rows[pricey.indexOf(mx)].date_utc;
      set("gas-note", rows.length + (rows.length === 1 ? " day" : " days") + " of rows, the newest for " + last.date_utc + " (blocks " +
        last.first_block.toLocaleString("en-US") + " to " + last.last_block.toLocaleString("en-US") + "). highest base fee seen in the set: " + gwei(mx) + " gwei on " + at +
        ". a row is added every night at 00:17 utc." + (rows.length < 7 ? " the chart gets interesting after a week." : ""));
    })
    .catch(function () {
      ["d-days", "d-median", "d-cheap", "d-full"].forEach(function (id) { set(id, "—"); });
      set("gas-note", "could not read daily.csv from github right now. the file itself is linked below.");
      $("gas-table").querySelector("tbody").innerHTML = '<tr><td colspan="12" class="muted">unavailable</td></tr>';
    });
})();
