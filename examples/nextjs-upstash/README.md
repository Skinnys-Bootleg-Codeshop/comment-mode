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
  `<CommentModeLoader />` and otherwise looks like any other Next.js page.
- `components/CommentModeLoader.js`: the "one small component" that mounts
  comment mode. Per `docs/adr/0001-comment-mode-is-standalone.md`, comment
  mode has no framework binding: it manages its own UI outside React's tree,
  so this component only loads `comment-mode.js` and calls
  `CommentMode.init()` once. It renders nothing itself.
- `public/comment-mode.js`: a copy of the repository root's `comment-mode.js`.
  Comment mode is copy-first, not a package (see
  `docs/adr/0003-copy-first-not-a-package.md`), so this is a real, static
  copy, the same as you'd make in your own project; it isn't generated or
  kept in sync automatically. If you update the root file, copy it again.
- `pages/api/comments.js`: the webAddress endpoint (README "The web-address
  endpoint format" at the repository root), the GET/POST route
  `CommentModeLoader` points comment mode's `webAddress` storage plug-in at.
- `lib/handler.js`: the endpoint's actual logic (GET loads, POST merges and
  saves), independent of Next.js or any particular store, so it can be
  tested without either.
- `lib/merge.js`: the same newest-`updatedAt`-wins, sticky-`deleted` merge
  rule comment-mode.js itself uses, reimplemented here for the server side
  of a POST (see the comment at the top of that file).
- `lib/store.js`: the real storage backend, Upstash Redis, one JSON array of
  comments per page reference.
- `test/contract.test.js`: runs the repository's `runStorageContractSuite`
  (`test/contract-suite.js`) against `lib/handler.js`, with an in-memory
  fake standing in for `lib/store.js` (see "Running the tests" below).

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

This runs `test/contract.test.js` under Node's built-in test runner
(`node --test`, the same tool the repository root's own storage tests use).
It calls `lib/handler.js` directly with fake request/response objects
standing in for what Next.js would build from a real HTTP GET or POST, so
there's no server to start. The store underneath the handler is
`test/in-memory-store.js`, a plain-object stand-in for `lib/store.js` with
the same `load`/`save` shape, so the whole suite runs without an Upstash
account or credentials: exactly the endpoint logic that ships to production,
tested with nothing in it that can fail for lack of network access.
