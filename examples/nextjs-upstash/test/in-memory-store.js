// A test-only stand-in for lib/store.js's real Upstash-backed store, same
// load/save shape, backed by a plain object instead of Redis. Used only by
// test/contract.test.js, so the contract suite can run against this
// example's actual endpoint logic (lib/handler.js) without a live Upstash
// account or credentials.
'use strict';

var canonicalKey = require('../lib/page-reference').canonicalKey;

function createInMemoryStore() {
  var data = {};
  return {
    load: async function (pageReference) {
      var key = canonicalKey(pageReference);
      return data[key] ? data[key].slice() : [];
    },
    save: async function (pageReference, comments) {
      var key = canonicalKey(pageReference);
      data[key] = comments.slice();
    }
  };
}

module.exports = { createInMemoryStore: createInMemoryStore };
