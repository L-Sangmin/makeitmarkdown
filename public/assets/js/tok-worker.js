// Exact token counting, off the main thread.
//
// The o200k pass over a large document takes long enough to freeze
// scrolling and clicks if it runs on the page; this worker owns the
// tokenizer instead (main.js countTokensAsync). URL is origin-absolute
// for the same reason as ocr.js: the service worker's vendor cache
// serves it offline.
importScripts("/assets/vendor/gpt-tokenizer-o200k_base-3.4.0.min.js");

self.onmessage = ({ data }) => {
  const counts = data.texts.map((t) =>
    t === null ? null : GPTTokenizer_o200k_base.encode(t).length
  );
  self.postMessage({ id: data.id, counts });
};
