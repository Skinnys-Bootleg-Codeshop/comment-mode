// A stable string key for a page reference object (e.g. { id: 'my-page' } or
// { id: 'my-page', version: 'v2' }), used as the storage key for both the
// real Upstash-backed store (lib/store.js) and the in-memory fake used in
// tests (test/in-memory-store.js), so a save to one page reference can never
// leak into another (README "Storage plug-ins", the page-reference isolation
// requirement that test/contract-suite.js checks).
'use strict';

function canonicalKey(pageReference) {
  var keys = Object.keys(pageReference || {}).sort();
  var sorted = {};
  keys.forEach(function (key) {
    sorted[key] = pageReference[key];
  });
  return JSON.stringify(sorted);
}

module.exports = { canonicalKey: canonicalKey };
