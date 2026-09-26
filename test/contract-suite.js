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

var PAGE_REFERENCE = { id: 'contract-suite-page' };

function runStorageContractSuite(label, createPlugin) {
  test.describe(label, function () {
    test.it('loading a page reference nothing has been saved to returns an empty list', async function () {
      var plugin = await createPlugin();
      var comments = await plugin.load(PAGE_REFERENCE);
      assert.deepEqual(comments, []);
    });

    test.it('save is idempotent by id', async function () {
      var plugin = await createPlugin();
      var comment = {
        id: 'c1',
        pageReference: PAGE_REFERENCE,
        anchor: { quote: { exact: 'a sentence' } },
        text: 'first',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      };
      await plugin.save(PAGE_REFERENCE, [comment]);
      await plugin.save(PAGE_REFERENCE, [comment]);
      await plugin.save(PAGE_REFERENCE, [comment]);
      var loaded = await plugin.load(PAGE_REFERENCE);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].id, 'c1');
      assert.equal(loaded[0].text, 'first');
    });

    test.it('newest updatedAt wins per id when two saves race', async function () {
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
      await plugin.save(PAGE_REFERENCE, [newer]);
      await plugin.save(PAGE_REFERENCE, [older]);
      var loaded = await plugin.load(PAGE_REFERENCE);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].text, 'fresh');
    });

    test.it('a delete marker is never revived by a later save carrying an older version', async function () {
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
      await plugin.save(PAGE_REFERENCE, [live]);
      await plugin.save(PAGE_REFERENCE, [deleted]);
      // An older, non-deleted version of the same id arrives after the
      // delete: the delete must stand.
      await plugin.save(PAGE_REFERENCE, [live]);
      var loaded = await plugin.load(PAGE_REFERENCE);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].deleted, true);
    });

    test.it('replies round-trip byte for byte', async function () {
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
      await plugin.save(PAGE_REFERENCE, [comment]);
      var loaded = await plugin.load(PAGE_REFERENCE);
      assert.equal(loaded.length, 1);
      assert.deepEqual(loaded[0].replies, replies);
    });
  });
}

module.exports = { runStorageContractSuite: runStorageContractSuite };
