// Recent conversions — localStorage only, this browser only. Stores the
// converted Markdown plus enough of the result schema to rebuild the
// Markdown and fidelity panels. Figure binaries and the original file are
// deliberately NOT kept (size + the privacy promise stays simple).

const KEY = "mim-history";
export const HISTORY_LIMIT = 5;
const MAX_ENTRY_CHARS = 600_000; // serialized entry guard (~localStorage budget)

export function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false; // quota exceeded / private mode — history is best-effort
  }
}

export function saveToHistory(payload, preset) {
  const result = {
    ...payload.result,
    figures: (payload.result.figures ?? []).map((f) => ({ ...f, url: "" })),
  };
  const entry = {
    filename: payload.filename,
    ts: Date.now(),
    preset,
    markdown: payload.markdown,
    result,
  };
  if (JSON.stringify(entry).length > MAX_ENTRY_CHARS) return false;

  const entries = loadHistory().filter((e) => e.filename !== entry.filename);
  entries.unshift(entry);
  return persist(entries.slice(0, HISTORY_LIMIT));
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
