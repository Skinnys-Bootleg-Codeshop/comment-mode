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
 * This is the tracer bullet (Linear FOR-439): sentence scope only, a
 * text-quote anchor (exact quote plus short prefix/suffix context), and
 * browser-only storage. See CONTEXT.md and the ticket for what is
 * deliberately not here yet.
 */
(function (global) {
  'use strict';

  var META_PAGE_ID = 'comment-mode:page-id';
  var META_PAGE_VERSION = 'comment-mode:page-version';
  var STORAGE_PREFIX = 'comment-mode:comments:';
  var CONTEXT_CHARS = 32;

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
    if (config && config.pageReference && config.pageReference.id) {
      return config.pageReference;
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

  // ---------- text index helpers ----------
  // Flatten the text nodes under `root` into one string, remembering which
  // DOM text node backs each character range, so a plain-text offset can be
  // converted back into a DOM Range.
  function buildTextIndex(root) {
    var entries = [];
    var text = '';
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var value = node.nodeValue;
      if (!value) continue;
      entries.push({ node: node, start: text.length, end: text.length + value.length });
      text += value;
    }
    return { text: text, entries: entries };
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
  // Sentence resolution happens within the nearest block-level ancestor, so a
  // sentence never bleeds across paragraph/heading/list-item boundaries.
  var BLOCK_TAGS = [
    'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'BLOCKQUOTE', 'PRE'
  ];

  function isBlockEl(el) {
    if (!el || el.nodeType !== 1) return false;
    if (BLOCK_TAGS.indexOf(el.tagName) !== -1) return true;
    var display = global.getComputedStyle(el).display;
    return display === 'block' || display === 'list-item' || display === 'table-cell';
  }

  function findBlockAncestor(node) {
    var el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== document.body) {
      if (isBlockEl(el)) return el;
      el = el.parentElement;
    }
    return null;
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

  // A tap only counts as "on text" when the point actually falls inside the
  // rect of the character the caret API guessed, not just near it (the
  // caret APIs happily return the nearest text even for taps in blank
  // margins). The whitespace/block fallback for those taps is a later
  // ticket's scope, not this one: we simply do nothing.
  function pointIsOnCharacter(node, offset, clientX, clientY, tolerance) {
    tolerance = tolerance || 4;
    try {
      var length = node.nodeValue.length;
      if (length === 0) return false;
      var start = offset >= length ? length - 1 : offset;
      var range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + 1);
      var rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      return (
        clientX >= rect.left - tolerance &&
        clientX <= rect.right + tolerance &&
        clientY >= rect.top - tolerance &&
        clientY <= rect.bottom + tolerance
      );
    } catch (e) {
      return false;
    }
  }

  // Resolves a tap point to the sentence it lands on, and the exact quote +
  // prefix/suffix context (relative to the whole page's flattened text) that
  // makes up its text-quote anchor. Returns null when the tap isn't on text.
  function resolveTapToAnchor(clientX, clientY) {
    var caret = getCaretAt(clientX, clientY);
    if (!caret || !pointIsOnCharacter(caret.node, caret.offset, clientX, clientY)) {
      return null;
    }
    var block = findBlockAncestor(caret.node);
    if (!block) return null;

    var blockIndex = buildTextIndex(block);
    var localOffset = null;
    for (var i = 0; i < blockIndex.entries.length; i++) {
      var entry = blockIndex.entries[i];
      if (entry.node === caret.node) {
        localOffset = entry.start + Math.min(caret.offset, caret.node.nodeValue.length);
        break;
      }
    }
    if (localOffset === null) return null;

    var sentence = getSentenceAt(blockIndex.text, localOffset);
    var range = rangeForOffsets(blockIndex.entries, sentence.start, sentence.end);
    if (!range) return null;

    var pageIndex = buildTextIndex(document.body);
    var globalStart = null;
    var globalEnd = null;
    var startInfo = { node: range.startContainer, offset: range.startOffset };
    var endInfo = { node: range.endContainer, offset: range.endOffset };
    for (var j = 0; j < pageIndex.entries.length; j++) {
      var e = pageIndex.entries[j];
      if (e.node === startInfo.node && globalStart === null) {
        globalStart = e.start + startInfo.offset;
      }
      if (e.node === endInfo.node) {
        globalEnd = e.start + endInfo.offset;
      }
    }
    if (globalStart === null || globalEnd === null) return null;

    var exact = pageIndex.text.slice(globalStart, globalEnd);
    var prefix = pageIndex.text.slice(Math.max(0, globalStart - CONTEXT_CHARS), globalStart);
    var suffix = pageIndex.text.slice(globalEnd, globalEnd + CONTEXT_CHARS);

    return { range: range, quote: { exact: exact, prefix: prefix, suffix: suffix } };
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
  // surrounding text best matches the stored prefix/suffix wins.
  function locateAnchor(quote) {
    var pageIndex = buildTextIndex(document.body);
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
    '  cursor: default;',
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
    '.cm-quote {',
    '  font-size: 0.85rem;',
    '  color: #444;',
    '  margin: 0 0 10px;',
    '  line-height: 1.4;',
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
    '.cm-save { background: #2563eb !important; color: #fff; border-color: #2563eb !important; }'
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

    var pinsLayer = document.createElement('div');
    root.appendChild(pinsLayer);

    return { host: host, shadow: shadow, root: root, toggle: toggle, pinsLayer: pinsLayer };
  }

  // ---------- module ----------
  function init(config) {
    var pageReference = resolvePageReference(config);
    var storageKey = storageKeyFor(pageReference);
    var comments = loadComments(storageKey);

    var ui = buildUI();
    var active = false;
    var sheetEl = null;
    var pendingAnchor = null;

    function isInsideOwnUI(target) {
      return !!(target && target.nodeType === 1 && ui.host.contains(target));
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

    function renderPin(comment) {
      var range = locateAnchor(comment.anchor.quote);
      if (!range) return; // re-anchoring beyond an exact-match lookup is later scope
      var rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      var pin = document.createElement('div');
      pin.className = 'cm-pin';
      pin.title = comment.text;
      pin.style.left = rect.left + global.scrollX + 'px';
      pin.style.top = rect.top + global.scrollY + 'px';
      ui.pinsLayer.appendChild(pin);
    }

    function renderPins() {
      ui.pinsLayer.innerHTML = '';
      comments.forEach(renderPin);
    }

    function openSheet(anchor) {
      closeSheet();
      pendingAnchor = anchor;
      var sheet = document.createElement('div');
      sheet.className = 'cm-sheet';

      var quote = document.createElement('p');
      quote.className = 'cm-quote';
      quote.textContent = '“' + truncate(anchor.quote.exact, 160) + '”';
      sheet.appendChild(quote);

      var textarea = document.createElement('textarea');
      textarea.className = 'cm-textarea';
      textarea.placeholder = 'Leave a comment…';
      sheet.appendChild(textarea);

      var actions = document.createElement('div');
      actions.className = 'cm-actions';

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
        var comment = {
          id: Date.now() + '-' + Math.random().toString(16).slice(2),
          anchor: { quote: anchor.quote },
          text: text,
          createdAt: new Date().toISOString()
        };
        comments.push(comment);
        saveComments(storageKey, comments);
        closeSheet();
        renderPins();
      });
      actions.appendChild(save);

      sheet.appendChild(actions);
      ui.root.appendChild(sheet);
      sheetEl = sheet;
      textarea.focus();
    }

    function setActive(next) {
      active = next;
      ui.toggle.classList.toggle('cm-active', active);
      ui.toggle.textContent = active ? 'Exit comment mode' : 'Comment mode';
      document.documentElement.classList.toggle('comment-mode-active', active);
      if (!active) closeSheet();
    }

    ui.toggle.addEventListener('click', function () {
      setActive(!active);
    });

    // Blocking selection has to happen as early as pointerdown, before the
    // browser starts one; blocking navigation happens on click, since that
    // is when a link would otherwise follow.
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
        if (!active || isInsideOwnUI(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        if (sheetEl) {
          closeSheet();
          return;
        }
        var anchor = resolveTapToAnchor(e.clientX, e.clientY);
        if (!anchor) return;
        openSheet(anchor);
      },
      { capture: true }
    );

    // A single rule, scoped to when comment mode is active, so a tap cannot
    // start a text selection on the host page. This is a behavioural
    // necessity, not comment mode's own visual styling, so it is injected as
    // a light-DOM rule rather than kept inside the Shadow DOM.
    var behaviourStyle = document.createElement('style');
    behaviourStyle.textContent = '.comment-mode-active { -webkit-user-select: none; user-select: none; }';
    document.head.appendChild(behaviourStyle);

    renderPins();

    return {
      isActive: function () { return active; },
      setActive: setActive
    };
  }

  global.CommentMode = { init: init };
})(window);
