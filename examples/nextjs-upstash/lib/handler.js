// The framework-agnostic core of the web-address endpoint (README "The
// web-address endpoint format"): GET loads, POST saves. It only needs a
// `store` with `load(pageReference)` and `save(pageReference, comments)`
// (see lib/store.js for the real Upstash-backed one), so the same handler
// backs both the real /api/comments route (pages/api/comments.js) and the
// in-process test in test/contract.test.js, which injects an in-memory
// store instead so the contract suite can run without live cloud
// credentials.
//
// This handler has no access control of its own: anyone who can reach it
// can read every page's comments and write to any page reference. That's
// fine for this worked example, but a real deployment must add its own
// check (session/auth cookie, API key, rate limiting, whatever fits the
// host) before going further than a demo — see pages/api/comments.js and
// this example's README, "Access control", for where that check belongs.
'use strict';

var isMergeableComment = require('./merge').isMergeableComment;

function isValidPageReference(pageReference) {
  return (
    !!pageReference &&
    typeof pageReference === 'object' &&
    !Array.isArray(pageReference) &&
    typeof pageReference.id === 'string' &&
    pageReference.id.length > 0
  );
}

function createCommentsHandler(store) {
  return async function commentsHandler(req, res) {
    if (req.method === 'GET') {
      var raw = req.query && req.query.pageReference;
      var pageReference;
      try {
        pageReference = JSON.parse(raw);
      } catch (e) {
        res.status(400).json({ error: 'invalid pageReference' });
        return;
      }
      if (!isValidPageReference(pageReference)) {
        res.status(400).json({ error: 'pageReference must be an object with a non-empty string id' });
        return;
      }
      var comments = await store.load(pageReference);
      res.status(200).json({ comments: comments });
      return;
    }

    if (req.method === 'POST') {
      var body = req.body || {};
      var postedPageReference = body.pageReference;
      if (!isValidPageReference(postedPageReference)) {
        res.status(400).json({ error: 'pageReference must be an object with a non-empty string id' });
        return;
      }
      var incoming = body.comments;
      if (!Array.isArray(incoming)) {
        res.status(400).json({ error: 'comments must be an array' });
        return;
      }
      // The POST body is comment mode's current local knowledge, not a full
      // replacement of what the store holds (README "What the server behind
      // this endpoint must do"), so it's upserted id by id rather than
      // written verbatim. The store resolves each id atomically (see
      // lib/store.js), so two concurrent saves for different ids can never
      // race each other into dropping one, unlike an earlier version of
      // this handler that loaded the whole list, merged in memory, and
      // wrote the whole list back. Anything without a usable id is dropped
      // here first (see isMergeableComment) rather than passed through to
      // the store, which keys each field by `comment.id` and would
      // otherwise let two different id-less comments collide.
      await store.save(postedPageReference, incoming.filter(isMergeableComment));
      res.status(200).json({ success: true });
      return;
    }

    res.status(405).json({ error: 'method not allowed' });
  };
}

module.exports = { createCommentsHandler: createCommentsHandler };
