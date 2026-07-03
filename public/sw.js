// Service worker: the whole tool works offline after the first visit —
// the strongest proof that nothing is uploaded.
//
// Strategy:
// - app shell + core modules: precached, network-first on fetch (deploys win)
// - /assets/vendor/ and /assets/fonts/: cache-first (filenames are versioned)
// - everything else same-origin GET: network-first with cache fallback
//
// DEPLOY NOTE: bump VERSION on every deploy — it invalidates old caches.

const VERSION = "v2";
const CACHE = `mim-${VERSION}`;

const CORE = [
  "/",
  "/about.html",
  "/privacy.html",
  "/contact.html",
  "/manifest.webmanifest",
  "/assets/css/main.css",
  "/assets/css/article.css",
  "/assets/fonts/inter-var-latin.woff2",
  "/assets/fonts/jetbrains-mono-var-latin.woff2",
  "/assets/js/main.js",
  "/assets/js/router.js",
  "/assets/js/loader.js",
  "/assets/js/result-view.js",
  "/assets/js/zipper.js",
  "/assets/js/history.js",
  "/assets/js/presets.js",
  "/assets/js/standard-formatter.js",
  "/assets/js/obsidian-formatter.js",
  "/assets/js/md-utils.js",
  "/assets/js/ipynb-dag.js",
  "/assets/js/parsers/index.js",
  "/assets/js/parsers/ipynb.js",
  "/assets/js/parsers/docx.js",
  "/assets/js/parsers/csv.js",
  "/assets/js/parsers/xlsx.js",
  "/assets/js/parsers/json.js",
  "/assets/js/parsers/subtitles.js",
  "/assets/js/parsers/text.js",
  "/assets/js/parsers/html.js",
  "/assets/js/parsers/pdf.js",
  "/assets/vendor/purify-3.4.11.min.js",
  "/assets/vendor/marked-18.0.5.min.js",
  "/assets/vendor/jszip-3.10.1.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const IMMUTABLE = /^\/assets\/(vendor|fonts)\//;

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  if (IMMUTABLE.test(url.pathname)) {
    // versioned filenames — cache-first
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ??
          fetch(e.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
            return res;
          })
      )
    );
    return;
  }

  // everything else: network-first, cache fallback (offline)
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(e.request);
        if (hit) return hit;
        if (e.request.mode === "navigate") return caches.match("/");
        return Response.error();
      })
  );
});
