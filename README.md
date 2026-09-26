# Comment mode

A self-contained, copyable browser module that lets a reader tap a sentence on
an agent-made HTML page and leave a comment anchored to that text, so agents
can later read structured feedback instead of guessing from chat.

Read `CONTEXT.md` for the vocabulary this repo uses, and `docs/adr/` for the
decisions behind its shape: comment mode is standalone, hosts bring their own
storage, and it ships as copyable source rather than a package.

This is the tracer bullet (Linear FOR-439): a toggle, tap-to-comment anchored
to the sentence under the tap, browser-only storage keyed by a page reference,
and pins that survive a reload. FOR-441 added a sentiment picker, an author
and an open metadata slot the host can supply at init time, and editing and
soft-deleting a comment from its pin. FOR-442 added replies from any author,
resolving and reopening a comment, and a show-resolved switch that keeps
resolved comments hidden by default. FOR-444 added storage plug-ins and
offline-first sync (see "Storage plug-ins" below), so a host can now sync
comments beyond one browser. Scope resizing is still a later ticket, and
there is still no host login or permissions system: reply, resolve, edit and
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
  `onChange(comments)` when the plug-in's store changes from elsewhere. A
  plug-in that has no way to push updates simply omits this method.

Comment mode syncs on init (load, merge with what's in `localStorage` by
`id`, keeping whichever record has the newest `updatedAt`, falling back to
`createdAt` when `updatedAt` is absent, then save the merged result back) and
on every local mutation (save the new state; if that save fails, for example
because the reader is offline, comment mode marks it pending and retries
without blocking the UI, when the browser fires `online` or the page becomes
visible again). Because conflicts resolve by newest `updatedAt`, a deleted
comment (`deleted: true` with a newer `updatedAt`) is never revived by an
older, non-deleted version of the same `id` arriving later.

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

A comment object carries at least `id` and a timestamp; the fuller shape
(forward-looking, not all of it produced by today's UI yet) is `id`,
`pageReference`, `anchor`, `sentiment`, `text`, `author`, `createdAt`,
`updatedAt`, `status`, `deleted`, `replies`. A plug-in only ever loads or
saves by the parent comment's `id`; `replies` travel inside the parent
record.

### Writing your own plug-in

`test/contract-suite.js` exports a reusable suite, `runStorageContractSuite`,
that any plug-in must pass: loading an unsaved page reference, idempotent
save, newest-`updatedAt`-wins conflicts, delete markers that are never
revived, and replies round-tripping. Point it at your own plug-in factory to
check it against the same contract comment-mode's built-ins are held to.

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
