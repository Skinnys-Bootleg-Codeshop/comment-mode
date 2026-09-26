// Shared upsert-by-id logic for the test fakes (in-memory plug-in and the
// web-address fake server), so both mirror comment-mode.js's own merge rule
// exactly instead of drifting from it or from each other: for every field
// except `deleted`, newest `updatedAt` wins (falling back to `createdAt`),
// timestamps are parsed with `Date.parse` rather than compared as raw
// strings, and an incoming record wins an exact tie. `deleted` is sticky:
// once either the existing stored record or the incoming one has it set,
// the upserted record keeps it regardless of which side is newer, since
// there is no undelete anywhere in the spec (FOR-438 user story 19).
'use strict';

function commentTimestamp(comment) {
  return (comment && (comment.updatedAt || comment.createdAt)) || '';
}

function parseTimestamp(value) {
  var parsed = Date.parse(value || '');
  return isNaN(parsed) ? -Infinity : parsed;
}

function withDeletedTrue(record) {
  var copy = {};
  for (var key in record) {
    if (Object.prototype.hasOwnProperty.call(record, key)) copy[key] = record[key];
  }
  copy.deleted = true;
  return copy;
}

function upsertById(existingComments, incomingComments) {
  var byId = {};
  (existingComments || []).forEach(function (c) { byId[c.id] = c; });
  (incomingComments || []).forEach(function (c) {
    var existing = byId[c.id];
    var incomingWins = !existing || parseTimestamp(commentTimestamp(c)) >= parseTimestamp(commentTimestamp(existing));
    var winner = incomingWins ? c : existing;
    var everDeleted = !!(existing && existing.deleted) || !!c.deleted;
    byId[c.id] = everDeleted && !winner.deleted ? withDeletedTrue(winner) : winner;
  });
  return Object.keys(byId).map(function (id) { return byId[id]; });
}

module.exports = { upsertById: upsertById };
