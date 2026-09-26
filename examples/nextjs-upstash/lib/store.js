// The real storage backend for /api/comments: one JSON array per page
// reference, held in Upstash Redis. Connection info comes only from
// environment variables (see this example's own README, "Environment
// variables"); nothing is hardcoded here.
//
// The Redis client is created lazily, on first use, rather than at module
// load time: `next build` and some test tooling load this module without
// the environment variables set, and Redis.fromEnv() throws immediately if
// they're missing. Building the example, or requiring this file, must not
// fail just because nobody's configured Upstash yet; only an actual request
// to the endpoint should.
'use strict';

var canonicalKey = require('./page-reference').canonicalKey;

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
      var comments = await client().get(redisKey(pageReference));
      return comments || [];
    },
    save: async function (pageReference, comments) {
      await client().set(redisKey(pageReference), comments);
    }
  };
}

module.exports = { createUpstashStore: createUpstashStore };
