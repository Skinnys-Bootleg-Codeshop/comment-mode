// Drives CommentMode._internal.createSyncEngine directly (no DOM) to prove
// offline queueing and reconnect: a save that fails while "offline" is
// retried and eventually delivered once the plug-in starts succeeding again,
// triggered by a synthetic 'online' event and by a synthetic visibility
// change. Also covers: a stale successful save must never erase pending
// state set by a newer failed one; a failed initial sync must trigger a full
// resync (not just a save retry) on the next retry trigger; a subscribe
// push is merged the same way a sync load is; and mergeComments' newest-
// updatedAt-wins behaviour (timestamps as instants, not raw strings, and an
// incoming record winning an exact tie).
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

// A plug-in whose save() never resolves on its own: each call is captured so
// the test can resolve/reject it whenever it likes, to reproduce a slow
// save racing against a faster one.
function createControllablePlugin() {
  var calls = [];
  return {
    calls: calls,
    load: function () { return Promise.resolve([]); },
    save: function (pageReference, comments) {
      var resolveFn, rejectFn;
      var promise = new Promise(function (resolve, reject) {
        resolveFn = resolve;
        rejectFn = reject;
      });
      calls.push({ comments: comments, resolve: resolveFn, reject: rejectFn });
      return promise;
    }
  };
}

// A plug-in whose load() fails while "offline" (so sync() must set
// needsSync) and whose load()/save() both succeed once "online", recording
// how many times each was called.
function createLoadFlakyPlugin(remoteComments) {
  var online = false;
  var loadCalls = 0;
  var saveCalls = [];
  return {
    setOnline: function (value) { online = value; },
    loadCallCount: function () { return loadCalls; },
    saveCalls: saveCalls,
    load: function () {
      loadCalls += 1;
      if (!online) return Promise.reject(new Error('offline'));
      return Promise.resolve(remoteComments);
    },
    save: function (pageReference, comments) {
      saveCalls.push(comments);
      return online ? Promise.resolve() : Promise.reject(new Error('offline'));
    }
  };
}

// Waits several microtask/macrotask turns, for asserting on the far end of a
// promise chain with more than one hop (e.g. load -> merge -> save) that a
// synthetic event handler kicked off without exposing its own promise.
function tick(times) {
  var p = Promise.resolve();
  for (var i = 0; i < (times || 1); i++) {
    p = p.then(function () {
      return new Promise(function (resolve) { setImmediate(resolve); });
    });
  }
  return p;
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

  test.it('compares timestamps as instants, not raw strings', function () {
    // local is a delete at 02:00 UTC. remote is a non-deleted, chronologically
    // OLDER record at 06:00+05:00, which is 01:00 UTC. Its string form sorts
    // *after* local's ("...T06..." > "...T02...") even though the instant it
    // names is earlier, so a raw string comparison would incorrectly let this
    // older remote record win and revive the delete. Date.parse-based
    // comparison must keep the delete.
    var local = [{ id: '1', deleted: true, updatedAt: '2024-01-02T02:00:00.000Z' }];
    var remote = [{ id: '1', deleted: false, updatedAt: '2024-01-02T06:00:00.000+05:00' }];
    var merged = mergeComments(local, remote);
    assert.equal(merged[0].deleted, true);
  });

  test.it('an exact tie is won by the incoming (remote) record', function () {
    var local = [{ id: '1', text: 'local', updatedAt: '2024-01-01T00:00:00.000Z' }];
    var remote = [{ id: '1', text: 'remote', updatedAt: '2024-01-01T00:00:00.000Z' }];
    var merged = mergeComments(local, remote);
    assert.equal(merged[0].text, 'remote');
  });

  test.it('a delete is never revived by a newer non-delete record on the other side', function () {
    // FOR-438 user story 19: device A deletes and syncs at T1; offline
    // device B, which never saw the delete, edits its own stale (still
    // live) copy at T2 > T1 and later reconnects. Newest-wins alone would
    // let B's newer, non-deleted record win outright and silently undelete
    // the comment everywhere; `deleted` must be sticky instead of following
    // the timestamp like every other field.
    var local = [{ id: 'x', deleted: true, updatedAt: '2024-01-01T00:00:00.000Z' }];
    var remote = [{ id: 'x', text: 'edited', updatedAt: '2024-01-02T00:00:00.000Z' }];
    var merged = mergeComments(local, remote);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].deleted, true);
    // Every other field still follows ordinary newest-wins.
    assert.equal(merged[0].text, 'edited');
  });

  test.it('a delete is sticky regardless of which side (local or remote) is newer', function () {
    var localNewerButLive = [{ id: 'y', text: 'still live locally', updatedAt: '2024-01-02T00:00:00.000Z' }];
    var remoteOlderButDeleted = [{ id: 'y', deleted: true, updatedAt: '2024-01-01T00:00:00.000Z' }];
    var merged = mergeComments(localNewerButLive, remoteOlderButDeleted);
    assert.equal(merged[0].deleted, true);
    // The newer side still wins every other field, including here where the
    // newer side happens to be the one without the delete.
    assert.equal(merged[0].text, 'still live locally');
  });

  test.it('skips a malformed entry instead of throwing, in both local and remote', function () {
    // The render path already treats stored comments defensively (renderPin
    // skips `!comment`), so a stray `null` or an id-less object is expected
    // to occur. Without this guard, reading `.id` off such an entry throws,
    // sync()'s catch sets needsSync, and every subsequent retry throws the
    // same way forever: sync is wedged with no visible error.
    var local = [null, { text: 'no id at all' }, { id: '1', text: 'good local' }];
    var remote = [undefined, 'not even an object', { id: '2', text: 'good remote' }];
    var merged;
    assert.doesNotThrow(function () {
      merged = mergeComments(local, remote);
    });
    assert.equal(merged.length, 2);
    var byId = {};
    merged.forEach(function (c) { byId[c.id] = c; });
    assert.equal(byId['1'].text, 'good local');
    assert.equal(byId['2'].text, 'good remote');
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

  test.it('a stale successful save never erases pending set by a newer failed save', async function () {
    var plugin = createControllablePlugin();
    var comments = [];

    var engine = createSyncEngine({
      plugin: plugin,
      pageReference: { id: 'page' },
      getComments: function () { return comments; },
      setComments: function (next) { comments = next; }
    });

    // Version 1: an older mutation's save, left hanging (simulates "slow").
    var firstSave = engine.save([{ id: '1' }]);
    // Version 2: a newer mutation's save, which fails fast ("offline").
    var secondSave = engine.save([{ id: '1' }, { id: '2' }]);
    // attemptSave defers the actual plugin.save() call by a microtask, so
    // plugin.calls isn't populated synchronously after engine.save() returns.
    await tick();
    plugin.calls[1].reject(new Error('offline'));
    await secondSave;
    assert.equal(engine.isPending(), true);

    // The stale version-1 save now succeeds, after the newer one already
    // failed. A shared boolean pending flag would clear here and version 2's
    // failure would never be retried; version-tracking must not let that
    // happen.
    plugin.calls[0].resolve();
    await firstSave;
    assert.equal(engine.isPending(), true);
  });

  test.it('a failed initial sync triggers a full resync, not just a save retry, on reconnect', async function () {
    var remoteComments = [{ id: 'remote-1', text: 'from the plug-in', updatedAt: '2024-01-01T00:00:00.000Z' }];
    var plugin = createLoadFlakyPlugin(remoteComments);
    var eventTarget = createFakeEventTarget();
    var comments = [];
    var renderedWith = null;

    var engine = createSyncEngine({
      plugin: plugin,
      pageReference: { id: 'page' },
      getComments: function () { return comments; },
      setComments: function (next) { comments = next; },
      onChange: function (next) { renderedWith = next; },
      eventTarget: eventTarget
    });

    await engine.sync(); // load fails while offline: needsSync, not just pending-for-save
    assert.equal(engine.isPending(), true);
    assert.equal(plugin.loadCallCount(), 1);
    assert.equal(plugin.saveCalls.length, 0);

    plugin.setOnline(true);
    eventTarget.fire('online');
    await tick(4); // load -> merge -> save is a longer chain than a bare save retry

    assert.equal(plugin.loadCallCount(), 2); // the retry re-ran the full load, not just a save
    assert.equal(engine.isPending(), false);
    assert.deepEqual(comments, remoteComments);
    assert.deepEqual(renderedWith, remoteComments);
  });

  test.it('receiveChange merges a subscribe push using the same newest-updatedAt-wins rule', function () {
    var comments = [{ id: '1', text: 'old', updatedAt: '2024-01-01T00:00:00.000Z' }];
    var renderedWith = null;
    var noopPlugin = { load: function () { return Promise.resolve([]); }, save: function () { return Promise.resolve(); } };

    var engine = createSyncEngine({
      plugin: noopPlugin,
      pageReference: { id: 'page' },
      getComments: function () { return comments; },
      setComments: function (next) { comments = next; },
      onChange: function (next) { renderedWith = next; }
    });

    engine.receiveChange([{ id: '1', text: 'new from another reader', updatedAt: '2024-01-02T00:00:00.000Z' }]);

    assert.equal(comments[0].text, 'new from another reader');
    assert.deepEqual(renderedWith, comments);
  });
});
