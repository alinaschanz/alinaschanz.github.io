/* the one switch on this site: live numbers on or off. one word in local storage,
   on your side only. */
(function () {
  "use strict";
  var state = document.getElementById("live-state");
  var btn = document.getElementById("live-toggle");
  if (!state || !btn) return;
  function read() {
    try { return localStorage.getItem("live") !== "off"; } catch (e) { return true; }
  }
  function render(on) {
    state.innerHTML = on ? "live numbers are <b>on</b>. the pages call the hosts below when you open them."
                         : "live numbers are <b>off</b>. the pages call nobody; the tiles say so.";
    btn.textContent = on ? "turn them off" : "turn them on";
    btn.className = on ? "" : "off";
    btn.setAttribute("aria-pressed", on ? "false" : "true");
  }
  render(read());
  btn.addEventListener("click", function () {
    var on = read();
    try {
      if (on) localStorage.setItem("live", "off"); else localStorage.removeItem("live");
    } catch (e) {
      state.textContent = "your browser does not let this page store the setting. private mode does that.";
      return;
    }
    render(!on);
  });
})();
