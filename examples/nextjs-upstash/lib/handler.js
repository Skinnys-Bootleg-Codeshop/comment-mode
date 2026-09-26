// The framework-agnostic core of the web-address endpoint (README "The
// web-address endpoint format"): GET loads, POST saves. It only needs a
// `store` with `load(pageReference)` and `save(pageReference, comments)`
// (see lib/store.js for the real Upstash-backed one), so the same handler
// backs both the real /api/comments route (pages/api/comments.js) and the
// in-process test in test/contract.test.js, which injects an in-memory
// store instead so the contract suite can run without live cloud
// credentials.
'use strict';

var mergeComments = require('./merge').mergeComments;

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
      var comments = await store.load(pageReference);
      res.status(200).json({ comments: comments });
      return;
    }

    if (req.method === 'POST') {
      var body = req.body || {};
      var pageReference = body.pageReference;
      var incoming = body.comments || [];
      if (!pageReference) {
        res.status(400).json({ error: 'missing pageReference' });
        return;
      }
      // The POST body is comment mode's current local knowledge, not a full
      // replacement of what the store holds, so it's merged in rather than
      // written verbatim (README "What the server behind this endpoint must
      // do").
      var existing = await store.load(pageReference);
      var merged = mergeComments(existing, incoming);
      await store.save(pageReference, merged);
      res.status(200).json({ success: true });
      return;
    }

    res.status(405).json({ error: 'method not allowed' });
  };
}

module.exports = { createCommentsHandler: createCommentsHandler };
