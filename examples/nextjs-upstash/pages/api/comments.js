// The webAddress endpoint (README "The web-address endpoint format"),
// wired to real Upstash Redis storage. All the logic lives in
// lib/handler.js and lib/store.js; this file just connects the two for
// Next.js's API routes.
'use strict';

var createCommentsHandler = require('../../lib/handler').createCommentsHandler;
var createUpstashStore = require('../../lib/store').createUpstashStore;

module.exports = createCommentsHandler(createUpstashStore());
