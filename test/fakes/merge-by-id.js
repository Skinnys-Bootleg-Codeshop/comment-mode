// Shared upsert-by-id logic for the test fakes (in-memory plug-in and the
// web-address fake server), so both mirror comment-mode.js's own merge rule
// exactly instead of drifting from it or from each other: newest
// `updatedAt` wins (falling back to `createdAt`), timestamps are parsed with
// `Date.parse` rather than compared as raw strings, and an incoming record
// wins an exact tie.
'use strict';

function commentTimestamp(comment) {
  return (comment && (comment.updatedAt || comment.createdAt)) || '';
}

function parseTimestamp(value) {
  var parsed = Date.parse(value || '');
  return isNaN(parsed) ? -Infinity : parsed;
}

function upsertById(existingComments, incomingComments) {
  var byId = {};
  (existingComments || []).forEach(function (c) { byId[c.id] = c; });
  (incomingComments || []).forEach(function (c) {
    var existing = byId[c.id];
    var incomingWins = !existing || parseTimestamp(commentTimestamp(c)) >= parseTimestamp(commentTimestamp(existing));
    if (incomingWins) byId[c.id] = c;
  });
  return Object.keys(byId).map(function (id) { return byId[id]; });
}

module.exports = { upsertById: upsertById };
