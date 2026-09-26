# Comment mode

A self-contained, copyable browser module that lets a reader tap a sentence on
an agent-made HTML page and leave a comment anchored to that text, so agents
can later read structured feedback instead of guessing from chat.

Read `CONTEXT.md` for the vocabulary this repo uses, and `docs/adr/` for the
decisions behind its shape: comment mode is standalone, hosts bring their own
storage, and it ships as copyable source rather than a package.

This started as the tracer bullet (Linear FOR-439): a toggle, tap-to-comment
anchored to the sentence under the tap, browser-only storage keyed by a page
reference, and pins that survive a reload. FOR-440 added word, sentence,
block and section scopes, stepped through with the sheet's −/+ controls.
FOR-441 added a sentiment picker, an author and an open metadata slot the
host can supply at init time, and editing and soft-deleting a comment from
its pin. FOR-442 added replies from any author, resolving and reopening a
comment, and a show-resolved switch that keeps resolved comments hidden by
default. FOR-444 added storage plug-ins and offline-first sync (see "Storage
plug-ins" below), so a host can now sync comments beyond one browser. There
is still no host login or permissions system: reply, resolve, edit and
delete are available on any comment's reopened sheet.

## Using it

Copy `comment-mode.js` into your project and load it with a single
`<script>` tag, then call `CommentMode.init()`. It supplies its own styles
(via a Shadow DOM root) and needs no build step.

Comment mode never infers what page it's on. Supply a page reference either
as a `<head>` meta tag:

```html
<meta name="comment-mode:page-id" content="my-page">
<meta name="comment-mode:page-version" content="v2"> <!-- optional -->
```

or in setup code, which wins if both are present:

```html
<script src="comment-mode.js"></script>
<script>
  CommentMode.init({ pageReference: { id: 'my-page' } });
</script>
```

Comments are stored in `localStorage`, keyed by the page reference.

Optionally, tell comment mode who's commenting and attach the host's own
metadata; both are stamped onto every comment created during that session:

```html
<script>
  CommentMode.init({
    pageReference: { id: 'my-page' },
    author: { name: 'Ada Lovelace', id: 'user-42' }, // id is optional
    meta: { team: 'design', ticket: 'FOR-441' } // an open slot, shape is yours
  });
</script>
```

When a comment is edited, its `sentiment` and `text` can change and an
`updatedAt` timestamp is added; its `author`, `meta`, `createdAt` and `id`
never change after creation. Deleting a comment marks it `deleted` rather
than removing it from storage, so a delete is permanent (it never comes back
on reload) but the record itself is kept.

Anyone reopening a comment's pin can reply to it: a reply is stored on the
comment's own `replies` array, each with its `text`, `createdAt` and, when the
session has one, the same `author` snapshot a comment takes at creation.
Resolving a comment (and reopening it again) toggles its `resolved` flag.
Resolved comments are hidden by default; the show-resolved switch next to the
comment mode toggle reveals them, and resets to hidden on every page load.

## Storage plug-ins

Comment mode always writes to `localStorage` first, so a reader's own comment
never waits on a network round trip. A storage plug-in is what a host adds on
top of that, to sync those comments somewhere else. Per
`docs/adr/0002-hosts-bring-their-own-storage.md`, comment mode ships no
hosted backend of its own: a host that wants comments to survive beyond one
browser supplies a plug-in.

### The interface

A plug-in is a plain object with:

- `load(pageReference) -> Promise<Comment[]>`: return every comment stored
  for that page reference (an empty array if none).
- `save(pageReference, comments) -> Promise<void>`: persist the given array,
  the full current set of comments comment-mode wants kept. Must be
  idempotent by `id`: saving the same array more than once must not create
  duplicates. Upsert-by-id is the plug-in's own job; the two built-ins below
  implement it directly.
- `subscribe(pageReference, onChange) -> unsubscribe()` (optional): call
  `onChange(comments)` with the plug-in's current full comment array for that
  page reference whenever its store changes from elsewhere. Comment mode
  calls `subscribe` itself, once, if the plug-in has it, and merges every
  `onChange` payload in with local state by the same newest-wins rule as a
  sync load. A plug-in that has no way to push updates simply omits this
  method.

Comment mode syncs on init: load, merge with what's in `localStorage` by
`id` (see "Conflicts" below), then save the merged result back. It syncs
again, from scratch, if that load ever fails. On every local mutation it
saves the new state; if that save fails, for example because the reader is
offline, comment mode marks it pending and retries without blocking the UI,
when the browser fires `online` or the page becomes visible again.

**Timestamps.** `createdAt` and `updatedAt` must be UTC ISO-8601
(`new Date().toISOString()`, e.g. `2024-01-02T03:04:05.678Z`). Every
comparison in comment mode and its built-in plug-ins parses these with
`Date.parse` rather than comparing the raw strings, so this is the format to
match; a plug-in that stores or returns a different format will sort
incorrectly against it.

**Conflicts.** A merge (init sync, a push through `subscribe`, or a
plug-in's own upsert) resolves per comment `id`: the record with the newest
`updatedAt` wins, falling back to `createdAt` when `updatedAt` is absent. On
an exact tie, the incoming record wins, whether "incoming" means the
plug-in's copy during a sync merge or the newly-saved copy during a
plug-in's own upsert. `deleted` is the one exception to newest-wins: once
either side of a merge has `deleted: true`, the merged record keeps it,
regardless of which side is newer. There is no undelete anywhere in this
spec, so a delete made on one device must survive even a *newer*, ordinary
edit arriving from a second device that synced before the delete and never
saw it (for example, an offline phone that edited its own stale copy and
only reconnects afterwards): that edit's other fields (text, sentiment,
`updatedAt`, ...) still win by timestamp as normal, but `deleted` does not
revert to `false`.

### Built-in plug-ins

`CommentMode.plugins` exposes two factory functions:

- `CommentMode.plugins.browserOnly()`: the default when no `config.storage`
  is supplied. It never syncs anywhere beyond `localStorage`; comment mode's
  own local-first write is its only store.
- `CommentMode.plugins.webAddress({ endpoint, fetch })`: talks to one host
  endpoint (see the request/response format below). `fetch` defaults to the
  global `fetch`; pass your own to use a different implementation or to test
  without a network.

```html
<script src="comment-mode.js"></script>
<script>
  CommentMode.init({
    pageReference: { id: 'my-page' },
    storage: CommentMode.plugins.webAddress({ endpoint: 'https://example.com/comments' })
  });
</script>
```

### The web-address endpoint format

One endpoint handles both directions. This format is part of the public
contract: an implementor can build a server against it without reading
`comment-mode.js`.

**Load**: `GET <endpoint>?pageReference=<url-encoded JSON>`

The `pageReference` query parameter is the page reference object, JSON-encoded
then URL-encoded, for example `{"id":"my-page"}` becomes
`?pageReference=%7B%22id%22%3A%22my-page%22%7D`.

Response, `200 OK`:

```json
{ "comments": [ /* Comment objects for that page reference */ ] }
```

**Save**: `POST <endpoint>`

Request body:

```json
{ "pageReference": { "id": "my-page" }, "comments": [ /* the full current array */ ] }
```

Response, `200 OK`:

```json
{ "success": true }
```

A comment object carries at least `id` and a timestamp. The full shape
comment-mode.js itself actually produces is:

- `id`: a string, unique within the page reference.
- `anchor`: where the comment is on the page. See "The anchor shape" below.
- `sentiment`: one of `'positive'`, `'neutral'` or `'negative'`.
- `text`: the comment's own text.
- `createdAt`: when the comment was made, UTC ISO-8601 (see "Timestamps"
  above).
- `author`: present only when the host supplied one at `init` time (see
  "Using it" above); a snapshot taken at creation, `{ name, id }` with `id`
  optional.
- `meta`: present only when the host supplied one at `init` time; whatever
  shape the host gave it, stamped on the same way as `author`.
- `updatedAt`: added the moment a comment is first edited, re-anchored,
  replied to, resolved, reopened or deleted; absent on a comment nothing has
  touched since creation (see "Conflicts" above for how a merge falls back
  to `createdAt` when it's missing).
- `resolved`: added, set to `true`, the moment a comment is first resolved;
  reopening it sets it back to `false` rather than removing it. A comment
  that has never been resolved has no `resolved` field at all, not
  `resolved: false`. (`resolved`, not `status`, is the actual field name;
  CONTEXT.md's "Resolved" entry uses the same term.)
- `deleted`: added, set to `true`, the moment a comment is deleted. There is
  no corresponding `false` value written anywhere; an undeleted comment
  simply has no `deleted` field.
- `replies`: an array, added the moment the first reply is written. Each
  reply is `{ id, text, createdAt, author }`, `author` present only when the
  session that wrote it had one, the same snapshot rule as a comment's own
  `author`.

`pageReference` is not stored on the comment object itself: comment-mode.js
already scopes storage by page reference (see "Storage plug-ins" above), so
nothing in it reads a `pageReference` back off a comment. A plug-in or
server is free to add one to its own stored copy, and `test/contract-suite.js`'s
own fixture comments do, but it plays no part in the contract itself.

A plug-in only ever loads or saves by the parent comment's `id`; `replies`
travel inside the parent record.

### The anchor shape

An anchor is `{ quote: { exact, prefix, suffix }, scope, rel }`, plus two
fields present only for certain anchors:

- `quote.exact` is the anchored text itself; `quote.prefix` and
  `quote.suffix` are the surrounding characters (see `CONTEXT_CHARS` in
  comment-mode.js) that re-anchoring uses to relocate that text if the page's
  markup changes around it.
- `scope` is one of `word`, `sentence`, `block` or `section` (CONTEXT.md's
  "Scope" entry).
- `rel` is `{ x, y }`, each `0`-`1`: the tap's fractional position within its
  resolved element's own bounding rect. It is only used for an anchor
  located via `path` (a text-quote anchor is already positioned precisely by
  its own re-found Range, which needs no help from `rel`), so a pin for a
  structural anchor can still sit close to where the block was originally
  tapped even though the element carries no text a Range could be built
  from.
- `near: true` marks a whitespace or gap anchor located near, rather than
  on, real content (a tap between two elements, or on empty space). It still
  carries the matched block's own text (or a generated description, such as
  `[image: ...]`, when the block has none) as `quote.exact`; `near` only
  means the tap didn't land on that text directly.
- `path`: a CSS selector from `document.body`, present only as a structural
  fallback for a block anchor whose content isn't literally searchable text
  on the page, such as an image; comment-mode.js falls back to this instead
  of an unsearchable quote in that case.

### What the server behind this endpoint must do

A POST's `comments` array is comment mode's current local knowledge, not a
full replacement of what the server holds: the server must upsert by `id`
into its own store, never delete or drop an id merely because a POST's
array doesn't mention it (only an explicit `deleted: true` record removes a
comment from view), and resolve each `id` by the same rule as comment mode
itself: newest `updatedAt` wins
(falling back to `createdAt`), timestamps parsed as UTC ISO-8601, incoming
wins an exact tie. Timestamp comparison alone is not enough for `deleted`,
though: it is sticky, not just newest-wins. If either the record already
stored or the one just saved has `deleted: true`, the server's upserted
result must keep `deleted: true`, even when the other one is newer (see
"Conflicts" above). A server that instead does "last POST wins" verbatim, or
applies newest-wins uniformly including to `deleted`, will pass a naive
idempotent-save check but fail newest-wins or delete-never-revived the first
time two saves race, which is exactly what `test/contract-suite.js` (below)
is built to catch.

### Writing your own plug-in

`test/contract-suite.js` exports a reusable suite, `runStorageContractSuite`,
that any plug-in must pass: loading an unsaved page reference, idempotent
save, newest-`updatedAt`-wins conflicts, delete markers that are never
revived, replies round-tripping, and page-reference isolation (a save to one
page reference must never leak into another). It generates a fresh page
reference on every run, so it's safe to run repeatedly against a real,
persistent server. Point it at your own plug-in factory to check it against
the same contract comment-mode's built-ins are held to.

## Worked examples

Comment mode is copy-first, not a package (see
`docs/adr/0003-copy-first-not-a-package.md`): the two examples below are
meant to be copied, not installed. Pick whichever matches your situation.

- **`examples/single-file/`**: a static page, or any site with no server of
  its own. One HTML file, opened straight from disk (`file://`, no server,
  no build step). It uses the default `browserOnly()` plug-in, so comments
  stay in that one browser's `localStorage` and never leave it. Copy
  `comment-mode.js` next to your own HTML file, add the same one-line script
  tag this example uses, and you're done.
- **`examples/nextjs-upstash/`**: a hosted app where comments should be
  visible to everyone who loads the page, not just the browser that wrote
  them. A small Next.js app with one component that mounts comment mode
  (`components/CommentModeLoader.js`) and one server API route implementing
  the web-address endpoint above (`pages/api/comments.js`), backed by
  Upstash Redis. Copy the whole directory into your own project, add your
  own Upstash credentials (see its own README), and adjust the page it
  mounts on.

Both examples are covered by tests: the single-file one gets a Playwright
smoke test (`test/examples-single-file.spec.js`, part of `npm test` above),
and the Next.js one runs `runStorageContractSuite` against its actual
endpoint logic with no live Upstash account needed (see its own README's
"Running the tests"). Both run in CI (`.github/workflows/ci.yml`).

## Running the tests

```
npm install
npx playwright install --with-deps chromium
npm test
```

`npm test` runs two suites: `test:browser` (Playwright, against a real
Chromium browser at a phone-sized viewport with touch input enabled, serving
the fixture at `test/fixtures/page.html` over a small static server,
`test/serve.js`) and `test:node` (`node --test`, the storage contract and
sync-engine suites under `test/storage`, no browser). Anchoring and
tap-vs-selection behaviour can't be faithfully tested with a DOM emulator, so
the Playwright suite does not use one; the storage suite runs comment-mode's
sync logic and built-in plug-ins directly under Node instead. Both suites run
in GitHub Actions on every push and pull request
(`.github/workflows/ci.yml`).
