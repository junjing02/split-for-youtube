// Toolbar panel: every control maps to one key in chrome.storage.local.
// The YouTube tabs and the background worker react to the storage change
// themselves, so this file only reads and writes settings.
const DEFAULTS = {
  splitEnabled: true,
  twoWindowMode: false,
  ambientEnabled: true,
  ambientStrength: 70,
  rememberLayout: false,
  videoOnRight: false,
};

const controls = Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, document.getElementById(key)]));
const options = document.getElementById("options");

// With the master switch off nothing else applies; with ambient light off
// the strength slider doesn't either.
function reflect() {
  const on = controls.splitEnabled.checked;
  options.classList.toggle("is-disabled", !on);
  for (const [key, el] of Object.entries(controls)) {
    if (key !== "splitEnabled") el.disabled = !on;
  }
  controls.ambientStrength.disabled = !on || !controls.ambientEnabled.checked;
}

chrome.storage.local.get(DEFAULTS).then((stored) => {
  for (const [key, el] of Object.entries(controls)) {
    if (el.type === "checkbox") el.checked = !!stored[key];
    else el.value = stored[key];
  }
  reflect();
});

for (const [key, el] of Object.entries(controls)) {
  el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
    const update = { [key]: el.type === "checkbox" ? el.checked : Number(el.value) };
    // Two windows is part of the split, so it can't stay on without it.
    if (key === "splitEnabled" && !el.checked) {
      update.twoWindowMode = false;
      controls.twoWindowMode.checked = false;
    }
    chrome.storage.local.set(update);
    reflect();
  });
}

// Keep the switches honest if something else changes a setting while the
// panel is open (a keyboard shortcut, or closing the second window).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const [key, el] of Object.entries(controls)) {
    if (!changes[key]) continue;
    const value = changes[key].newValue === undefined ? DEFAULTS[key] : changes[key].newValue;
    if (el.type === "checkbox") el.checked = !!value;
    else el.value = value;
  }
  reflect();
});

document.getElementById("version").textContent = "v" + chrome.runtime.getManifest().version;

// chrome:// pages can't be opened from a plain link.
document.getElementById("shortcuts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});
