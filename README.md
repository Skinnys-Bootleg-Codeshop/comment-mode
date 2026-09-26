# Comment mode

A self-contained, copyable browser module that lets a reader tap a sentence on
an agent-made HTML page and leave a comment anchored to that text, so agents
can later read structured feedback instead of guessing from chat.

Read `CONTEXT.md` for the vocabulary this repo uses, and `docs/adr/` for the
decisions behind its shape: comment mode is standalone, hosts bring their own
storage, and it ships as copyable source rather than a package.

This is the tracer bullet (Linear FOR-439): a toggle, tap-to-comment anchored
to the sentence under the tap, browser-only storage keyed by a page reference,
and pins that survive a reload. Scope resizing, sentiment, replies, and a
storage plug-in for hosted sites are later tickets.

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

## Running the tests

```
npm install
npx playwright install --with-deps chromium
npm test
```

The suite runs against a real Chromium browser at a phone-sized viewport with
touch input enabled, serving the fixture at `test/fixtures/page.html` over a
small static server (`test/serve.js`). Anchoring and tap-vs-selection
behaviour can't be faithfully tested with a DOM emulator, so the suite does
not use one. The same suite runs in GitHub Actions on every push and pull
request (`.github/workflows/ci.yml`).
