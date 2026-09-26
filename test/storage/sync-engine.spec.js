// Drives CommentMode._internal.createSyncEngine directly (no DOM) to prove
// offline queueing and reconnect: a save that fails while "offline" is
// retried and eventually delivered once the plug-in starts succeeding again,
// triggered by a synthetic 'online' event and by a synthetic visibility
// change. Also covers mergeComments' newest-updatedAt-wins behaviour, which
// the sync engine relies on during its init-time reconciliation.
'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var CommentMode = require('../../comment-mode.js');

var mergeComments = CommentMode._internal.mergeComments;
var createSyncEngine = CommentMode._internal.createSyncEngine;

// A fake event target (stands in for `window`) whose 'online' listeners can
// be fired synthetically.
function createFakeEventTarget() {
  var listeners = {};
  return {
    addEventListener: function (name, fn) {
      listeners[name] = listeners[name] || [];
      listeners[name].push(fn);
    },
    fire: function (name) {
      (listeners[name] || []).forEach(function (fn) { fn(); });
    }
  };
}

// A fake `document` (visibilitychange + hidden) whose visibility can be
// flipped synthetically.
function createFakeDocument() {
  var listeners = {};
  return {
    hidden: false,
    addEventListener: function (name, fn) {
      listeners[name] = listeners[name] || [];
      listeners[name].push(fn);
    },
    becomeVisible: function () {
      this.hidden = false;
      (listeners.visibilitychange || []).forEach(function (fn) { fn(); });
    },
    becomeHidden: function () {
      this.hidden = true;
      (listeners.visibilitychange || []).forEach(function (fn) { fn(); });
    }
  };
}

// A fake plug-in whose save() can be toggled to fail ("offline") or succeed
// ("online") on demand, and which records every comments array it was
// eventually asked to save successfully.
function createFlakyPlugin() {
  var online = false;
  var delivered = [];
  return {
    setOnline: function (value) { online = value; },
    delivered: delivered,
    load: function () { return Promise.resolve([]); },
    save: function (pageReference, comments) {
      if (!online) return Promise.reject(new Error('offline'));
      delivered.push(comments);
      return Promise.resolve();
    }
  };
}

test.describe('mergeComments', function () {
  test.it('newest updatedAt wins per id', function () {
    var local = [{ id: '1', text: 'old', updatedAt: '2024-01-01T00:00:00.000Z' }];
    var remote = [{ id: '1', text: 'new', updatedAt: '2024-01-02T00:00:00.000Z' }];
    var merged = mergeComments(local, remote);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].text, 'new');
  });

  test.it('falls back to createdAt when updatedAt is absent', function () {
    var local = [{ id: '1', text: 'old', createdAt: '2024-01-01T00:00:00.000Z' }];
    var remote = [{ id: '1', text: 'new', createdAt: '2024-01-02T00:00:00.000Z' }];
    var merged = mergeComments(local, remote);
    assert.equal(merged[0].text, 'new');
  });

  test.it('a local-only record survives merge unchanged', function () {
    var local = [{ id: '1', text: 'mine', createdAt: '2024-01-01T00:00:00.000Z' }];
    var merged = mergeComments(local, []);
    assert.deepEqual(merged, local);
  });
});

test.describe('sync engine offline queueing and reconnect', function () {
  test.it('a failed save is retried and delivered once a synthetic online event fires', async function () {
    var plugin = createFlakyPlugin();
    var eventTarget = createFakeEventTarget();
    var comments = [{ id: '1', text: 'hello', createdAt: '2024-01-01T00:00:00.000Z' }];

    var engine = createSyncEngine({
      plugin: plugin,
      pageReference: { id: 'page' },
      getComments: function () { return comments; },
      setComments: function (next) { comments = next; },
      eventTarget: eventTarget
    });

    await engine.save(comments);
    assert.equal(engine.isPending(), true);
    assert.equal(plugin.delivered.length, 0);

    plugin.setOnline(true);
    eventTarget.fire('online');
    // flush() is async; give its promise chain a turn to resolve.
    await new Promise(function (resolve) { setImmediate(resolve); });

    assert.equal(engine.isPending(), false);
    assert.equal(plugin.delivered.length, 1);
    assert.deepEqual(plugin.delivered[0], comments);
  });

  test.it('a failed save is retried and delivered once the page becomes visible again', async function () {
    var plugin = createFlakyPlugin();
    var doc = createFakeDocument();
    var comments = [{ id: '1', text: 'hello', createdAt: '2024-01-01T00:00:00.000Z' }];

    var engine = createSyncEngine({
      plugin: plugin,
      pageReference: { id: 'page' },
      getComments: function () { return comments; },
      setComments: function (next) { comments = next; },
      document: doc
    });

    await engine.save(comments);
    assert.equal(engine.isPending(), true);

    doc.becomeHidden();
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.equal(engine.isPending(), true); // becoming hidden must not flush

    plugin.setOnline(true);
    doc.becomeVisible();
    await new Promise(function (resolve) { setImmediate(resolve); });

    assert.equal(engine.isPending(), false);
    assert.equal(plugin.delivered.length, 1);
  });

  test.it('a save that succeeds first time never becomes pending', async function () {
    var plugin = createFlakyPlugin();
    plugin.setOnline(true);
    var comments = [{ id: '1', text: 'hello', createdAt: '2024-01-01T00:00:00.000Z' }];

    var engine = createSyncEngine({
      plugin: plugin,
      pageReference: { id: 'page' },
      getComments: function () { return comments; },
      setComments: function (next) { comments = next; }
    });

    await engine.save(comments);
    assert.equal(engine.isPending(), false);
    assert.equal(plugin.delivered.length, 1);
  });
});
