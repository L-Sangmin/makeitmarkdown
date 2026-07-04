// Article drop target.
//
// Readers land on articles from a search for their problem, file in hand.
// The CTA drop target mirrors the homepage one: dropping a file stashes
// the File objects in IndexedDB and jumps to the tool page, which picks
// them up and converts immediately (main.js, consumeRelay). Clicking just
// opens the converter (keeping any sample deep-link). Nothing is uploaded —
// IndexedDB is local, and the entry is deleted the moment it is read.
(function () {
  var target = document.querySelector(".article-cta .drop-target");
  if (!target) return;

  var href = target.dataset.href || "/";
  target.addEventListener("click", function () { location.href = href; });

  // Articles that promise a specific preset ("convert with the Obsidian
  // preset") carry it in data-href; the drop redirect must keep that
  // promise too, not fall back to the default preset.
  var presetId = "";
  try {
    presetId = new URL(href, location.origin).searchParams.get("preset") || "";
  } catch (err) {}
  var dropHref = presetId
    ? "/?preset=" + encodeURIComponent(presetId) + "#dropped"
    : "/#dropped";

  if (!("indexedDB" in window)) return;

  function openDb() {
    return new Promise(function (resolve, reject) {
      var rq = indexedDB.open("mim-relay", 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore("files"); };
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
    });
  }

  // A missed drop anywhere else on the page should not navigate the tab
  // away to the raw file.
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); });

  target.addEventListener("dragover", function (e) {
    e.preventDefault();
    target.classList.add("is-dragover");
  });
  target.addEventListener("dragleave", function () {
    target.classList.remove("is-dragover");
  });
  target.addEventListener("drop", function (e) {
    e.preventDefault();
    target.classList.remove("is-dragover");
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    var list = [].slice.call(files);
    openDb()
      .then(function (db) {
        var tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put({ files: list, ts: Date.now() }, "pending");
        tx.oncomplete = function () { location.href = dropHref; };
        tx.onerror = function () { location.href = "/"; };
      })
      .catch(function () { location.href = "/"; });
  });
})();
