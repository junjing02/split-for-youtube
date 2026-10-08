// Light/dark theme. Loaded in <head> (blocking, tiny) so the theme is set
// before the first paint: no flash of the wrong one. The visitor's choice
// is kept in localStorage; until they choose, the page follows the system
// setting and keeps following it if that changes. style.css keys its dark
// tokens off html[data-theme], with a prefers-color-scheme fallback for
// when this script doesn't run.
(function () {
  var KEY = "sfy-theme";
  var root = document.documentElement;
  var system = window.matchMedia("(prefers-color-scheme: dark)");

  function saved() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : null;
    } catch (e) {
      return null;
    }
  }

  function apply(theme) {
    root.setAttribute("data-theme", theme);
    var button = document.querySelector(".theme-toggle");
    if (button) {
      button.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
      button.setAttribute("aria-pressed", String(theme === "dark"));
    }
  }

  apply(saved() || (system.matches ? "dark" : "light"));

  system.addEventListener("change", function (e) {
    if (!saved()) apply(e.matches ? "dark" : "light");
  });

  document.addEventListener("DOMContentLoaded", function () {
    var button = document.querySelector(".theme-toggle");
    if (!button) return;
    apply(root.getAttribute("data-theme")); // set the button's labels now that it exists
    button.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch (e) {
        // private mode etc.: the choice just lasts for this page view
      }
      apply(next);
    });
  });
})();
