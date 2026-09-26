/*!
 * Comment mode — a self-contained, copyable module for tap-to-comment on any
 * HTML page. Copy this file into your project and load it with a single
 * <script> tag (see README.md). No build step, no npm package.
 *
 * See docs/adr/0001-comment-mode-is-standalone.md,
 * docs/adr/0002-hosts-bring-their-own-storage.md and
 * docs/adr/0003-copy-first-not-a-package.md for the decisions behind this
 * shape, and CONTEXT.md for the vocabulary used throughout (comment, anchor,
 * scope, comment mode, page reference, author).
 *
 * Scope resolution supports word, sentence, block and section scopes (Linear
 * FOR-440), stepped through with the sheet's −/+ controls; anchors are
 * text-quote anchors (exact quote plus short prefix/suffix context, or a
 * structural CSS path for image-like blocks with no text of their own), and
 * storage is browser-only. FOR-441 added a sentiment picker, host-supplied
 * author/meta stamped onto new comments, and in-place editing and soft
 * delete from a comment's pin. FOR-442 added replies, resolve/reopen, and a
 * show-resolved switch. See CONTEXT.md and the ticket for what is
 * deliberately not here yet (scope resize, a storage plug-in, and any
 * auth/permissions system beyond the `author` field itself).
 */
(function (global) {
  'use strict';

  var META_PAGE_ID = 'comment-mode:page-id';
  var META_PAGE_VERSION = 'comment-mode:page-version';
  var STORAGE_PREFIX = 'comment-mode:comments:';
  var CONTEXT_CHARS = 32;
  var SENTIMENTS = ['positive', 'neutral', 'negative'];
  var SENTIMENT_LABELS = { positive: 'Positive', neutral: 'Neutral', negative: 'Negative' };
  var DEFAULT_SENTIMENT = 'neutral';

  // ---------- page reference ----------
  // A page reference is never inferred (never location.href): the host
  // supplies it, either via <head> meta tags or via setup code. Setup code
  // wins when both are present.
  function readPageReferenceFromHead() {
    var idTag = document.head.querySelector(
      'meta[name="' + META_PAGE_ID + '"]'
    );
    if (!idTag) return null;
    var id = idTag.getAttribute('content');
    if (!id) return null;
    var versionTag = document.head.querySelector(
      'meta[name="' + META_PAGE_VERSION + '"]'
    );
    var version = versionTag ? versionTag.getAttribute('content') : null;
    return version ? { id: id, version: version } : { id: id };
  }

  function resolvePageReference(config) {
    // An explicit pageReference always wins over the head meta tag, including
    // when it is malformed: silently falling back to the head tag would mask
    // a caller's broken intent, so a present-but-invalid pageReference throws
    // instead of being ignored.
    if (config && config.pageReference) {
      var ref = config.pageReference;
      if (typeof ref.id !== 'string' || ref.id.length === 0) {
        throw new Error(
          'Comment mode: config.pageReference was supplied but its id is not a non-empty ' +
            'string (got ' +
            JSON.stringify(ref) +
            '). Comment mode never falls back to a <meta> tag when pageReference is ' +
            'explicitly supplied — fix the id or omit pageReference entirely.'
        );
      }
      return ref;
    }
    var fromHead = readPageReferenceFromHead();
    if (fromHead) return fromHead;
    throw new Error(
      'Comment mode: no page reference. Supply one via CommentMode.init({ pageReference: { id } }) ' +
        'or <meta name="' +
        META_PAGE_ID +
        '" content="..."> in <head>. Comment mode never infers one.'
    );
  }

  function storageKeyFor(pageReference) {
    var key = encodeURIComponent(pageReference.id);
    if (pageReference.version) {
      key += '@' + encodeURIComponent(pageReference.version);
    }
    return STORAGE_PREFIX + key;
  }

  // ---------- storage (browser only, keyed by page reference) ----------
  function loadComments(storageKey) {
    try {
      var raw = global.localStorage.getItem(storageKey);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveComments(storageKey, comments) {
    global.localStorage.setItem(storageKey, JSON.stringify(comments));
  }

  // ---------- storage plug-ins ----------
  // A storage plug-in is the abstraction docs/adr/0002 promises hosts: load a
  // page's comments, save comments by id (idempotent), and optionally
  // subscribe to changes. See README "Storage plug-ins" for the full
  // contract and the two built-ins below.
  //
  //   load(pageReference) -> Promise<Comment[]>
  //   save(pageReference, comments) -> Promise<void>
  //   subscribe(pageReference, onChange) -> unsubscribe()   // optional

  // The browser-only plug-in is today's tracer-bullet behaviour made
  // explicit: comment mode's own write to localStorage is the only store
  // there is, so this plug-in never reaches anywhere else. It is the default
  // in init() when no config.storage is supplied.
  function browserOnlyPlugin() {
    return {
      load: function () {
        return Promise.resolve([]);
      },
      save: function () {
        return Promise.resolve();
      }
    };
  }

  // The web-address plug-in talks to one host endpoint. Request/response
  // format (also documented in README "Storage plug-ins"):
  //
  //   GET  <endpoint>?pageReference=<url-encoded JSON of the page reference>
  //        -> 200 { "comments": [...] }
  //
  //   POST <endpoint>
  //        body: { "pageReference": {...}, "comments": [...] }
  //        -> 200 { "success": true }
  //
  // `fetch` is injectable (defaults to the global fetch) so this plug-in is
  // testable in Node without a real network.
  function webAddressPlugin(options) {
    options = options || {};
    var endpoint = options.endpoint;
    var fetchFn = options.fetch || (typeof global.fetch === 'function' ? global.fetch : undefined);
    if (!endpoint) {
      throw new Error('Comment mode: plugins.webAddress requires { endpoint }.');
    }
    if (typeof fetchFn !== 'function') {
      throw new Error(
        'Comment mode: plugins.webAddress found no global fetch. Pass { fetch } explicitly.'
      );
    }

    function loadUrl(pageReference) {
      // Building the query string with the URL API (rather than string
      // concatenation) is what keeps this correct when `endpoint` already
      // has its own query string (e.g. an API key): `?pageReference=...`
      // pasted onto an endpoint that already ends in `?key=abc` produces
      // `...?key=abc?pageReference=...`, which most servers parse wrong.
      var url = new URL(endpoint);
      url.searchParams.set('pageReference', JSON.stringify(pageReference));
      return url.toString();
    }

    function load(pageReference) {
      return fetchFn(loadUrl(pageReference), { method: 'GET' }).then(function (res) {
        if (!res.ok) {
          throw new Error('Comment mode: web-address plug-in load failed with status ' + res.status);
        }
        return res.json();
      }).then(function (body) {
        return Array.isArray(body && body.comments) ? body.comments : [];
      });
    }

    function save(pageReference, comments) {
      return fetchFn(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageReference: pageReference, comments: comments })
      }).then(function (res) {
        if (!res.ok) {
          throw new Error('Comment mode: web-address plug-in save failed with status ' + res.status);
        }
        return res.json();
      }).then(function (body) {
        if (!body || body.success !== true) {
          throw new Error('Comment mode: web-address plug-in save did not report success.');
        }
      });
    }

    return { load: load, save: save };
  }

  // ---------- sync engine ----------
  // A comment's sync timestamp is `updatedAt`, falling back to `createdAt`
  // for today's tracer-bullet comments that don't have one yet. Both must be
  // UTC ISO-8601 (`new Date().toISOString()`), the format every part of this
  // module and its built-in plug-ins compare against. Timestamps are parsed
  // with `Date.parse` rather than compared as raw strings, so two different
  // string encodings of the same instant (or of unrelated formats) still
  // compare correctly; a value that fails to parse sorts as the oldest
  // possible instant rather than winning by accident. On an exact tie, the
  // incoming (remote/newer-write) record wins, matching every plug-in this
  // module ships.
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

  // Merges a local and a remote comment array by id: the record with the
  // newest timestamp wins, incoming wins an exact tie (see
  // `incomingWinsTie`). A delete is just a record with `deleted: true` and a
  // newer `updatedAt`, so it is never revived by an older record arriving
  // later; no special-case delete logic is needed here. Local ordering is
  // preserved; remote-only ids are appended at the end.
  // A comment record must be an object with an `id` to participate in a
  // merge at all. Storage the render path already treats defensively (see
  // renderPin's own `!comment` check) can contain a stray `null` or an
  // object missing `id`; without this guard, reading `.id` off such an
  // entry throws, sync()'s catch sets needsSync, and every subsequent retry
  // throws the same way forever, wedging sync permanently with no visible
  // error. Skipping malformed entries here (from both local and remote,
  // rather than keeping them in the merged/persisted result) is enough:
  // there is nothing useful to keep from an entry with no id to merge by.
  function isMergeableComment(value) {
    return !!value && typeof value === 'object' && value.id !== undefined && value.id !== null;
  }

  function mergeComments(local, remote) {
    var byId = {};
    local.forEach(function (c) {
      if (isMergeableComment(c)) byId[c.id] = c;
    });
    (remote || []).forEach(function (r) {
      if (!isMergeableComment(r)) return;
      var existing = byId[r.id];
      if (!existing || incomingWinsTie(r, existing)) {
        byId[r.id] = r;
      }
    });
    var merged = [];
    var seen = {};
    local.forEach(function (c) {
      if (!isMergeableComment(c) || seen[c.id]) return;
      merged.push(byId[c.id]);
      seen[c.id] = true;
    });
    (remote || []).forEach(function (r) {
      if (!isMergeableComment(r) || seen[r.id]) return;
      merged.push(byId[r.id]);
      seen[r.id] = true;
    });
    return merged;
  }

  // Drives comment mode's offline-first sync: local storage is always
  // written first and is never blocked on the plug-in.
  //
  // `sync()` runs once at init to reconcile with the plug-in's store, and
  // again on retry after a failed load, since a load that never happened
  // means comment mode never learned what the plug-in has. `save()` attempts
  // to push a local mutation and quietly marks it pending on failure instead
  // of throwing. `flush()` is the single retry entry point wired to 'online'
  // and visibility-change triggers: it re-runs the full `sync()` if the last
  // load failed (`needsSync`), otherwise it just retries the pending save,
  // so a save failure never masquerades as "we know what the plug-in has"
  // and vice versa.
  //
  // A shared `pending` boolean would race: a slow-but-successful save for an
  // earlier local state could clear it right after a fast-failing save for a
  // newer one, and the newer failure would never be retried. `version` is a
  // monotonically increasing counter bumped on every `save()` call; a save
  // only clears `pending` when the version it was attempting is still the
  // current version when it resolves, so a newer failure's `pending = true`
  // is never erased by an older save's late success.
  function createSyncEngine(options) {
    options = options || {};
    var plugin = options.plugin;
    var pageReference = options.pageReference;
    var getComments = options.getComments;
    var setComments = options.setComments;
    var onChange = options.onChange;
    var eventTarget = options.eventTarget;
    var doc = options.document;

    var version = 0;
    var pending = false;
    var needsSync = false;
    var flushing = false;

    function attemptSave(comments, myVersion) {
      if (!plugin || typeof plugin.save !== 'function') return Promise.resolve();
      return Promise.resolve()
        .then(function () { return plugin.save(pageReference, comments); })
        .then(function () {
          if (myVersion === version) pending = false;
        })
        .catch(function () {
          pending = true;
        });
    }

    // Merges `remote` into local state (used by both `sync()`'s load and a
    // plug-in's `subscribe` push) and re-renders when it actually changes
    // anything.
    function reconcile(remote) {
      var local = getComments();
      var merged = mergeComments(local, remote || []);
      var changed = JSON.stringify(local) !== JSON.stringify(merged);
      if (changed) {
        setComments(merged);
        if (onChange) onChange(merged);
      }
      return merged;
    }

    function save(comments) {
      version += 1;
      return attemptSave(comments, version);
    }

    function sync() {
      if (!plugin || typeof plugin.load !== 'function') return Promise.resolve();
      return Promise.resolve()
        .then(function () { return plugin.load(pageReference); })
        .then(function (remote) {
          needsSync = false;
          var merged = reconcile(remote);
          return attemptSave(merged, version);
        })
        .catch(function () {
          // Load failed (offline, network error, ...): comment mode doesn't
          // know what the plug-in holds, so the next retry trigger must redo
          // the whole load+merge+save, not just retry a save.
          needsSync = true;
        });
    }

    // A plug-in's optional push-update channel: merge what it reports by the
    // same newest-wins rule sync() uses, without waiting for a retry trigger.
    function receiveChange(remote) {
      reconcile(remote);
    }

    function flush() {
      if (flushing || (!pending && !needsSync)) return Promise.resolve();
      flushing = true;
      var work = needsSync ? sync() : attemptSave(getComments(), version);
      return work.then(function () {
        flushing = false;
      });
    }

    function handleRetryTrigger() {
      flush();
    }

    if (eventTarget && typeof eventTarget.addEventListener === 'function') {
      eventTarget.addEventListener('online', handleRetryTrigger);
    }
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', function () {
        if (!doc.hidden) handleRetryTrigger();
      });
    }

    return {
      sync: sync,
      save: save,
      flush: flush,
      receiveChange: receiveChange,
      isPending: function () { return pending || needsSync; }
    };
  }

  // ---------- text index helpers ----------
  // Text nodes under these tags are never visible page content (script/style
  // source, noscript fallback markup, inert template contents), so they must
  // never end up in the flattened text used for tap resolution, sentence
  // segmentation or anchor prefix/suffix context.
  var SKIPPED_ANCESTOR_TAGS = { SCRIPT: true, STYLE: true, NOSCRIPT: true, TEMPLATE: true };

  function isUnderSkippedAncestor(node) {
    var el = node.parentElement;
    while (el) {
      if (SKIPPED_ANCESTOR_TAGS[el.tagName]) return true;
      el = el.parentElement;
    }
    return false;
  }

  // Flatten the text nodes under `root` into one string, remembering which
  // DOM text node backs each character range, so a plain-text offset can be
  // converted back into a DOM Range.
  //
  // Adjacent block-level containers (a <td> immediately followed by another
  // <td>, an <li> followed by another <li>, ...) often have no whitespace
  // text node between them in the markup, so flattening naively would run
  // their content together into one word (e.g. "AlphaBeta"). Whenever the
  // walk crosses from one grouping ancestor (nearestGroupingAncestor) into a
  // different one, a single separator character is spliced into `text` with
  // no backing entry of its own. `indexToNodeOffset`'s existing inclusive
  // end-of-entry check (`index <= entry.end`) already resolves an index that
  // lands on that separator to the end of the previous entry, so no other
  // offset math needs to change.
  //
  // A <br> inside a block is a line break, not nothing: without a separator
  // here, `<li>Line one<br>Line two</li>` would flatten to "Line oneLine
  // two" with the two lines glued together.
  function buildTextIndex(root) {
    var entries = [];
    var text = '';
    var previousGroup = null;
    var blockCache = new Map();
    var groupCache = new Map();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        return isUnderSkippedAncestor(node)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      var value = node.nodeValue;
      if (!value) continue;
      var group = nearestGroupingAncestor(node.parentElement, blockCache, groupCache);
      var brBefore = previousBrSibling(node);
      if (
        text.length &&
        !/\s$/.test(text) &&
        !/^\s/.test(value) &&
        (brBefore || (previousGroup !== null && group !== previousGroup))
      ) {
        text += ' ';
      }
      entries.push({ node: node, start: text.length, end: text.length + value.length });
      text += value;
      previousGroup = group;
    }
    return { text: text, entries: entries };
  }

  // True when a <br> sits between `node` and the previous non-empty sibling
  // content, within the same parent (a <br> at a container boundary is
  // already covered by the grouping separator above).
  function previousBrSibling(node) {
    var sib = node.previousSibling;
    while (sib) {
      if (sib.nodeType === 1 && sib.tagName === 'BR') return true;
      if (sib.nodeType === 3 && sib.nodeValue) return false;
      sib = sib.previousSibling;
    }
    return false;
  }

  function indexToNodeOffset(index, entries) {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (index >= entry.start && index <= entry.end) {
        return { node: entry.node, offset: index - entry.start };
      }
    }
    if (entries.length) {
      var last = entries[entries.length - 1];
      return { node: last.node, offset: last.node.nodeValue.length };
    }
    return null;
  }

  function rangeForOffsets(entries, start, end) {
    var a = indexToNodeOffset(start, entries);
    var b = indexToNodeOffset(end, entries);
    if (!a || !b) return null;
    var range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    return range;
  }

  // ---------- block detection ----------
  // Sentence/word resolution happens within the nearest block-level
  // ancestor, so a sentence never bleeds across paragraph/heading/list-item
  // boundaries. IMG, FIGURE, SVG, CANVAS and VIDEO are here too, even though
  // they carry no text of their own, so a tap on one of them resolves
  // directly to it (block scope) rather than falling through to a
  // text-bearing ancestor.
  var BLOCK_TAGS = [
    'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'BLOCKQUOTE', 'PRE',
    'IMG', 'FIGURE', 'SVG', 'CANVAS', 'VIDEO'
  ];

  // Tags whose block description falls back to a bracketed placeholder
  // (`[image: alt]`, `[svg]`, ...) because they carry no text of their own
  // that could ever be found by a quote search. IMG's description includes
  // its alt text; the others don't have an equivalent human-authored label.
  var IMAGE_LIKE_LABELS = { IMG: 'image', SVG: 'svg', CANVAS: 'canvas', VIDEO: 'video' };

  // Cheap, per-element block test used on the hot per-text-node ancestor
  // walk (nearestGroupingAncestor, and any actual-text tap): a tag-name
  // lookup or a single getComputedStyle().display read, nothing that reads
  // `textContent` or scans descendants. `cache` is a Map scoped to one
  // buildTextIndex/resolveTap call, so a shared ancestor visited from many
  // different text nodes is only ever computed once.
  function isBlockTagOrDisplay(el, cache) {
    if (!el || el.nodeType !== 1 || isCommentModeUI(el)) return false;
    if (cache && cache.has(el)) return cache.get(el);
    var result = BLOCK_TAGS.indexOf(el.tagName) !== -1;
    if (!result) {
      var display = global.getComputedStyle(el).display;
      result = display === 'block' || display === 'list-item' || display === 'table-cell';
    }
    if (cache) cache.set(el, result);
    return result;
  }

  // A generic element (a plain <div>, <main>, ...) only counts as a block
  // when it is a leaf of block-level structure with real content: a layout
  // wrapper that itself contains further block-level elements (e.g. a
  // <div class="page"> wrapping several paragraphs) must not be picked up as
  // "the nearest block" ahead of those paragraphs, and an empty wrapper (a
  // whitespace-only spacer <div>) must not be picked up as a block at all —
  // both need to keep deferring to a real descendant block, or to
  // distance-based resolution when there is none. Text nested inside inline
  // children still counts as the wrapper's own content (`textContent`, not
  // just direct child text nodes): a <div><span>...</span></div> is a
  // perfectly ordinary block whose only child happens to be inline.
  // Elements named explicitly in BLOCK_TAGS are always block regardless.
  //
  // This "leaf" rule is deliberately used only for the whitespace/distance
  // fallback path (a tap that isn't on any real text): applying it to an
  // actual text tap regressed a real case (a <div> that contains both loose
  // text and a nested block, e.g. `<div><strong>Note:</strong> text <p>...
  // </p></div>`) — the div stopped counting as a block at all because it
  // "contains" the nested <p>, so a tap on the loose text fell through to
  // the wrong element entirely. A real text tap instead walks up to the
  // nearest ancestor `isBlockTagOrDisplay` recognises, regardless of what
  // else that ancestor contains — the same rule this module used before
  // FOR-440 introduced scopes.
  function containsBlockDescendant(el) {
    var all = el.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var child = all[i];
      if (BLOCK_TAGS.indexOf(child.tagName) !== -1) return true;
      var d = global.getComputedStyle(child).display;
      if (d === 'block' || d === 'list-item' || d === 'table-cell') return true;
    }
    return false;
  }

  function isBlockElLeaf(el) {
    if (!el || el.nodeType !== 1 || isCommentModeUI(el)) return false;
    if (BLOCK_TAGS.indexOf(el.tagName) !== -1) return true;
    var display = global.getComputedStyle(el).display;
    if (display !== 'block' && display !== 'list-item' && display !== 'table-cell') {
      return false;
    }
    if (!/\S/.test(el.textContent)) return false;
    return !containsBlockDescendant(el);
  }

  // `predicate` is the block test to use: `isBlockTagOrDisplay` for a tap
  // that landed on real text (the original, non-leaf rule), or
  // `isBlockElLeaf` for the whitespace/distance fallback path. See the
  // comment on `containsBlockDescendant` above for why these differ.
  function findBlockAncestor(node, predicate) {
    var el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== document.body) {
      if (predicate(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  // Every text node and every candidate block element is grouped under the
  // nearest ancestor `isBlockTagOrDisplay` recognises (falling back to
  // document.body), so buildTextIndex knows when it has crossed from one
  // block-level container into another and needs to splice in a separator.
  // `groupCache` memoizes the *result* of this walk per element (not just
  // the per-element block test), so pages with many sibling text nodes under
  // a shared ancestor chain resolve each ancestor's group at most once
  // overall rather than once per text node.
  function nearestGroupingAncestor(el, blockCache, groupCache) {
    if (!el || el === document.body) return document.body;
    if (groupCache && groupCache.has(el)) return groupCache.get(el);
    var result = isBlockTagOrDisplay(el, blockCache)
      ? el
      : nearestGroupingAncestor(el.parentElement, blockCache, groupCache);
    if (groupCache) groupCache.set(el, result);
    return result;
  }

  function isCommentModeUI(el) {
    return !!(el && el.nodeType === 1 && el.closest && el.closest('[data-comment-mode-host]'));
  }

  // Finds the block-level element nearest to a point that has no text
  // directly under it (a tap that lands in whitespace, on a bare layout
  // wrapper, or in the margin). Used only when neither a caret hit nor an
  // element hit under the point resolves to a block directly.
  function nearestBlockByDistance(root, clientX, clientY) {
    var all = root.querySelectorAll('*');
    var best = null;
    var bestDistance = Infinity;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!isBlockElLeaf(el)) continue;
      var rect = el.getBoundingClientRect();
      var dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
      var dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
      var distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = el;
      }
    }
    return best;
  }

  // ---------- sentence segmentation ----------
  // `idx` comes from a caret API and can legitimately equal `text.length`
  // (tapping the very last character of a block reports an offset one past
  // it). Segments are matched half-open ([start, end)), so that offset
  // matches nothing and used to fall back to the whole block. We clamp to
  // the last valid character position and, since a tap can land right on a
  // segment boundary, also try the character just before it before giving
  // up on a segment match.
  function getSentenceAt(text, idx) {
    if (!text.length) return { start: 0, end: 0, text: '' };
    var clamped = idx < 0 ? 0 : idx > text.length - 1 ? text.length - 1 : idx;
    var candidates = clamped > 0 ? [clamped, clamped - 1] : [clamped];

    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        var segments = Array.from(
          new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)
        );
        for (var c = 0; c < candidates.length; c++) {
          var pos = candidates[c];
          for (var i = 0; i < segments.length; i++) {
            var seg = segments[i];
            var start = seg.index;
            var end = start + seg.segment.length;
            if (pos >= start && pos < end) {
              var trimmedEnd = end;
              while (trimmedEnd > start && /\s/.test(text[trimmedEnd - 1])) trimmedEnd--;
              return { start: start, end: trimmedEnd, text: text.slice(start, trimmedEnd) };
            }
          }
        }
      } catch (e) {
        // fall through to the regex fallback below
      }
    }
    for (var c2 = 0; c2 < candidates.length; c2++) {
      var pos2 = candidates[c2];
      var re = /[^.!?]+[.!?]+|\S+$/g;
      var match;
      while ((match = re.exec(text))) {
        var s0 = match.index;
        var e0 = match.index + match[0].length;
        if (pos2 >= s0 && pos2 < e0) {
          var t = e0;
          while (t > s0 && /\s/.test(text[t - 1])) t--;
          return { start: s0, end: t, text: text.slice(s0, t) };
        }
      }
    }
    return { start: 0, end: text.length, text: text };
  }

  // ---------- word segmentation ----------
  // Intl.Segmenter's word granularity treats a hyphen as its own (non-word-
  // like) segment, splitting "well-known" into "well" / "-" / "known". A
  // word scope must keep a hyphenated word whole, so after finding the base
  // word-like segment at `idx`, we expand outward across any run of
  // single-hyphen joins to word-like neighbours on either side. The ASCII
  // hyphen-minus isn't the only character used this way in real text, so the
  // non-breaking hyphen (U+2011) and standalone hyphen (U+2010) join too.
  var HYPHEN_JOIN_CHARS = { '-': true, '‐': true, '‑': true };

  // `idx` comes from a caret API and, like getSentenceAt, can legitimately
  // equal `text.length` (tapping the very last character of a block reports
  // an offset one past it). Without the same clamp-plus-adjacent-candidate
  // handling getSentenceAt uses, that off-by-one silently fails to match any
  // word segment and falls back to the whole block's text.
  function getWordAt(text, idx) {
    if (!text.length) return { start: 0, end: 0, text: '' };
    var clamped = idx < 0 ? 0 : idx > text.length - 1 ? text.length - 1 : idx;
    var candidates = clamped > 0 ? [clamped, clamped - 1] : [clamped];

    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        var segments = Array.from(
          new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)
        );
        for (var c = 0; c < candidates.length; c++) {
          var pos = candidates[c];
          var found = -1;
          for (var i = 0; i < segments.length; i++) {
            var seg = segments[i];
            if (pos >= seg.index && pos < seg.index + seg.segment.length) {
              found = i;
              break;
            }
          }
          if (found === -1) continue;
          if (!segments[found].isWordLike) {
            // Tapped a separator between words (e.g. the hyphen itself, or
            // punctuation/space): prefer the nearest word-like segment.
            var before = -1;
            for (var b = found - 1; b >= 0; b--) {
              if (segments[b].isWordLike) { before = b; break; }
            }
            var after = -1;
            for (var f = found + 1; f < segments.length; f++) {
              if (segments[f].isWordLike) { after = f; break; }
            }
            found = before !== -1 ? before : after;
          }
          if (found === -1) continue;
          var startIdx = found;
          var endIdx = found;
          while (
            startIdx > 1 &&
            HYPHEN_JOIN_CHARS[segments[startIdx - 1].segment] &&
            segments[startIdx - 2].isWordLike
          ) {
            startIdx -= 2;
          }
          while (
            endIdx < segments.length - 2 &&
            HYPHEN_JOIN_CHARS[segments[endIdx + 1].segment] &&
            segments[endIdx + 2].isWordLike
          ) {
            endIdx += 2;
          }
          var start = segments[startIdx].index;
          var end = segments[endIdx].index + segments[endIdx].segment.length;
          return { start: start, end: end, text: text.slice(start, end) };
        }
      } catch (e) {
        // fall through to the regex fallback below
      }
    }

    for (var c2 = 0; c2 < candidates.length; c2++) {
      var pos2 = candidates[c2];
      var re2 = /\S+/g;
      var m;
      while ((m = re2.exec(text))) {
        if (pos2 >= m.index && pos2 < m.index + m[0].length) {
          return { start: m.index, end: m.index + m[0].length, text: m[0] };
        }
      }
    }
    return { start: 0, end: text.length, text: text };
  }

  // ---------- section scope ----------
  // A section is not a tagged region: it is the span from the nearest
  // heading at or before a block up to (but not including) the next heading
  // of equal or shallower level — the same "heading-delimited region"
  // definition as the reference prototype (see FOR-440's ticket notes). A
  // block before any heading, or a page with no headings at all, is its own
  // section running from the top of the page to the first heading (or the
  // whole page).
  function isBefore(a, b) {
    return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function getHeadings() {
    var all = document.body.querySelectorAll('h1, h2, h3, h4, h5, h6');
    var headings = [];
    for (var i = 0; i < all.length; i++) {
      if (!isCommentModeUI(all[i])) headings.push(all[i]);
    }
    return headings;
  }

  function getSectionRange(block) {
    var headings = getHeadings();
    var start = null;
    for (var i = 0; i < headings.length; i++) {
      var h = headings[i];
      if (h === block || isBefore(h, block)) {
        start = h;
      } else {
        break;
      }
    }
    var level = start ? parseInt(start.tagName.charAt(1), 10) : 0;
    var end = null;
    if (start) {
      var startIndex = headings.indexOf(start);
      for (var j = startIndex + 1; j < headings.length; j++) {
        if (parseInt(headings[j].tagName.charAt(1), 10) <= level) {
          end = headings[j];
          break;
        }
      }
    } else {
      end = headings[0] || null;
    }
    return { start: start, end: end };
  }

  // ---------- tap resolution ----------
  function getCaretAt(clientX, clientY) {
    if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(clientX, clientY);
      if (pos && pos.offsetNode && pos.offsetNode.nodeType === 3) {
        return { node: pos.offsetNode, offset: pos.offset };
      }
      return null;
    }
    if (document.caretRangeFromPoint) {
      var range = document.caretRangeFromPoint(clientX, clientY);
      if (range && range.startContainer && range.startContainer.nodeType === 3) {
        return { node: range.startContainer, offset: range.startOffset };
      }
    }
    return null;
  }

  function rectContainsPoint(rect, clientX, clientY, tolerance) {
    if (rect.width === 0 && rect.height === 0) return false;
    return (
      clientX >= rect.left - tolerance &&
      clientX <= rect.right + tolerance &&
      clientY >= rect.top - tolerance &&
      clientY <= rect.bottom + tolerance
    );
  }

  function characterRect(node, index) {
    var length = node.nodeValue.length;
    if (index < 0 || index >= length) return null;
    try {
      var range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      return range.getBoundingClientRect();
    } catch (e) {
      return null;
    }
  }

  // A tap only counts as "on text" when the point actually falls inside the
  // rect of a real character near the caret API's guess, not just near it
  // (the caret APIs happily return the nearest text even for taps in blank
  // margins). resolveTap below is what handles a tap that isn't on text —
  // an element hit, or the nearest block by distance, flagged `near`.
  //
  // The caret API reports `offset` based on which side of a glyph's midpoint
  // the point falls on: a tap on the right half of a character can come back
  // as the offset of the *next* character. Checking only the rect at
  // `offset` therefore misses a tap that landed solidly on a real glyph, so
  // we also check the character immediately before it (`offset - 1`) and
  // accept whichever one actually contains the point.
  function pointIsOnCharacter(node, offset, clientX, clientY, tolerance) {
    tolerance = tolerance || 4;
    var length = node.nodeValue.length;
    if (length === 0) return false;
    var at = offset >= length ? length - 1 : offset;
    var rectAt = characterRect(node, at);
    if (rectAt && rectContainsPoint(rectAt, clientX, clientY, tolerance)) return true;
    var before = at - 1;
    if (before >= 0) {
      var rectBefore = characterRect(node, before);
      if (rectBefore && rectContainsPoint(rectBefore, clientX, clientY, tolerance)) return true;
    }
    return false;
  }

  // Resolves a tap point to everything scope resolution needs: the block it
  // landed in (directly, or the nearest one for a whitespace tap), the exact
  // text position when the tap landed on a real character, and the ordered
  // list of scopes the −/+ controls can step through from here. Returns null
  // when nothing block-level can be found at all (an empty document).
  //
  // A tap that isn't on a character resolves through the topmost element
  // under the point (elementsFromPoint, not the caret APIs — those always
  // return their nearest text guess even for a tap far from any character).
  // When that element isn't block-level either (a bare layout wrapper, or
  // nothing at all under the point), the nearest block by distance is used
  // and the anchor is flagged `near`, since it doesn't actually contain the
  // tapped point.
  function resolveTap(clientX, clientY) {
    var caret = getCaretAt(clientX, clientY);
    var onText = !!(caret && pointIsOnCharacter(caret.node, caret.offset, clientX, clientY));
    var textNode = onText ? caret.node : null;
    var textOffset = onText ? caret.offset : null;

    var block = null;
    if (onText) {
      // Real text tap: the original, non-leaf block rule (see the comment on
      // `containsBlockDescendant`).
      block = findBlockAncestor(textNode, isBlockTagOrDisplay);
      if (!block) onText = false;
    }

    var near = false;
    if (!onText) {
      var elems = document.elementsFromPoint ? document.elementsFromPoint(clientX, clientY) : [];
      var topEl = null;
      for (var i = 0; i < elems.length; i++) {
        if (elems[i].nodeType === 1 && !isCommentModeUI(elems[i])) {
          topEl = elems[i];
          break;
        }
      }
      // No real text under the tap: the stricter leaf rule, so a bare layout
      // wrapper still defers to a real descendant block.
      block = topEl ? findBlockAncestor(topEl, isBlockElLeaf) : null;
      if (!block) {
        block = nearestBlockByDistance(document.body, clientX, clientY);
        near = true;
      }
    }
    if (!block) return null;

    var levels = onText ? ['word', 'sentence', 'block', 'section'] : ['block', 'section'];
    var defaultScope = onText ? 'sentence' : 'block';
    return {
      block: block,
      textNode: textNode,
      textOffset: textOffset,
      onText: onText,
      near: near,
      levels: levels,
      levelIndex: levels.indexOf(defaultScope)
    };
  }

  // Converts a DOM Range's boundaries into offsets in a page-wide flattened
  // text index (see buildTextIndex), by matching the range's start/end
  // containers against the index's entries. Returns null when either
  // boundary's text node isn't in the index (e.g. the range came from a
  // detached or filtered-out node).
  function globalOffsetsForRange(range, pageIndex) {
    var globalStart = null;
    var globalEnd = null;
    for (var i = 0; i < pageIndex.entries.length; i++) {
      var entry = pageIndex.entries[i];
      if (entry.node === range.startContainer && globalStart === null) {
        globalStart = entry.start + range.startOffset;
      }
      if (entry.node === range.endContainer) {
        globalEnd = entry.start + range.endOffset;
      }
    }
    if (globalStart === null || globalEnd === null) return null;
    return { start: globalStart, end: globalEnd };
  }

  // Builds the {quote, near} anchor for a [start, end) span of a page-wide
  // flattened text, trimming any leading/trailing whitespace first —
  // including a buildTextIndex-inserted separator that happened to fall at
  // the very edge of the span (e.g. a block-scope quote that starts right at
  // a preceding cell/item boundary).
  function buildQuoteAnchor(text, start, end, near) {
    var s = start;
    var e = end;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    var anchor = {
      quote: {
        exact: text.slice(s, e),
        prefix: text.slice(Math.max(0, s - CONTEXT_CHARS), s),
        suffix: text.slice(e, e + CONTEXT_CHARS)
      }
    };
    if (near) anchor.near = true;
    return anchor;
  }

  // A structural fallback locator for an anchor whose quote text can't be
  // searched for on the page at all (an image's bracketed description isn't
  // literally there). `:nth-of-type` at each level, from document.body down,
  // is stable across reloads as long as the page's markup doesn't change.
  function cssPathFromBody(el) {
    var path = [];
    var node = el;
    while (node && node !== document.body && node.parentElement) {
      var tag = node.tagName.toLowerCase();
      var index = 1;
      var sibling = node;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === node.tagName) index++;
      }
      path.unshift(tag + ':nth-of-type(' + index + ')');
      node = node.parentElement;
    }
    return path.join(' > ');
  }

  // Resolves the anchor for one scope, given the context resolveTap
  // produced. Returns null when the scope can't be resolved (should not
  // normally happen for a scope resolveTap actually offered).
  function computeAnchorForScope(context, scope) {
    var pageIndex = buildTextIndex(document.body);

    if (scope === 'word' || scope === 'sentence') {
      var blockIndex = buildTextIndex(context.block);
      var localOffset = null;
      for (var i = 0; i < blockIndex.entries.length; i++) {
        var entry = blockIndex.entries[i];
        if (entry.node === context.textNode) {
          localOffset = entry.start + Math.min(context.textOffset, context.textNode.nodeValue.length);
          break;
        }
      }
      if (localOffset === null) return null;
      var seg = scope === 'word' ? getWordAt(blockIndex.text, localOffset) : getSentenceAt(blockIndex.text, localOffset);
      var range = rangeForOffsets(blockIndex.entries, seg.start, seg.end);
      if (!range) return null;
      var globals = globalOffsetsForRange(range, pageIndex);
      if (!globals) return null;
      var anchor = buildQuoteAnchor(pageIndex.text, globals.start, globals.end, false);
      anchor.scope = scope;
      return anchor;
    }

    if (scope === 'block') {
      var blockEntries = pageIndex.entries.filter(function (e) {
        return context.block.contains(e.node);
      });
      if (!blockEntries.length) {
        // A block with no text of its own (an image, an inline SVG/canvas/
        // video chart, or a wrapper around one): describe it instead of
        // anchoring to text that isn't there, and carry a CSS path to the
        // element itself, since the quote text search resolveAnchorRect and
        // locateAnchor otherwise rely on can never match a description that
        // isn't literally on the page.
        var imageLikeSelector = Object.keys(IMAGE_LIKE_LABELS).join(',');
        var imageLike = IMAGE_LIKE_LABELS[context.block.tagName]
          ? context.block
          : context.block.querySelector && context.block.querySelector(imageLikeSelector);
        var label = imageLike ? IMAGE_LIKE_LABELS[imageLike.tagName] : 'untitled';
        var description =
          imageLike && imageLike.tagName === 'IMG'
            ? '[image: ' + (imageLike.getAttribute('alt') || 'untitled') + ']'
            : imageLike
            ? '[' + label + ']'
            : '[untitled]';
        var blockAnchor = {
          quote: { exact: description, prefix: '', suffix: '' },
          scope: 'block',
          path: cssPathFromBody(context.block)
        };
        if (context.near) blockAnchor.near = true;
        return blockAnchor;
      }
      var blockAnchor2 = buildQuoteAnchor(
        pageIndex.text,
        blockEntries[0].start,
        blockEntries[blockEntries.length - 1].end,
        context.near
      );
      blockAnchor2.scope = 'block';
      return blockAnchor2;
    }

    // section
    var sectionRange = getSectionRange(context.block);
    var sectionEntries = pageIndex.entries.filter(function (e) {
      var afterStart = !sectionRange.start || isBefore(sectionRange.start, e.node);
      var beforeEnd = !sectionRange.end || isBefore(e.node, sectionRange.end);
      return afterStart && beforeEnd;
    });
    if (!sectionEntries.length) return null;
    var sectionAnchor = buildQuoteAnchor(
      pageIndex.text,
      sectionEntries[0].start,
      sectionEntries[sectionEntries.length - 1].end,
      context.near
    );
    sectionAnchor.scope = 'section';
    return sectionAnchor;
  }

  // ---------- locating a stored anchor back on the page ----------
  function commonPrefixLen(a, b) {
    var i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }

  function commonSuffixLen(a, b) {
    var i = a.length - 1;
    var j = b.length - 1;
    var n = 0;
    while (i >= 0 && j >= 0 && a[i] === b[j]) {
      n++;
      i--;
      j--;
    }
    return n;
  }

  function findAllOccurrences(text, needle) {
    var out = [];
    if (!needle) return out;
    var i = 0;
    while ((i = text.indexOf(needle, i)) !== -1) {
      out.push(i);
      i += 1;
    }
    return out;
  }

  // Finds the current DOM Range for a stored quote anchor. When the exact
  // quote occurs more than once on the page, the occurrence whose
  // surrounding text best matches the stored prefix/suffix wins. `pageIndex`
  // is optional — callers rendering many pins in one pass (renderPins)
  // build it once and pass it in, rather than each pin rebuilding a
  // whole-page index from scratch.
  function locateAnchor(quote, pageIndex) {
    pageIndex = pageIndex || buildTextIndex(document.body);
    var occurrences = findAllOccurrences(pageIndex.text, quote.exact);
    if (occurrences.length === 0) return null;

    var position = occurrences[0];
    if (occurrences.length > 1) {
      var bestScore = -1;
      occurrences.forEach(function (pos) {
        var pre = pageIndex.text.slice(Math.max(0, pos - CONTEXT_CHARS), pos);
        var suf = pageIndex.text.slice(pos + quote.exact.length, pos + quote.exact.length + CONTEXT_CHARS);
        var score =
          commonSuffixLen(pre, quote.prefix || '') + commonPrefixLen(suf, quote.suffix || '');
        if (score > bestScore) {
          bestScore = score;
          position = pos;
        }
      });
    }

    return rangeForOffsets(pageIndex.entries, position, position + quote.exact.length);
  }

  // Finds where a stored anchor currently is on the page, as a rect a pin
  // can be placed at. Quote text is tried first (locateAnchor); an anchor
  // with no text of its own (an image's `[image: ...]` description can never
  // match a text search, since it isn't literally on the page) falls back to
  // its stored CSS path instead, using the element's own rect rather than a
  // Range — `Range.selectNodeContents` on a childless element like <img>
  // produces a zero-size range regardless of how large the image actually
  // renders.
  //
  // `anchor.path` is built (cssPathFromBody) as a chain of `tag:nth-of-type`
  // steps joined by `>`, relative to document.body — but `body.querySelector`
  // matches that selector chain anywhere in the document, not only when its
  // first step is a direct child of body. Two images under structurally
  // similar ancestors (e.g. both the first `div` of their respective
  // parents) can produce the same `div:nth-of-type(1) > img:nth-of-type(1)`
  // path and collide. `:scope > ` anchors the first step to an actual direct
  // child of body, matching how the path was built.
  function resolveAnchorRect(anchor, pageIndex) {
    if (anchor && anchor.quote && typeof anchor.quote.exact === 'string' && anchor.quote.exact) {
      var range = locateAnchor(anchor.quote, pageIndex);
      if (range) return range.getBoundingClientRect();
    }
    if (anchor && anchor.path) {
      try {
        var el = document.body.querySelector(':scope > ' + anchor.path);
        if (el) return el.getBoundingClientRect();
      } catch (e) {
        // malformed/stale path: fall through to "not found"
      }
    }
    return null;
  }

  // ---------- shadow DOM UI ----------
  // All of comment mode's own UI lives inside one Shadow DOM host appended to
  // <body>, for style isolation in both directions: `:host { all: initial }`
  // stops the host page's inherited styles (font, color, line-height, ...)
  // from leaking in, and a shadow root's <style> never leaks out because
  // shadow-tree stylesheets are scoped to that tree by definition. It also
  // means the module's own UI never appears in `document.body`'s text, so it
  // never needs to be filtered out of tap/sentence resolution.
  var CSS_TEXT = [
    // !important is required here: without it, any host-page rule that also
    // targets the shadow host element with !important (even a plain `div`
    // or `*` selector) beats a plain `all: initial` regardless of
    // specificity, letting inherited and layout properties leak in.
    ':host { all: initial !important; }',
    '.cm-root {',
    '  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '  color: #1a1a1a;',
    '  box-sizing: border-box;',
    '}',
    '.cm-root *, .cm-root *::before, .cm-root *::after { box-sizing: inherit; }',
    '.cm-toggle {',
    '  position: fixed;',
    '  right: 16px;',
    '  bottom: 16px;',
    '  z-index: 2147483000;',
    '  min-height: 44px;',
    '  padding: 10px 18px;',
    '  border-radius: 999px;',
    '  border: 1px solid #ccc;',
    '  background: #fff;',
    '  font: inherit;',
    '  color: inherit;',
    '  cursor: pointer;',
    '  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);',
    '}',
    '.cm-toggle.cm-active { background: #2563eb; color: #fff; border-color: #2563eb; }',
    '.cm-pin {',
    '  position: absolute;',
    '  width: 28px;',
    '  height: 28px;',
    '  border-radius: 50%;',
    '  background: #2563eb;',
    '  border: 2px solid #fff;',
    '  color: #fff;',
    '  font: inherit;',
    '  font-weight: 700;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  transform: translate(-50%, -50%);',
    '  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);',
    '  z-index: 2147482000;',
    '  cursor: pointer;',
    '}',
    '.cm-sheet {',
    '  position: fixed;',
    '  left: 0;',
    '  right: 0;',
    '  bottom: 0;',
    '  z-index: 2147483600;',
    '  background: #fff;',
    '  border-radius: 14px 14px 0 0;',
    '  box-shadow: 0 -2px 20px rgba(0, 0, 0, 0.25);',
    '  padding: 16px;',
    '  max-height: 70vh;',
    '  overflow-y: auto;',
    '}',
    '.cm-scope-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }',
    '.cm-scope-row button {',
    '  min-width: 36px;',
    '  min-height: 36px;',
    '  padding: 0;',
    '  border-radius: 8px;',
    '  border: 1px solid #ccc;',
    '  background: #f3f4f6;',
    '  font: inherit;',
    '  cursor: pointer;',
    '}',
    '.cm-scope-row button:disabled { opacity: 0.4; cursor: default; }',
    '.cm-scope-label {',
    '  font-size: 0.8rem;',
    '  color: #666;',
    '  text-transform: uppercase;',
    '  letter-spacing: 0.04em;',
    '}',
    '.cm-quote {',
    '  font-size: 0.85rem;',
    '  color: #444;',
    '  margin: 0 0 10px;',
    '  line-height: 1.4;',
    '}',
    '.cm-sentiment { display: flex; gap: 8px; margin: 0 0 10px; }',
    '.cm-sentiment-btn {',
    '  flex: 1;',
    '  min-height: 40px;',
    '  padding: 8px 10px;',
    '  border-radius: 8px;',
    '  border: 1px solid #ccc;',
    '  background: #f3f4f6;',
    '  font: inherit;',
    '  color: inherit;',
    '  cursor: pointer;',
    '}',
    '.cm-sentiment-btn.cm-sentiment-selected {',
    '  background: #2563eb;',
    '  color: #fff;',
    '  border-color: #2563eb;',
    '}',
    '.cm-textarea {',
    '  width: 100%;',
    '  min-height: 72px;',
    '  padding: 8px;',
    '  border: 1px solid #ccc;',
    '  border-radius: 8px;',
    '  font: inherit;',
    '  resize: vertical;',
    '}',
    '.cm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }',
    '.cm-actions button {',
    '  min-height: 40px;',
    '  padding: 8px 16px;',
    '  border-radius: 8px;',
    '  border: 1px solid #ccc;',
    '  background: #f3f4f6;',
    '  font: inherit;',
    '  cursor: pointer;',
    '}',
    '.cm-save { background: #2563eb !important; color: #fff; border-color: #2563eb !important; }',
    '.cm-delete { color: #b91c1c !important; border-color: #b91c1c !important; margin-right: auto; }',
    '.cm-resolve { color: #15803d !important; border-color: #15803d !important; }',
    '.cm-resolved-badge {',
    '  display: inline-block;',
    '  margin: 0 0 10px;',
    '  padding: 2px 8px;',
    '  border-radius: 999px;',
    '  background: #dcfce7;',
    '  color: #15803d;',
    '  font-size: 0.75rem;',
    '}',
    '.cm-replies { list-style: none; margin: 0 0 10px; padding: 0; border-top: 1px solid #eee; }',
    '.cm-reply { padding: 8px 0; border-bottom: 1px solid #eee; }',
    '.cm-reply-meta { font-size: 0.75rem; color: #666; margin: 0 0 4px; }',
    '.cm-reply-text { margin: 0; white-space: pre-wrap; }',
    '.cm-reply-form { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; }',
    '.cm-reply-btn {',
    '  align-self: flex-end;',
    '  min-height: 40px;',
    '  padding: 8px 16px;',
    '  border-radius: 8px;',
    '  border: 1px solid #ccc;',
    '  background: #f3f4f6;',
    '  font: inherit;',
    '  cursor: pointer;',
    '}',
    '.cm-show-resolved {',
    '  position: fixed;',
    '  right: 16px;',
    '  bottom: 66px;',
    '  z-index: 2147483000;',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 6px;',
    '  padding: 6px 12px;',
    '  border-radius: 999px;',
    '  border: 1px solid #ccc;',
    '  background: #fff;',
    '  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);',
    '  font: inherit;',
    '  font-size: 0.8rem;',
    '}'
  ].join('\n');

  function buildUI() {
    var host = document.createElement('div');
    host.setAttribute('data-comment-mode-host', '');
    document.body.appendChild(host);
    var shadow = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = CSS_TEXT;
    shadow.appendChild(style);

    var root = document.createElement('div');
    root.className = 'cm-root';
    shadow.appendChild(root);

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'cm-toggle';
    toggle.textContent = 'Comment mode';
    root.appendChild(toggle);

    // Resolved comments are hidden by default (see renderPins); this switch
    // is the only way to see them, and it lives outside the comment-mode
    // toggle's on/off state since reading resolved comments doesn't require
    // placement mode to be active.
    var showResolvedLabel = document.createElement('label');
    showResolvedLabel.className = 'cm-show-resolved';
    var showResolvedCheckbox = document.createElement('input');
    showResolvedCheckbox.type = 'checkbox';
    showResolvedLabel.appendChild(showResolvedCheckbox);
    showResolvedLabel.appendChild(document.createTextNode('Show resolved'));
    root.appendChild(showResolvedLabel);

    var pinsLayer = document.createElement('div');
    root.appendChild(pinsLayer);

    return {
      host: host,
      shadow: shadow,
      root: root,
      toggle: toggle,
      showResolvedCheckbox: showResolvedCheckbox,
      pinsLayer: pinsLayer
    };
  }

  // ---------- module ----------
  function init(config) {
    var pageReference = resolvePageReference(config);
    var storageKey = storageKeyFor(pageReference);
    var comments = loadComments(storageKey);
    var plugin = (config && config.storage) || browserOnlyPlugin();

    var syncEngine = createSyncEngine({
      plugin: plugin,
      pageReference: pageReference,
      getComments: function () { return comments; },
      setComments: function (next) {
        comments = next;
        saveComments(storageKey, comments);
      },
      onChange: function () { renderPins(); },
      eventTarget: global,
      document: typeof document !== 'undefined' ? document : undefined
    });
    // Reconcile with the plug-in's store asynchronously; pins already
    // rendered from local storage are the unchanged tracer-bullet UX.
    syncEngine.sync();

    // A plug-in that supports push updates (subscribe is optional) gets its
    // own changes merged in the same way as a sync() load, as soon as they
    // arrive rather than waiting for the next retry trigger. Unlike
    // load/save, which run inside the sync engine's own promise chain and so
    // can never crash init() by throwing, subscribe() runs synchronously
    // here: a plug-in whose subscribe() throws must not take the whole
    // module down with it, so it's wrapped and simply degrades to no push
    // updates.
    if (typeof plugin.subscribe === 'function') {
      try {
        plugin.subscribe(pageReference, function (remoteComments) {
          syncEngine.receiveChange(remoteComments);
        });
      } catch (e) {
        // Degrade to no push updates; sync() and its retry triggers still
        // cover this plug-in.
      }
    }

    // The host may identify who's commenting this session (a name, plus an
    // optional id) and attach its own open metadata slot; both are stamped
    // onto every comment this session creates. Neither is validated beyond
    // presence: comment mode has no identity or schema system of its own,
    // the host owns the shape of both (see CONTEXT.md's "Author" entry and
    // the FOR-438 spec's "meta" field description).
    var author = config && config.author ? config.author : null;
    var meta = config && Object.prototype.hasOwnProperty.call(config, 'meta') ? config.meta : undefined;

    // `ui` is only built once the DOM has a <body> to append to (see the
    // DOMContentLoaded deferral below), so init() itself never touches
    // document.body directly.
    var ui = null;
    var active = false;
    var sheetEl = null;
    var pendingAnchor = null;
    var showResolved = false;

    function isInsideOwnUI(target) {
      return !!(ui && target && target.nodeType === 1 && ui.host.contains(target));
    }

    function closeSheet() {
      if (sheetEl) {
        sheetEl.remove();
        sheetEl = null;
      }
      pendingAnchor = null;
    }

    function truncate(text, max) {
      return text.length > max ? text.slice(0, max - 1) + '…' : text;
    }

    function renderPin(comment, pageIndex) {
      // A single malformed stored comment (missing/invalid anchor, e.g. from
      // a future format or manual tampering) must not abort rendering the
      // rest, nor abort init() itself — skip it instead.
      try {
        if (
          !comment ||
          comment.deleted ||
          !comment.anchor ||
          !comment.anchor.quote ||
          typeof comment.anchor.quote.exact !== 'string'
        ) {
          return;
        }
        var rect = resolveAnchorRect(comment.anchor, pageIndex);
        if (!rect || (rect.width === 0 && rect.height === 0)) return;
        var pin = document.createElement('div');
        pin.className = 'cm-pin';
        pin.title = comment.text;
        pin.style.left = rect.left + global.scrollX + 'px';
        pin.style.top = rect.top + global.scrollY + 'px';
        // Reopening a pin is how editing/deleting an existing comment
        // happens (see openSheet's 'edit' mode below). This isn't gated on
        // `active`: placing a *new* comment requires comment mode to be on,
        // but reading/editing one that's already there doesn't.
        pin.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          openSheet('edit', { comment: comment });
        });
        ui.pinsLayer.appendChild(pin);
      } catch (e) {
        // Skip this comment; other comments still render.
      }
    }

    // Looks up a comment by id in the *current* `comments` array. A comment
    // captured when a pin was rendered (and so closed over by an edit
    // sheet) can become detached from `comments` by the time Save/Delete
    // actually runs: a sync reconcile (init sync, retry, or a subscribe
    // push) replaces `comments` wholesale with freshly merged objects, so
    // the old reference is no longer part of the array that gets persisted.
    // Falling back to the captured object only when the id can no longer be
    // found (which shouldn't happen: merges keep every local id, only ever
    // tombstoning) keeps a stray edit from vanishing into a detached object.
    function findCurrentComment(id) {
      for (var i = 0; i < comments.length; i++) {
        if (comments[i] && comments[i].id === id) return comments[i];
      }
      return null;
    }

    function renderPins() {
      if (!ui) return;
      ui.pinsLayer.innerHTML = '';
      // Build the page-wide text index once for the whole batch of pins,
      // rather than once per stored comment — with many comments on a large
      // page, rebuilding it per comment was the dominant cost of a re-render.
      var pageIndex = buildTextIndex(document.body);
      // A deleted comment stays in storage (see openSheet's delete handler)
      // but is never rendered, so it's never shown in any list either. A
      // resolved comment stays too, but is only rendered when the
      // show-resolved switch is on (see CONTEXT.md's "Resolved" entry).
      comments.forEach(function (comment) {
        if (comment && comment.deleted) return;
        if (comment && comment.resolved && !showResolved) return;
        renderPin(comment, pageIndex);
      });
    }

    // `mode` is 'create' (placing a new comment on a freshly resolved
    // anchor, where `data.context` is what resolveTap produced — the tapped
    // block/position and the ordered list of scopes available from here) or
    // 'edit' (reopened from an existing comment's pin, to change its
    // text/sentiment or delete it). There's no `context` in edit mode, so
    // the −/+ scope controls are disabled there: the anchor quote is always
    // read-only display, never itself editable on an existing comment
    // (scope resize is later ticket scope). The −/+ controls, when enabled,
    // only ever move `context.levelIndex` and recompute the anchor for the
    // new scope; they never re-resolve the original tap.
    function openSheet(mode, data) {
      closeSheet();
      var isEdit = mode === 'edit';
      var comment = isEdit ? data.comment : null;
      var context = isEdit ? null : data.context;
      var anchor = isEdit ? comment.anchor : data.anchor;
      pendingAnchor = anchor;

      var sheet = document.createElement('div');
      sheet.className = 'cm-sheet';

      var scopeRow = document.createElement('div');
      scopeRow.className = 'cm-scope-row';

      var narrow = document.createElement('button');
      narrow.type = 'button';
      narrow.setAttribute('aria-label', 'Narrow scope');
      narrow.textContent = '−';
      scopeRow.appendChild(narrow);

      var scopeLabel = document.createElement('span');
      scopeLabel.className = 'cm-scope-label';
      scopeRow.appendChild(scopeLabel);

      var widen = document.createElement('button');
      widen.type = 'button';
      widen.setAttribute('aria-label', 'Widen scope');
      widen.textContent = '+';
      scopeRow.appendChild(widen);

      sheet.appendChild(scopeRow);

      var quote = document.createElement('p');
      quote.className = 'cm-quote';
      sheet.appendChild(quote);

      function refresh() {
        if (context) {
          scopeLabel.textContent = context.levels[context.levelIndex];
          narrow.disabled = context.levelIndex === 0;
          widen.disabled = context.levelIndex === context.levels.length - 1;
        } else {
          // Edit mode has no context to step through: the scope an existing
          // comment was created with is fixed, so just display it.
          scopeLabel.textContent = pendingAnchor.scope || '';
          narrow.disabled = true;
          widen.disabled = true;
        }
        var text = '“' + truncate(pendingAnchor.quote.exact, 160) + '”';
        if (pendingAnchor.near) text += ' (near)';
        quote.textContent = text;
      }

      // Narrow (-1) and widen (+1) only ever differ in direction; both move
      // context.levelIndex and recompute the anchor for the new scope. A
      // no-op (no `context`, i.e. edit mode) since the buttons are disabled.
      function step(delta) {
        if (!context) return;
        var nextIndex = context.levelIndex + delta;
        if (nextIndex < 0 || nextIndex > context.levels.length - 1) return;
        var next = computeAnchorForScope(context, context.levels[nextIndex]);
        if (!next) return;
        context.levelIndex = nextIndex;
        pendingAnchor = next;
        refresh();
      }

      narrow.addEventListener('click', function () { step(-1); });
      widen.addEventListener('click', function () { step(1); });

      refresh();

      // Created up front (hidden when not resolved) rather than only on a
      // resolved comment, so the resolve/reopen handler below can toggle its
      // visibility in place instead of rebuilding the sheet, which would
      // otherwise discard whatever the sheet's own textarea/sentiment/reply
      // draft holds unsaved.
      var resolvedBadge = null;
      if (isEdit) {
        resolvedBadge = document.createElement('span');
        resolvedBadge.className = 'cm-resolved-badge';
        resolvedBadge.textContent = 'Resolved';
        resolvedBadge.style.display = comment.resolved ? '' : 'none';
        sheet.appendChild(resolvedBadge);
      }

      var currentSentiment =
        isEdit && comment.sentiment ? comment.sentiment : DEFAULT_SENTIMENT;
      var sentimentButtons = {};
      var sentimentWrap = document.createElement('div');
      sentimentWrap.className = 'cm-sentiment';
      SENTIMENTS.forEach(function (value) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cm-sentiment-btn';
        btn.textContent = SENTIMENT_LABELS[value];
        btn.setAttribute('aria-pressed', String(value === currentSentiment));
        btn.classList.toggle('cm-sentiment-selected', value === currentSentiment);
        btn.addEventListener('click', function () {
          currentSentiment = value;
          Object.keys(sentimentButtons).forEach(function (key) {
            var selected = key === value;
            sentimentButtons[key].classList.toggle('cm-sentiment-selected', selected);
            sentimentButtons[key].setAttribute('aria-pressed', String(selected));
          });
        });
        sentimentButtons[value] = btn;
        sentimentWrap.appendChild(btn);
      });
      sheet.appendChild(sentimentWrap);

      var textarea = document.createElement('textarea');
      textarea.className = 'cm-textarea';
      textarea.placeholder = 'Leave a comment…';
      if (isEdit) textarea.value = comment.text;
      sheet.appendChild(textarea);

      var actions = document.createElement('div');
      actions.className = 'cm-actions';

      if (isEdit) {
        var resolveBtn = document.createElement('button');
        resolveBtn.type = 'button';
        resolveBtn.className = 'cm-resolve';
        resolveBtn.textContent = comment.resolved ? 'Reopen' : 'Resolve';
        resolveBtn.addEventListener('click', function () {
          // Resolve/reopen is a toggle on the stored record, applied
          // immediately (not gated behind Save). It updates the badge,
          // button label and pin layer in place rather than rebuilding the
          // sheet (as delete's closeSheet()+renderPins() can afford to),
          // because rebuilding would throw away any text, sentiment or reply
          // draft the sheet is still holding unsaved. Toggle the *current*
          // record (see findCurrentComment), not the one captured when the
          // sheet opened, which a sync reconcile may have since detached
          // from `comments`.
          var live = findCurrentComment(comment.id) || comment;
          live.resolved = !live.resolved;
          live.updatedAt = new Date().toISOString();
          saveComments(storageKey, comments);
          // Browser-first, then sync: resolve/reopen is a mutation like any
          // other and must reach the plug-in the same way create/edit/delete
          // do.
          syncEngine.save(comments);
          renderPins();
          resolveBtn.textContent = live.resolved ? 'Reopen' : 'Resolve';
          resolvedBadge.style.display = live.resolved ? '' : 'none';
        });
        actions.appendChild(resolveBtn);

        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'cm-delete';
        del.textContent = 'Delete';
        del.addEventListener('click', function () {
          // A delete is a marker on the stored record, never a removal from
          // it: `comments` (and what's persisted) keeps the entry, only
          // hidden from rendering (see renderPins). That's what makes a
          // deleted comment stay gone across a reload, since the marker
          // itself is what gets loaded back. Mutate the *current* record
          // (see findCurrentComment), not the one captured when the sheet
          // opened, which a sync reconcile may have since detached from
          // `comments`.
          var live = findCurrentComment(comment.id) || comment;
          live.deleted = true;
          live.updatedAt = new Date().toISOString();
          saveComments(storageKey, comments);
          // Browser-first, then sync: a delete is a mutation like any other
          // and must reach the plug-in the same way create/edit do, not
          // just sit in localStorage until the next unrelated sync.
          syncEngine.save(comments);
          closeSheet();
          renderPins();
        });
        actions.appendChild(del);
      }

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', closeSheet);
      actions.appendChild(cancel);

      var save = document.createElement('button');
      save.type = 'button';
      save.className = 'cm-save';
      save.textContent = 'Save';
      save.addEventListener('click', function () {
        var text = textarea.value.trim();
        if (!text) return;
        if (isEdit) {
          // Mutate the *current* record (see findCurrentComment), not the
          // one captured when the sheet opened: a sync reconcile that ran
          // while the sheet was open (init sync, retry, or a subscribe
          // push) may have replaced `comments` with freshly merged objects,
          // detaching `comment` from the array that actually gets saved.
          var live = findCurrentComment(comment.id) || comment;
          var changed = text !== live.text || currentSentiment !== live.sentiment;
          if (!changed) {
            closeSheet();
            return;
          }
          live.text = text;
          live.sentiment = currentSentiment;
          live.updatedAt = new Date().toISOString();
        } else {
          var created = {
            id: Date.now() + '-' + Math.random().toString(16).slice(2),
            anchor: pendingAnchor,
            text: text,
            sentiment: currentSentiment,
            createdAt: new Date().toISOString()
          };
          // Deep-copy author/meta so each comment holds an independent
          // snapshot taken at creation time; the host may later mutate its
          // own config object, and comments must not retroactively pick
          // that up (see FOR-441 review).
          if (author) created.author = JSON.parse(JSON.stringify(author));
          if (meta !== undefined) created.meta = JSON.parse(JSON.stringify(meta));
          comments.push(created);
        }
        saveComments(storageKey, comments);
        syncEngine.save(comments);
        closeSheet();
        renderPins();
      });
      actions.appendChild(save);

      sheet.appendChild(actions);

      if (isEdit) {
        // Replies only make sense on a comment that's already saved: there's
        // nothing to reply to yet in 'create' mode.
        function buildReplyItem(reply) {
          var item = document.createElement('li');
          item.className = 'cm-reply';
          var replyMeta = document.createElement('p');
          replyMeta.className = 'cm-reply-meta';
          replyMeta.textContent =
            (reply.author && reply.author.name ? reply.author.name : 'Anonymous') +
            ' · ' +
            new Date(reply.createdAt).toLocaleString();
          item.appendChild(replyMeta);
          var replyText = document.createElement('p');
          replyText.className = 'cm-reply-text';
          replyText.textContent = reply.text;
          item.appendChild(replyText);
          return item;
        }

        var repliesList = document.createElement('ul');
        repliesList.className = 'cm-replies';
        (comment.replies || []).forEach(function (reply) {
          repliesList.appendChild(buildReplyItem(reply));
        });
        // Only in the DOM when there's at least one reply, so an unreplied
        // comment doesn't show an empty list's border-top rule.
        if (comment.replies && comment.replies.length) {
          sheet.appendChild(repliesList);
        }

        var replyForm = document.createElement('div');
        replyForm.className = 'cm-reply-form';
        var replyTextarea = document.createElement('textarea');
        replyTextarea.className = 'cm-textarea';
        replyTextarea.placeholder = 'Reply…';
        replyForm.appendChild(replyTextarea);
        var replyBtn = document.createElement('button');
        replyBtn.type = 'button';
        replyBtn.className = 'cm-reply-btn';
        replyBtn.textContent = 'Reply';
        replyBtn.addEventListener('click', function () {
          var replyText = replyTextarea.value.trim();
          if (!replyText) return;
          var reply = {
            id: Date.now() + '-' + Math.random().toString(16).slice(2),
            text: replyText,
            createdAt: new Date().toISOString()
          };
          // Same snapshot rule as a comment's own author/meta (see the save
          // handler below): the reply keeps whatever the session's author
          // was at the moment it was written.
          if (author) reply.author = JSON.parse(JSON.stringify(author));
          // Append to the *current* record (see findCurrentComment), not
          // the one captured when the sheet opened, which a sync reconcile
          // may have since detached from `comments`.
          var live = findCurrentComment(comment.id) || comment;
          live.replies = (live.replies || []).concat([reply]);
          live.updatedAt = new Date().toISOString();
          saveComments(storageKey, comments);
          // Browser-first, then sync: a reply is a mutation like any other
          // and must reach the plug-in the same way create/edit/delete do.
          syncEngine.save(comments);
          // Appended in place, same reasoning as resolve/reopen above: a
          // full sheet rebuild would drop whatever the main textarea,
          // sentiment or this reply box itself still holds unsaved.
          if (!repliesList.parentNode) sheet.insertBefore(repliesList, replyForm);
          repliesList.appendChild(buildReplyItem(reply));
          replyTextarea.value = '';
          replyTextarea.focus();
        });
        replyForm.appendChild(replyBtn);
        sheet.appendChild(replyForm);
      }

      ui.root.appendChild(sheet);
      sheetEl = sheet;
      textarea.focus();
    }

    function setActive(next) {
      active = next;
      if (ui) {
        ui.toggle.classList.toggle('cm-active', active);
        ui.toggle.textContent = active ? 'Exit comment mode' : 'Comment mode';
      }
      document.documentElement.classList.toggle('comment-mode-active', active);
      if (!active) closeSheet();
    }

    // Blocking selection has to happen as early as pointerdown, before the
    // browser starts one; blocking navigation happens on click, since that
    // is when a link would otherwise follow. Neither depends on `ui`
    // existing yet, so both listeners can be attached immediately.
    document.addEventListener(
      'pointerdown',
      function (e) {
        if (!active || isInsideOwnUI(e.target)) return;
        e.preventDefault();
      },
      { capture: true }
    );

    document.addEventListener(
      'click',
      function (e) {
        if (!ui || !active || isInsideOwnUI(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        if (sheetEl) {
          closeSheet();
          return;
        }
        var context = resolveTap(e.clientX, e.clientY);
        if (!context) return;
        var anchor = computeAnchorForScope(context, context.levels[context.levelIndex]);
        if (!anchor) return;
        openSheet('create', { context: context, anchor: anchor });
      },
      { capture: true }
    );

    // A single rule, scoped to when comment mode is active, so a tap cannot
    // start a text selection on the host page. This is a behavioural
    // necessity, not comment mode's own visual styling, so it is injected as
    // a light-DOM rule rather than kept inside the Shadow DOM. document.head
    // already exists by the time init() runs, even from a <head> inline
    // script, so this doesn't need to be deferred.
    var behaviourStyle = document.createElement('style');
    behaviourStyle.textContent = '.comment-mode-active { -webkit-user-select: none; user-select: none; }';
    document.head.appendChild(behaviourStyle);

    // buildUI() appends to document.body, which doesn't exist yet when
    // init() is called from a <head> inline script. Defer that (and
    // everything depending on it) until the DOM is ready, so init() never
    // throws regardless of where it's called from.
    function attachUI() {
      ui = buildUI();
      ui.toggle.addEventListener('click', function () {
        setActive(!active);
      });
      ui.showResolvedCheckbox.addEventListener('change', function () {
        showResolved = ui.showResolvedCheckbox.checked;
        renderPins();
      });
      renderPins();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attachUI);
    } else {
      attachUI();
    }

    return {
      isActive: function () { return active; },
      setActive: setActive
    };
  }

  global.CommentMode = {
    init: init,
    plugins: { browserOnly: browserOnlyPlugin, webAddress: webAddressPlugin },
    // _internal exposes the merge and sync-engine building blocks for this
    // repo's own Node test suite to exercise without a DOM. It is not part
    // of the documented public surface and may change without notice.
    _internal: {
      mergeComments: mergeComments,
      createSyncEngine: createSyncEngine,
      storageKeyFor: storageKeyFor
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.CommentMode;
  }
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : global);
