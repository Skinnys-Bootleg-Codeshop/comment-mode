// Runs the public storage contract suite against CommentMode.plugins.webAddress,
// backed by a tiny in-process fake HTTP server implementing the documented
// request/response format (README "Storage plug-ins"). Proves the built-in
// web-address plug-in satisfies the same contract as any implementor's.
'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var runStorageContractSuite = require('../contract-suite.js').runStorageContractSuite;
var createWebAddressServer = require('../fakes/web-address-server.js').createWebAddressServer;
var CommentMode = require('../../comment-mode.js');

var servers = [];

runStorageContractSuite('web-address plug-in', async function () {
  var server = createWebAddressServer();
  var endpoint = await server.listen();
  servers.push(server);
  return CommentMode.plugins.webAddress({ endpoint: endpoint });
});

test.describe('web-address plug-in with a query string already on the endpoint', function () {
  // Regression test: naively appending `?pageReference=...` onto an
  // endpoint that already has its own query string (e.g. an API key) used
  // to produce `...?key=abc?pageReference=...`, a single malformed query
  // string most servers (including the fake one here) parse wrong.
  // load()/save() must append with `&` when `endpoint` already has a `?`.
  test.it('load and save both work when endpoint already has a query string', async function () {
    var server = createWebAddressServer();
    var endpoint = await server.listen();
    servers.push(server);

    var plugin = CommentMode.plugins.webAddress({ endpoint: endpoint + '?key=abc' });
    var pageReference = { id: 'query-string-fixture' };
    var comment = {
      id: 'c1',
      text: 'still works with an existing query string',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    };

    await plugin.save(pageReference, [comment]);
    var loaded = await plugin.load(pageReference);

    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].text, 'still works with an existing query string');
  });
});

test.describe('web-address plug-in with a relative endpoint', function () {
  // Regression test: `new URL(endpoint)` throws synchronously on a relative
  // path like `/api/comments` (no base to resolve against), which many real
  // hosts pass since the comments endpoint usually lives on the same origin
  // as the page. That throw happened before load() even returned a
  // promise, breaking its contract and wedging needsSync retries forever
  // with no visible error. No real server is needed here: a stub fetch is
  // enough to prove load() resolves and is called with the right URL.
  test.it('load resolves and calls fetch with the relative URL, not throwing', async function () {
    var calls = [];
    var stubFetch = function (url) {
      calls.push(url);
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({ comments: [] }); }
      });
    };
    var plugin = CommentMode.plugins.webAddress({ endpoint: '/api/comments', fetch: stubFetch });

    var loaded = await plugin.load({ id: 'p' });

    assert.deepEqual(loaded, []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], '/api/comments?pageReference=' + encodeURIComponent(JSON.stringify({ id: 'p' })));
  });
});

test.after(async function () {
  await Promise.all(servers.map(function (s) { return s.close(); }));
});
