// Toolbar panel: one switch for two-window mode, stored in
// chrome.storage.local ("twoWindowMode"). The background worker and the
// YouTube tabs react to the storage change themselves.
const toggle = document.getElementById("twoWindows");

chrome.storage.local.get("twoWindowMode").then((stored) => {
  toggle.checked = !!stored.twoWindowMode;
});

toggle.addEventListener("change", () => {
  chrome.storage.local.set({ twoWindowMode: toggle.checked });
});
