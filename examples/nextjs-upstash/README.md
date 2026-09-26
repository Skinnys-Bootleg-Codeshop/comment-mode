# Comment mode: Next.js + Upstash example

A worked example of hosting comment mode on a real site, per
`docs/adr/0002-hosts-bring-their-own-storage.md`: this app supplies its own
storage, so comments survive beyond one browser and are visible to every
visitor, not just the one who wrote them. Copy this whole directory into
your own project as a starting point if that's your situation. If you just
want comment mode working on a single static page with no server, see
`examples/single-file/` instead: it needs no hosting or storage at all.

## What's here

- `pages/index.js`: the one page in this example. It renders
  `<CommentModeLoader pageReference={{ id: 'nextjs-upstash-example' }} />`
  and otherwise looks like any other Next.js page.
- `components/CommentModeLoader.js`: the "one small component" that mounts
  comment mode. Per `docs/adr/0001-comment-mode-is-standalone.md`, comment
  mode has no framework binding: it manages its own UI outside React's tree,
  so this component only loads `comment-mode.js` and calls
  `CommentMode.init()` once. It renders nothing itself. It takes
  `pageReference` (and optionally `author`/`meta`) as props rather than
  hardcoding them, since a second page in your own app using this component
  needs its own distinct page reference. See "No teardown" below before
  reusing it across more than one page.
- `public/comment-mode.js`: a copy of the repository root's `comment-mode.js`.
  Comment mode is copy-first, not a package (see
  `docs/adr/0003-copy-first-not-a-package.md`), so this is a real, static
  copy, the same as you'd make in your own project; it isn't generated or
  kept in sync automatically. If you update the root file, copy it again.
- `pages/api/comments.js`: the webAddress endpoint (README "The web-address
  endpoint format" at the repository root), the GET/POST route
  `CommentModeLoader` points comment mode's `webAddress` storage plug-in at.
  Has no access control of its own; see "Access control" below.
- `lib/handler.js`: the endpoint's actual logic (GET loads, POST validates
  and saves), independent of Next.js or any particular store, so it can be
  tested without either.
- `lib/merge.js`: the same newest-`updatedAt`-wins, sticky-`deleted` merge
  rule comment-mode.js itself uses, reimplemented here as `mergeSingleComment`
  (one id at a time, the atomic unit `lib/store.js` upserts with) and
  `mergeComments` (a whole array at once) — see the comment at the top of
  that file.
- `lib/store.js`: the real storage backend, Upstash Redis, one hash per page
  reference with one field per comment id, every save's whole comment array
  upserted field by field in a single atomic Lua script call, so two
  concurrent saves can never race each other into dropping a comment (see
  "Concurrent saves" below).
- `test/contract.test.js`: runs the repository's `runStorageContractSuite`
  (`test/contract-suite.js`) against `lib/handler.js`, driven through the
  repository's own `CommentMode.plugins.webAddress` client (with a fake
  `fetch` that calls the handler directly), with an in-memory fake standing
  in for `lib/store.js` (see "Running the tests" below).
- `test/concurrency.test.js`: fires two saves at the same page reference
  concurrently and asserts a subsequent load returns both — the regression
  test for the race described in "Concurrent saves" below.

## Environment variables

`lib/store.js` reads Upstash's connection info from environment variables;
nothing is hardcoded. Create an Upstash Redis database (the free tier is
enough for this example) and set:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Both are shown on the database's page in the Upstash console, and are the
same names `@upstash/redis`'s `Redis.fromEnv()` looks for. For local
development, put them in a `.env.local` file in this directory (Next.js
loads it automatically; this directory's own `.gitignore` excludes
`.env*.local`, but double-check before committing anything). For a deployed
copy of this example, set them in your host's environment variable settings
instead.

Without these set, the page and its `CommentModeLoader` component still
render; only a request to `/api/comments` fails, since `lib/store.js` only
tries to connect to Redis when it's actually asked to load or save.

## Access control

`pages/api/comments.js` has no access control of its own: as shipped, anyone
who can reach a deployment of this example can read any page's comments,
write to any page reference, and create unbounded new page references (and
therefore unbounded Redis keys, since `lib/store.js` creates a hash the
first time it's written to). That's fine for a local demo, but a real
deployment must add its own check — a session or auth cookie, an API key, a
per-IP rate limit, whatever fits the host — before going further than a
demo. `pages/api/comments.js` has a comment showing where that check would
go; add it there, or in middleware in front of the route, before deploying
this example anywhere other than a personal test.

## Concurrent saves

A save used to work by loading the whole stored comment list, merging the
incoming comments into it, and writing the whole merged list back
(read-merge-write). Two concurrent saves for different comment ids (e.g. two
readers commenting on the same page at once) could each load before either
wrote, so one save's comment was silently lost when the other one's write
landed last.

`lib/store.js` fixes this by storing one Redis hash field per comment id
instead of one JSON blob per page reference, and upserting every id in a
save through a single Lua script call that reads, decides and writes each
field in turn, all inside one atomic Redis operation. Redis runs a script
to completion before starting the next one, even when two saves arrive
"concurrently" from the client's point of view, so two saves — whether they
share an id or not — can never interleave their reads and writes. Two
saves to the *same* id are resolved by the documented newest-`updatedAt`-
wins, sticky-`deleted` rule (see the repository root README, "What the
server behind this endpoint must do"). Running every id through one script
call, rather than one call per id, also keeps a save to a one-Redis-round-
trip operation regardless of how many comments the page has — comment
mode's own sync engine always calls `save()` with the page's whole local
comment array on every single mutation, so a page with many comments would
otherwise turn one small edit into one Redis command per comment.
`test/concurrency.test.js` is the regression test for the race itself.

## Running it

```
npm install
npm run dev
```

Then open `http://localhost:3000`, turn on comment mode, and tap a
sentence. Comments are saved through `/api/comments` to your Upstash
database, so they'll be there for anyone else who loads the page too, not
just reloads in the same browser.

## Running the tests

```
npm install
npm test
```

This runs `test/*.test.js` under Node's built-in test runner (`node --test`,
the same tool the repository root's own storage tests use):

- `test/contract.test.js` drives `lib/handler.js` through the repository's
  own `CommentMode.plugins.webAddress` client, with a fake `fetch` that
  calls the handler directly using fake request/response objects standing in
  for what Next.js would build from a real HTTP GET or POST, so there's no
  server to start and no hand-rolled client that might check less than the
  real one does.
- `test/concurrency.test.js` fires two saves at once through the same
  handler and asserts both survive (see "Concurrent saves" above).

Both use `test/in-memory-store.js`, a stand-in for `lib/store.js` with the
same `load`/`save` shape and the same one-field-per-comment-id layout
(including a per-page-reference queue, so two saves are never actually
interleaved, the same guarantee Redis's own script serialization gives the
real store), so the whole suite runs without an Upstash account or
credentials: exactly the endpoint logic that ships to production, tested
with nothing in it that can fail for lack of network access.

## No teardown

Comment mode itself has no "stop" or "destroy" call once `CommentMode.init()`
has run (see the repository root README) — `CommentModeLoader`'s own effect
cleanup only removes the `<script>` tag it injected, not comment mode's
running UI or sync engine. That means a client-side navigation between two
pages that both render `<CommentModeLoader>` will not correctly re-initialize
it with the new page's `pageReference`: `CommentModeLoader` already no-ops if
`window.CommentMode` exists, so the first page's instance simply keeps
running, still scoped to the first page's reference. Each distinct page
needs its own full page load (a plain `<a>` navigation, not client-side
routing) for its `CommentModeLoader` to mount its own correctly-scoped
instance.
