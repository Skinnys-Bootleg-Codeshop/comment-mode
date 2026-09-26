// A minimal in-memory storage plug-in, used only by the test suite to prove
// the contract suite passes against a real (if trivial) implementation of
// the interface documented in README "Storage plug-ins".
'use strict';

function storageKeyFor(pageReference) {
  return JSON.stringify(pageReference);
}

function createInMemoryPlugin() {
  var store = {};

  function upsert(pageReference, comments) {
    var key = storageKeyFor(pageReference);
    var byId = {};
    (store[key] || []).forEach(function (c) { byId[c.id] = c; });
    comments.forEach(function (c) {
      var existing = byId[c.id];
      var incomingTime = c.updatedAt || c.createdAt || '';
      var existingTime = existing ? (existing.updatedAt || existing.createdAt || '') : '';
      if (!existing || incomingTime >= existingTime) {
        byId[c.id] = c;
      }
    });
    store[key] = Object.keys(byId).map(function (id) { return byId[id]; });
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
