// Runs the repository's public storage contract suite
// (test/contract-suite.js, README "Writing your own plug-in") against this
// example's actual API route logic (lib/handler.js), in-process: a fake
// `fetch` calls the handler directly with fake request/response objects
// standing in for what Next.js would build from a real HTTP request, so
// there's no HTTP server to start and, more importantly, no live Upstash
// account or credentials needed in CI. The handler under test is the exact
// same code pages/api/comments.js uses in production; only the store
// underneath it is swapped for the in-memory fake in
// test/in-memory-store.js (the real route wires up lib/store.js's
// Upstash-backed one instead).
//
// The client driving this is the repository's own
// `CommentMode.plugins.webAddress` factory, not a hand-rolled stand-in: that
// plug-in checks `body.success === true` on a save and treats anything else
// as a failure (see comment-mode.js's webAddressPlugin), so a handler that
// replied with the right HTTP status but the wrong body shape (e.g.
// `{ok:true}` instead of `{success:true}`) would fail here the same way it
// would fail for a real host, rather than only being caught by a test
// assertion that happens to check for it.
'use strict';

var path = require('path');
var runStorageContractSuite = require(
  path.join(__dirname, '..', '..', '..', 'test', 'contract-suite.js')
).runStorageContractSuite;
var CommentMode = require(path.join(__dirname, '..', '..', '..', 'comment-mode.js'));
var createCommentsHandler = require('../lib/handler').createCommentsHandler;
var createInMemoryStore = require('./in-memory-store').createInMemoryStore;
var fakeResponse = require('./fake-response').fakeResponse;

// A `fetch` stand-in that calls the handler directly instead of making a
// real HTTP request, translating between fetch's request/response shape and
// the fake `req`/`res` objects lib/handler.js expects.
function fakeFetch(handler) {
  return function (url, options) {
    options = options || {};
    var method = options.method || 'GET';
    var req;
    if (method === 'GET') {
      var queryString = url.indexOf('?') === -1 ? '' : url.slice(url.indexOf('?') + 1);
      var query = {};
      queryString.split('&').forEach(function (pair) {
        if (!pair) return;
        var equalsIndex = pair.indexOf('=');
        var key = decodeURIComponent(pair.slice(0, equalsIndex));
        var value = decodeURIComponent(pair.slice(equalsIndex + 1));
        query[key] = value;
      });
      req = { method: 'GET', query: query };
    } else {
      req = { method: method, body: JSON.parse(options.body) };
    }

    var res = fakeResponse();
    return Promise.resolve(handler(req, res)).then(function () {
      return {
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        json: function () { return Promise.resolve(res.body); }
      };
    });
  };
}

runStorageContractSuite('nextjs-upstash example /api/comments (in-memory store)', function () {
  var handler = createCommentsHandler(createInMemoryStore());
  return CommentMode.plugins.webAddress({ endpoint: '/api/comments', fetch: fakeFetch(handler) });
});
