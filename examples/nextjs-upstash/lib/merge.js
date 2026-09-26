// The same per-id merge rule comment-mode.js's own sync engine uses (see its
// mergeComments/incomingWinsTie/withDeletedTrue functions), reimplemented
// here so this endpoint's store can apply it server-side: newest
// `updatedAt` wins per id (falling back to `createdAt`), an exact tie goes to
// the incoming record, and `deleted` is sticky (once either side has it,
// the merged record keeps it, regardless of which side is newer). See the
// repository README's "What the server behind this endpoint must do" for why
// this matters: a naive "last POST wins" or uniform newest-wins (including
// on `deleted`) passes an idempotent-save check but fails the first time two
// saves race.
//
// Exports `mergeSingleComment` (one id at a time; the atomic unit the store
// actually uses), `mergeComments` (a whole array at once, kept for callers
// that want that shape) and `isMergeableComment` (the admission rule both
// of the above apply, also reused directly by lib/handler.js to filter a
// POST body before it ever reaches the store).
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

// The repository root README documents `id` as "a string, unique within the
// page reference" (see "What the server behind this endpoint must do"), so
// this requires a non-empty string, not merely a defined one. That matters
// more here than it used to: lib/store.js now keys a Redis hash field
// directly off `comment.id` (via `tostring`), so an object or array id,
// which JSON round-trips fine but has no stable string identity, would get
// a fresh field on every save instead of upserting the same one, silently
// duplicating the comment instead of merging it.
function isMergeableComment(value) {
  return !!value && typeof value === 'object' && typeof value.id === 'string' && value.id.length > 0;
}

function withDeletedTrue(record) {
  var copy = {};
  for (var key in record) {
    if (Object.prototype.hasOwnProperty.call(record, key)) copy[key] = record[key];
  }
  copy.deleted = true;
  return copy;
}

// The per-id half of mergeComments below, pulled out on its own so it can
// run as the resolution step for a single comment id: lib/store.js's
// Upstash-backed store runs the equivalent of this logic in Lua, once per
// id, inside its UPSERT_COMMENTS_SCRIPT, and the in-memory test store
// (test/in-memory-store.js) calls this function directly. Neither needs the
// whole-array bookkeeping mergeComments does; both only ever resolve one id
// against one stored record at a time.
function mergeSingleComment(existingRecord, incomingRecord) {
  if (!existingRecord) return incomingRecord;
  if (!incomingRecord) return existingRecord;
  var winner = incomingWinsTie(incomingRecord, existingRecord) ? incomingRecord : existingRecord;
  var everDeleted = !!existingRecord.deleted || !!incomingRecord.deleted;
  return everDeleted && !winner.deleted ? withDeletedTrue(winner) : winner;
}

// Merges the store's existing comments for a page reference with the
// comments array a POST just brought in. `incoming` wins ties and appends
// any id `existing` doesn't have yet; an id present only in `existing` (one
// the POST's own reader hadn't loaded, or simply didn't mention) is kept
// as-is, never dropped, per README: "never delete or drop an id merely
// because a POST's array doesn't mention it".
//
// Kept for anything that wants to merge two whole arrays in one step (e.g.
// a from-scratch plug-in); the endpoint itself (lib/handler.js) no longer
// calls this; it delegates to the store, which upserts one id at a time via
// mergeSingleComment so that two concurrent saves for different ids never
// race each other (see lib/store.js and the "Race condition" fix note in
// this directory's README).
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
    return mergeSingleComment(existingById[id], incomingById[id]);
  });
}

module.exports = {
  mergeComments: mergeComments,
  mergeSingleComment: mergeSingleComment,
  isMergeableComment: isMergeableComment
};
