// UI entry point. Landing screen only — conversion wiring comes later.
//
// Phase 1 frame (HANDOFF §1.5):
// - First screen: one big input target, privacy note beneath it,
//   no pipeline-explainer sidebar.
// - Result screen: 3-panel trust view — original preview | converted
//   Markdown (Standard/Obsidian toggle + presets) | fidelity report.
// - Input-mode names (A/B/C) are internal concepts; never surface in UI.

const THEME_KEY = "mim-theme";
const root = document.documentElement;

// Initial theme is applied by the inline <head> script (pre-paint).
// The toggle flips relative to whatever is currently in effect.
function currentTheme() {
  return (
    root.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
}

document.getElementById("theme-toggle")?.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* private mode — theme just won't persist */
  }
});
