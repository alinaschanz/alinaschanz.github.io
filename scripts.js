/* repository status from the public github api: last push, open issues, stars, the last
   ci run, and the latest commits. sixty anonymous requests an hour per ip; this page makes
   fourteen at most (the list, one ci run per card, the events, three commits) and says so
   when it hits the wall. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var API = "https://api.github.com";
  var OWNER = "alinaschanz";
  var OFF = false;
  try { OFF = localStorage.getItem("live") === "off"; } catch (e) { /* on */ }

  function get(url) {
    return fetch(url, { headers: { Accept: "application/vnd.github+json" } }).then(function (r) {
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
  function span(cls, text) { var s = document.createElement("span"); if (cls) s.className = cls; s.textContent = text; return s; }
  function status(card, nodes) {
    var row = card.querySelector(".row");
    row.innerHTML = "";
    nodes.forEach(function (n) { row.appendChild(n); });
  }

  var cards = {};
  Array.prototype.forEach.call(document.querySelectorAll(".repo-card[data-repo]"), function (c) { cards[c.getAttribute("data-repo")] = c; });

  if (OFF) {
    Object.keys(cards).forEach(function (k) { status(cards[k], [span("muted", "live numbers are off")]); });
    var gc0 = $("gh-commits");
    if (gc0) gc0.innerHTML = '<li class="muted">live numbers are off. <a href="/privacy/">privacy</a></li>';
    return;
  }

  get(API + "/users/" + OWNER + "/repos?per_page=20&sort=pushed")
    .then(function (repos) {
      (repos || []).forEach(function (r) {
        var card = cards[r.name];
        if (!card) return;
        var nodes = [span("", "pushed " + ago(r.pushed_at)), span("", (r.stargazers_count || 0) + " star" + (r.stargazers_count === 1 ? "" : "s")),
          span("", (r.open_issues_count || 0) + " open issue" + (r.open_issues_count === 1 ? "" : "s"))];
        if (r.license && r.license.spdx_id && r.license.spdx_id !== "NOASSERTION") nodes.push(span("", r.license.spdx_id.toLowerCase()));
        var ci = span("", "ci …");
        nodes.push(ci);
        status(card, nodes);
        if (r.name === OWNER + ".github.io") { ci.textContent = "pages"; return; }
        get(API + "/repos/" + OWNER + "/" + r.name + "/actions/runs?per_page=1&event=push")
          .then(function (d) {
            var run = (d.workflow_runs || [])[0];
            if (!run) { ci.textContent = "ci: no run yet"; return; }
            var c = run.conclusion || run.status;
            ci.textContent = "ci " + c;
            ci.className = c === "success" ? "ok" : (c === "failure" ? "bad" : "");
          })
          .catch(function () { ci.textContent = "ci: unavailable"; });
      });
      Object.keys(cards).forEach(function (k) {
        if (cards[k].querySelector(".row .st")) status(cards[k], [span("muted", "not on github yet")]);
      });
    })
    .catch(function () {
      Object.keys(cards).forEach(function (k) { status(cards[k], [span("muted", "status unavailable (api limit)")]); });
    });

  // the events api carries the head sha of a push, not the message; the newest three
  // heads are looked up once more so the list reads like a log.
  var gh = $("gh-commits");
  if (gh) {
    get(API + "/users/" + OWNER + "/events/public?per_page=30")
      .then(function (events) {
        var rows = [], seen = {};
        (events || []).forEach(function (e) {
          if (e.type !== "PushEvent" || !e.payload || !e.payload.head || rows.length >= 8) return;
          var k = e.repo.name + "@" + e.payload.head;
          if (seen[k]) return;
          seen[k] = 1;
          rows.push({ repo: e.repo.name.replace(OWNER + "/", ""), full: e.repo.name, sha: e.payload.head,
            ref: (e.payload.ref || "").replace("refs/heads/", ""), at: e.created_at, msg: "" });
        });
        if (!rows.length) throw new Error("none");
        function render() {
          gh.innerHTML = "";
          rows.forEach(function (r) {
            var a = document.createElement("a");
            a.href = "https://github.com/" + r.full + "/commit/" + r.sha;
            a.rel = "noopener";
            var text = r.msg || ("pushed " + r.sha.slice(0, 7) + (r.ref ? " to " + r.ref : ""));
            a.textContent = text.length > 110 ? text.slice(0, 109) + "…" : text;
            var msg = span("msg", ""); msg.appendChild(span("repo", r.repo)); msg.appendChild(a);
            var li = document.createElement("li"); li.appendChild(msg); li.appendChild(span("when", ago(r.at)));
            gh.appendChild(li);
          });
        }
        render();
        var note = $("gh-note");
        if (note) note.textContent = "· fetched by your browser just now";
        rows.slice(0, 3).forEach(function (r) {
          get(API + "/repos/" + r.full + "/commits/" + r.sha)
            .then(function (c) { r.msg = ((c.commit || {}).message || "").split("\n")[0]; render(); })
            .catch(function () { /* the sha line stays */ });
        });
      })
      .catch(function () { gh.innerHTML = '<li class="muted">unavailable right now (github limits anonymous requests).</li>'; });
  }
})();
