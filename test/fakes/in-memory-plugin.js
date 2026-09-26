// A minimal in-memory storage plug-in, used only by the test suite to prove
// the contract suite passes against a real (if trivial) implementation of
// the interface documented in README "Storage plug-ins".
'use strict';

var upsertById = require('./merge-by-id.js').upsertById;

function storageKeyFor(pageReference) {
  return JSON.stringify(pageReference);
}

function createInMemoryPlugin() {
  var store = {};

  function upsert(pageReference, comments) {
    var key = storageKeyFor(pageReference);
    store[key] = upsertById(store[key], comments);
  }

  return {
    load: function (pageReference) {
      var key = storageKeyFor(pageReference);
      return Promise.resolve((store[key] || []).slice());
    },
    save: function (pageReference, comments) {
      upsert(pageReference, comments);
      return Promise.resolve();
    }
  };
}

module.exports = { createInMemoryPlugin: createInMemoryPlugin };
