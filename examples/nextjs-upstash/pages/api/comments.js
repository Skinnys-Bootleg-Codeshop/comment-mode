// The webAddress endpoint (README "The web-address endpoint format"),
// wired to real Upstash Redis storage. All the logic lives in
// lib/handler.js and lib/store.js; this file just connects the two for
// Next.js's API routes.
//
// No access control: this route is reachable by anyone who can reach this
// deployment, to read any page's comments, write to any page reference, and
// create unbounded new page references (and therefore unbounded Redis
// keys). That is fine for a local demo but not for a real deployment — see
// this example's README, "Access control". A real deployment should add its
// own check here (or in middleware in front of this route) before this
// example goes further than a demo, e.g.:
//
//   module.exports = function (req, res) {
//     // if (!isAuthorized(req)) { res.status(401).json({ error: 'unauthorized' }); return; }
//     return createCommentsHandler(createUpstashStore())(req, res);
//   };
'use strict';

var createCommentsHandler = require('../../lib/handler').createCommentsHandler;
var createUpstashStore = require('../../lib/store').createUpstashStore;

module.exports = createCommentsHandler(createUpstashStore());
