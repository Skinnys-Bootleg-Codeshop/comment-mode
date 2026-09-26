// A test-only stand-in for lib/store.js's real Upstash-backed store, same
// load/save shape and same one-field-per-comment-id layout, backed by plain
// objects instead of Redis. Used by test/contract.test.js and
// test/concurrency.test.js, so the contract suite and the concurrent-save
// regression test can run against this example's actual endpoint logic
// (lib/handler.js) without a live Upstash account or credentials.
'use strict';

var canonicalKey = require('../lib/page-reference').canonicalKey;
var mergeSingleComment = require('../lib/merge').mergeSingleComment;

function createInMemoryStore() {
  // One plain object per page reference, keyed by comment id, mirroring the
  // real store's one-hash-field-per-id layout (lib/store.js).
  var fieldsByPage = {};

  // A per-page-reference queue, standing in for the atomicity a Redis Lua
  // script gives lib/store.js's UPSERT_COMMENTS_SCRIPT: a real Redis server
  // runs one script to completion before starting the next, even when two
  // requests arrive "concurrently" from the client's point of view, so two
  // saves to the same page reference are never actually interleaved
  // server-side, only ever queued one after another. Without this (or a
  // fix for the underlying race), an old whole-list read-merge-write could
  // still lose a comment; this queue is what lets the concurrent-save test
  // (test/concurrency.test.js) prove that no longer happens.
  var queues = {};
  function withPageQueue(pageKey, fn) {
    var previous = queues[pageKey] || Promise.resolve();
    var next = previous.then(fn, fn);
    queues[pageKey] = next.catch(function () {});
    return next;
  }

  function fieldsFor(pageReference) {
    var key = canonicalKey(pageReference);
    if (!fieldsByPage[key]) fieldsByPage[key] = {};
    return fieldsByPage[key];
  }

  return {
    load: async function (pageReference) {
      var fields = fieldsFor(pageReference);
      return Object.keys(fields).map(function (id) { return fields[id]; });
    },
    save: async function (pageReference, comments) {
      var pageKey = canonicalKey(pageReference);
      var fields = fieldsFor(pageReference);
      var list = comments || [];
      return withPageQueue(pageKey, async function () {
        // A microtask tick before doing the merge, the same shape a real
        // network round trip to Redis has, so two saves fired together
        // (Promise.all) actually queue here the way they would against a
        // live server instead of just running back-to-back because Node
        // happens to be single-threaded.
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
        list.forEach(function (comment) {
          fields[comment.id] = mergeSingleComment(fields[comment.id], comment);
        });
      });
    }
  };
}

module.exports = { createInMemoryStore: createInMemoryStore };
