// A reusable storage plug-in contract suite, shipped in this public repo so
// an implementor of their own plug-in (or their own web-address endpoint)
// can run the same checks comment-mode itself relies on, without a browser.
//
// Usage:
//
//   const { runStorageContractSuite } = require('comment-mode/test/contract-suite');
//   runStorageContractSuite('my plug-in', () => createMyPlugin());
//
// `createPlugin` is called fresh for each test (it may return a Promise) and
// must return an object with at least `load(pageReference)` and
// `save(pageReference, comments)`, per README "Storage plug-ins".
'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');

// A fresh id per test (not just per call to runStorageContractSuite), so the
// suite is re-runnable against a persistent or real server: a plug-in that
// isn't recreated per test (e.g. a real server backing every `createPlugin`
// call) would otherwise pile up records from earlier tests in the same run
// under one shared page reference, and a later assertion like
// "loaded.length === 1" would fail against leftovers that have nothing to do
// with that test.
function uniquePageReference(label) {
  return { id: 'contract-suite-' + label + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) };
}

function runStorageContractSuite(label, createPlugin) {
  test.describe(label, function () {
    test.it('loading a page reference nothing has been saved to returns an empty list', async function () {
      var pageReference = uniquePageReference('empty');
      var plugin = await createPlugin();
      var comments = await plugin.load(pageReference);
      assert.deepEqual(comments, []);
    });

    test.it('save is idempotent by id', async function () {
      var pageReference = uniquePageReference('idempotent');
      var plugin = await createPlugin();
      var comment = {
        id: 'c1',
        pageReference: pageReference,
        anchor: { quote: { exact: 'a sentence' } },
        text: 'first',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      };
      await plugin.save(pageReference, [comment]);
      await plugin.save(pageReference, [comment]);
      await plugin.save(pageReference, [comment]);
      var loaded = await plugin.load(pageReference);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].id, 'c1');
      assert.equal(loaded[0].text, 'first');
    });

    test.it('newest updatedAt wins per id when two saves race', async function () {
      var pageReference = uniquePageReference('newest-wins');
      var plugin = await createPlugin();
      var older = {
        id: 'c2',
        text: 'stale',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      };
      var newer = {
        id: 'c2',
        text: 'fresh',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z'
      };
      // The newer save arrives first, then a stale save races in after it.
      await plugin.save(pageReference, [newer]);
      await plugin.save(pageReference, [older]);
      var loaded = await plugin.load(pageReference);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].text, 'fresh');
    });

    test.it('a delete marker is never revived by a later save carrying an older version', async function () {
      var pageReference = uniquePageReference('delete-not-revived');
      var plugin = await createPlugin();
      var live = {
        id: 'c3',
        text: 'visible',
        deleted: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      };
      var deleted = {
        id: 'c3',
        text: 'visible',
        deleted: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z'
      };
      await plugin.save(pageReference, [live]);
      await plugin.save(pageReference, [deleted]);
      // An older, non-deleted version of the same id arrives after the
      // delete: the delete must stand.
      await plugin.save(pageReference, [live]);
      var loaded = await plugin.load(pageReference);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].deleted, true);
    });

    test.it('replies round-trip byte for byte', async function () {
      var pageReference = uniquePageReference('replies');
      var plugin = await createPlugin();
      var replies = [
        { id: 'r1', author: 'agent', text: 'thanks, fixed', createdAt: '2024-01-01T00:01:00.000Z' },
        { id: 'r2', author: 'reader', text: 'looks right now', createdAt: '2024-01-01T00:02:00.000Z' }
      ];
      var comment = {
        id: 'c4',
        text: 'needs a source',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        replies: replies
      };
      await plugin.save(pageReference, [comment]);
      var loaded = await plugin.load(pageReference);
      assert.equal(loaded.length, 1);
      assert.deepEqual(loaded[0].replies, replies);
    });

    test.it('a save to one page reference does not leak into another', async function () {
      var pageReference = uniquePageReference('isolation-a');
      var otherPageReference = uniquePageReference('isolation-b');
      var plugin = await createPlugin();
      var comment = {
        id: 'c5',
        text: 'only for page A',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      };
      await plugin.save(pageReference, [comment]);
      var otherPageLoaded = await plugin.load(otherPageReference);
      assert.deepEqual(otherPageLoaded, []);
    });
  });
}

module.exports = { runStorageContractSuite: runStorageContractSuite };
