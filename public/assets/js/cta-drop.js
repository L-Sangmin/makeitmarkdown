// Article CTA drop relay.
//
// Readers land on articles from a search for their problem, file in hand.
// Dropping it on the CTA box stashes the File objects in IndexedDB and
// jumps to the tool page, which picks them up and converts immediately
// (main.js, consumeRelay). Nothing is uploaded — IndexedDB is local, and
// the entry is deleted the moment it is read.
(function () {
  var cta = document.querySelector(".article-cta");
  if (!cta || !("indexedDB" in window)) return;

  cta.classList.add("cta-drop");
  var hint = document.createElement("p");
  hint.className = "cta-drop-hint";
  hint.textContent = "…or drop your file right here — it opens straight in the converter.";
  cta.appendChild(hint);

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

  cta.addEventListener("dragover", function (e) {
    e.preventDefault();
    cta.classList.add("is-dragover");
  });
  cta.addEventListener("dragleave", function () {
    cta.classList.remove("is-dragover");
  });
  cta.addEventListener("drop", function (e) {
    e.preventDefault();
    cta.classList.remove("is-dragover");
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    var list = [].slice.call(files);
    openDb()
      .then(function (db) {
        var tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put({ files: list, ts: Date.now() }, "pending");
        tx.oncomplete = function () { location.href = "/#dropped"; };
        tx.onerror = function () { location.href = "/"; };
      })
      .catch(function () { location.href = "/"; });
  });
})();
