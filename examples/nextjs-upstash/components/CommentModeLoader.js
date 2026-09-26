import { useEffect } from 'react';

// Mounts comment mode on whatever page renders this component. Per
// docs/adr/0001-comment-mode-is-standalone.md, comment mode has no framework
// binding: it manages its own UI in a Shadow DOM root it appends to
// <body>, entirely outside React's tree, so this component renders nothing
// itself. All it does is load comment-mode.js (copied into public/, see
// this example's README) and call CommentMode.init() once, pointed at the
// /api/comments endpoint below via the webAddress storage plug-in.
export default function CommentModeLoader() {
  useEffect(() => {
    if (typeof window === 'undefined' || window.CommentMode) return;

    var script = document.createElement('script');
    script.src = '/comment-mode.js';
    script.onload = function () {
      window.CommentMode.init({
        pageReference: { id: 'nextjs-upstash-example' },
        storage: window.CommentMode.plugins.webAddress({ endpoint: '/api/comments' })
      });
    };
    document.body.appendChild(script);

    return function () {
      // The example never unmounts this component in normal use (it's
      // rendered once on the one page), but removing the injected script
      // tag on cleanup avoids leaving a duplicate behind if it ever does.
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, []);

  return null;
}
