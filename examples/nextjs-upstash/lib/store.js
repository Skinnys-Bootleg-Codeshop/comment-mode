// The real storage backend for /api/comments: one Redis hash per page
// reference, one field per comment id, held in Upstash Redis. Connection
// info comes only from environment variables (see this example's own
// README, "Environment variables"); nothing is hardcoded here.
//
// The Redis client is created lazily, on first use, rather than at module
// load time: `next build` and some test tooling load this module without
// the environment variables set, and Redis.fromEnv() throws immediately if
// they're missing. Building the example, or requiring this file, must not
// fail just because nobody's configured Upstash yet; only an actual request
// to the endpoint should.
//
// One field per id (not one JSON blob per page reference, which is what an
// earlier version of this store used) is what fixes the read-merge-write
// race two concurrent saves used to have: two saves for *different* ids
// touch different hash fields and can never clobber each other, no matter
// how their requests interleave. See UPSERT_COMMENTS_SCRIPT below for how
// this is applied, and lib/handler.js for how this store's `save` replaces
// the whole-list merge that endpoint used to do itself.
'use strict';

var canonicalKey = require('./page-reference').canonicalKey;

// Performs the read-merge-write step for every comment in one save inside
// a single Redis script call, so the whole batch runs atomically: Redis
// executes a script to completion before running any other command
// (including another invocation of this same script), so two concurrent
// saves — whether they share an id or not — can never interleave their
// reads and writes. Each id is still resolved independently against
// whatever's already stored under it; comment-mode's own sync engine
// always calls save() with the page's whole local comment array on every
// mutation, so batching every id into one EVAL call (rather than one EVAL
// per comment) keeps this to a single Redis round trip per save regardless
// of how many comments the page has.
//
// Mirrors lib/merge.js's mergeSingleComment: newest `updatedAt` wins per id
// (falling back to `createdAt`), an exact tie goes to the incoming record,
// and `deleted` is sticky. Timestamps are compared as strings rather than
// parsed as dates (Lua has no Date.parse), which only sorts correctly when
// every value being compared has the exact same fixed width. `ISO_8601_FULL`
// therefore requires the *whole* canonical shape comment-mode.js's root
// README documents and every value it ever writes actually has ("Timestamps":
// always `new Date().toISOString()`, always millisecond precision, always a
// literal `Z`) rather than merely an ISO-ish prefix: a value missing the
// milliseconds (e.g. `...T00:00:00Z`) would otherwise compare as *older*
// than an actually-older value that happens to include them, since `.`
// sorts below `Z` byte-for-byte. Anything that doesn't match this exact
// shape — malformed, truncated, or simply a different (still valid)
// timestamp encoding — is normalized to the empty string instead, the same
// way lib/merge.js's parseTimestamp sorts an unparseable value as the
// oldest possible instant rather than letting it win a comparison by
// accident.
//
// KEYS[1] = the hash key for this page reference
// ARGV[i] = the i-th incoming comment, JSON-encoded (each must have a
//           usable `id`; lib/handler.js filters those out before calling
//           save, see isMergeableComment)
var UPSERT_COMMENTS_SCRIPT = [
  "local ISO_8601_FULL = '^%d%d%d%d%-%d%d%-%d%dT%d%d:%d%d:%d%d%.%d%d%dZ$'",
  "local function timestampOf(comment)",
  '  local value = nil',
  "  if comment.updatedAt ~= nil and comment.updatedAt ~= cjson.null then value = comment.updatedAt",
  "  elseif comment.createdAt ~= nil and comment.createdAt ~= cjson.null then value = comment.createdAt",
  '  end',
  "  if type(value) ~= 'string' or not string.match(value, ISO_8601_FULL) then return '' end",
  '  return value',
  'end',
  '',
  'for i = 1, #ARGV do',
  '  local incomingJson = ARGV[i]',
  '  local incoming = cjson.decode(incomingJson)',
  '  local field = tostring(incoming.id)',
  "  local existing = redis.call('HGET', KEYS[1], field)",
  '  if not existing then',
  "    redis.call('HSET', KEYS[1], field, incomingJson)",
  '  else',
  '    local existingComment = cjson.decode(existing)',
  '    local winner',
  '    if timestampOf(incoming) >= timestampOf(existingComment) then',
  '      winner = incoming',
  '    else',
  '      winner = existingComment',
  '    end',
  '    local everDeleted = (existingComment.deleted == true) or (incoming.deleted == true)',
  '    if everDeleted and winner.deleted ~= true then',
  '      winner.deleted = true',
  '    end',
  "    redis.call('HSET', KEYS[1], field, cjson.encode(winner))",
  '  end',
  'end',
  'return #ARGV'
].join('\n');

function createUpstashStore() {
  var redis = null;
  function client() {
    if (!redis) {
      // Lazy require too, so a test that never calls into this store also
      // never needs @upstash/redis resolvable (it still is, since it's a
      // declared dependency, but this keeps the two concerns separate).
      var Redis = require('@upstash/redis').Redis;
      redis = Redis.fromEnv();
    }
    return redis;
  }

  function redisKey(pageReference) {
    return 'comment-mode:' + canonicalKey(pageReference);
  }

  return {
    load: async function (pageReference) {
      var hash = await client().hgetall(redisKey(pageReference));
      if (!hash) return [];
      return Object.keys(hash).map(function (id) {
        var value = hash[id];
        return typeof value === 'string' ? JSON.parse(value) : value;
      });
    },
    // Upserts every comment in `comments` into its own hash field in one
    // atomic script call (see UPSERT_COMMENTS_SCRIPT above).
    save: async function (pageReference, comments) {
      var list = comments || [];
      if (!list.length) return;
      var key = redisKey(pageReference);
      var args = list.map(function (comment) { return JSON.stringify(comment); });
      await client().eval(UPSERT_COMMENTS_SCRIPT, [key], args);
    }
  };
}

module.exports = { createUpstashStore: createUpstashStore, UPSERT_COMMENTS_SCRIPT: UPSERT_COMMENTS_SCRIPT };
