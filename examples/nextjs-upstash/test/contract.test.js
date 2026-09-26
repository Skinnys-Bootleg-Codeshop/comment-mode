// Runs the repository's public storage contract suite
// (test/contract-suite.js, README "Writing your own plug-in") against this
// example's actual API route logic (lib/handler.js), in-process: fake
// request/response objects stand in for what Next.js would build from a
// real HTTP request, so there's no HTTP server to start and, more
// importantly, no live Upstash account or credentials needed in CI. The
// handler under test is the exact same code pages/api/comments.js uses in
// production; only the store underneath it is swapped for the in-memory
// fake in test/in-memory-store.js (the real route wires up
// lib/store.js's Upstash-backed one instead).
'use strict';

var path = require('path');
var runStorageContractSuite = require(
  path.join(__dirname, '..', '..', '..', 'test', 'contract-suite.js')
).runStorageContractSuite;
var createCommentsHandler = require('../lib/handler').createCommentsHandler;
var createInMemoryStore = require('./in-memory-store').createInMemoryStore;

function fakeResponse() {
  var res = {
    statusCode: undefined,
    body: undefined,
    status: function (code) {
      res.statusCode = code;
      return res;
    },
    json: function (payload) {
      res.body = payload;
      return res;
    }
  };
  return res;
}

// Wraps the handler as a load/save plug-in, the same shape
// runStorageContractSuite expects any storage plug-in to have (README
// "Storage plug-ins"), by calling the handler the way an HTTP GET/POST
// against it would.
function createHandlerPlugin(handler) {
  return {
    load: async function (pageReference) {
      var req = { method: 'GET', query: { pageReference: JSON.stringify(pageReference) } };
      var res = fakeResponse();
      await handler(req, res);
      if (res.statusCode !== 200) {
        throw new Error('load failed with status ' + res.statusCode);
      }
      return res.body.comments;
    },
    save: async function (pageReference, comments) {
      var req = { method: 'POST', body: { pageReference: pageReference, comments: comments } };
      var res = fakeResponse();
      await handler(req, res);
      if (res.statusCode !== 200) {
        throw new Error('save failed with status ' + res.statusCode);
      }
    }
  };
}

runStorageContractSuite('nextjs-upstash example /api/comments (in-memory store)', function () {
  var handler = createCommentsHandler(createInMemoryStore());
  return createHandlerPlugin(handler);
});
