import { useEffect } from 'react';

// Mounts comment mode on whichever page renders this component, pointed at
// the page reference (and optionally author/meta) that page passes in as
// props. Per docs/adr/0001-comment-mode-is-standalone.md, comment mode has
// no framework binding: it manages its own UI in a Shadow DOM root it
// appends to <body>, entirely outside React's tree, so this component
// renders nothing itself. All it does is load comment-mode.js (copied into
// public/, see this example's README) and call CommentMode.init() once,
// pointed at the /api/comments endpoint below via the webAddress storage
// plug-in.
//
// `pageReference` must be unique per distinct page: two pages sharing one
// reference would share one comment thread. It is not defaulted here on
// purpose, so a second page using this component can't forget to set its
// own.
//
// Comment mode has no teardown (there is no "stop" call, and this effect's
// own cleanup only removes the injected <script> tag, not comment mode's
// Shadow DOM UI or its running sync engine — see this example's README,
// "No teardown"). A single-page app that swaps `pageReference` on the same
// mounted component, or navigates client-side between pages that each
// render this component, will not get a second, correctly-scoped comment
// mode instance: each distinct page needs its own full page load.
export default function CommentModeLoader({ pageReference, author, meta }) {
  useEffect(() => {
    if (typeof window === 'undefined' || window.CommentMode) return;

    var script = document.createElement('script');
    script.src = '/comment-mode.js';
    script.onload = function () {
      var options = {
        pageReference: pageReference,
        storage: window.CommentMode.plugins.webAddress({ endpoint: '/api/comments' })
      };
      if (author) options.author = author;
      if (meta) options.meta = meta;
      window.CommentMode.init(options);
    };
    document.body.appendChild(script);

    return function () {
      // The example never unmounts this component in normal use (it's
      // rendered once on the one page), but removing the injected script
      // tag on cleanup avoids leaving a duplicate behind if it ever does.
      // This does not undo CommentMode.init() itself; see the "No
      // teardown" note above.
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
