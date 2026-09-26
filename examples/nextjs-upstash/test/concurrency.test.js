// Regression test for the read-merge-write race an earlier version of
// lib/handler.js had: it loaded the stored comment list, merged the
// incoming comments into it in memory, then wrote the whole merged list
// back. Two concurrent saves for *different* ids could each load before
// either wrote, so one save's comment was silently dropped when the other
// one's write landed last — contradicting this example's README's own rule
// that a save must never drop an id just because it's not currently in
// storage.
//
// The fix moved the merge into the store itself (lib/store.js), one Redis
// hash field per comment id, every save's whole array upserted in a single
// atomic script call (see UPSERT_COMMENTS_SCRIPT there, and
// test/in-memory-store.js's per-page-reference queue for the same
// guarantee in tests). This test fires two saves concurrently through the
// real handler and asserts a subsequent load returns both.
'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var createCommentsHandler = require('../lib/handler').createCommentsHandler;
var createInMemoryStore = require('./in-memory-store').createInMemoryStore;
var fakeResponse = require('./fake-response').fakeResponse;

test.it('two concurrent saves for different ids both survive through the real handler', async function () {
  var handler = createCommentsHandler(createInMemoryStore());
  var pageReference = { id: 'concurrency-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) };

  function save(comment) {
    var req = { method: 'POST', body: { pageReference: pageReference, comments: [comment] } };
    var res = fakeResponse();
    return Promise.resolve(handler(req, res)).then(function () { return res; });
  }

  var commentA = {
    id: 'reader-a-comment',
    text: 'from reader A',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  };
  var commentB = {
    id: 'reader-b-comment',
    text: 'from reader B',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  };

  // Both saves are fired together (no await between them), the same way two
  // readers commenting on the same page at once would race against a real
  // server.
  var results = await Promise.all([save(commentA), save(commentB)]);
  results.forEach(function (res) {
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
  });

  var loadReq = { method: 'GET', query: { pageReference: JSON.stringify(pageReference) } };
  var loadRes = fakeResponse();
  await handler(loadReq, loadRes);

  var ids = loadRes.body.comments.map(function (c) { return c.id; }).sort();
  assert.deepEqual(ids, ['reader-a-comment', 'reader-b-comment']);
});
