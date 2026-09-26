// The same per-id merge rule comment-mode.js's own sync engine uses (see its
// mergeComments/incomingWinsTie/withDeletedTrue functions), reimplemented
// here so this endpoint's POST handler can apply it server-side: newest
// `updatedAt` wins per id (falling back to `createdAt`), an exact tie goes to
// the incoming record, and `deleted` is sticky (once either side has it,
// the merged record keeps it, regardless of which side is newer). See the
// repository README's "What the server behind this endpoint must do" for why
// this matters: a naive "last POST wins" or uniform newest-wins (including
// on `deleted`) passes an idempotent-save check but fails the first time two
// saves race.
'use strict';

function commentTimestamp(comment) {
  return (comment && (comment.updatedAt || comment.createdAt)) || '';
}

function parseTimestamp(value) {
  var parsed = Date.parse(value || '');
  return isNaN(parsed) ? -Infinity : parsed;
}

function incomingWinsTie(incoming, existing) {
  return parseTimestamp(commentTimestamp(incoming)) >= parseTimestamp(commentTimestamp(existing));
}

function isMergeableComment(value) {
  return !!value && typeof value === 'object' && value.id !== undefined && value.id !== null;
}

function withDeletedTrue(record) {
  var copy = {};
  for (var key in record) {
    if (Object.prototype.hasOwnProperty.call(record, key)) copy[key] = record[key];
  }
  copy.deleted = true;
  return copy;
}

// Merges the store's existing comments for a page reference with the
// comments array a POST just brought in. `incoming` wins ties and appends
// any id `existing` doesn't have yet; an id present only in `existing` (one
// the POST's own reader hadn't loaded, or simply didn't mention) is kept
// as-is, never dropped, per README: "never delete or drop an id merely
// because a POST's array doesn't mention it".
function mergeComments(existing, incoming) {
  var existingById = {};
  (existing || []).forEach(function (c) {
    if (isMergeableComment(c)) existingById[c.id] = c;
  });
  var incomingById = {};
  (incoming || []).forEach(function (c) {
    if (isMergeableComment(c)) incomingById[c.id] = c;
  });

  var ids = [];
  var seen = {};
  (existing || []).forEach(function (c) {
    if (!isMergeableComment(c) || seen[c.id]) return;
    ids.push(c.id);
    seen[c.id] = true;
  });
  (incoming || []).forEach(function (c) {
    if (!isMergeableComment(c) || seen[c.id]) return;
    ids.push(c.id);
    seen[c.id] = true;
  });

  return ids.map(function (id) {
    var existingRecord = existingById[id];
    var incomingRecord = incomingById[id];
    var winner;
    if (existingRecord && incomingRecord) {
      winner = incomingWinsTie(incomingRecord, existingRecord) ? incomingRecord : existingRecord;
    } else {
      winner = incomingRecord || existingRecord;
    }
    var everDeleted = !!(existingRecord && existingRecord.deleted) || !!(incomingRecord && incomingRecord.deleted);
    return everDeleted && !winner.deleted ? withDeletedTrue(winner) : winner;
  });
}

module.exports = { mergeComments: mergeComments };
