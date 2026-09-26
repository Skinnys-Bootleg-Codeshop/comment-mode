// A tiny static file server for the Playwright suite, so the fixture page and
// comment-mode.js load over http:// (file:// breaks caretPositionFromPoint
// and localStorage origin rules in some browsers). No framework: this repo
// has no server of its own to run in production, only in tests.
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var port = process.env.PORT || 4173;

var CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

var server = http.createServer(function (req, res) {
  var urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/test/fixtures/page.html';
  var filePath = path.join(root, urlPath);

  // path.join already collapses `..` segments, but startsWith(root) alone is
  // insufficient: a sibling directory sharing root as a name prefix (e.g.
  // root "/a/b" vs "/a/bc") would also pass a naive startsWith check.
  // path.relative + rejecting any result that escapes upward (or is
  // absolute, which only happens on other platforms/drives) is exact.
  var relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    var ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// Bind to localhost only: this is a dev-only tool for the test suite, not a
// server meant to be reachable from other machines on the network.
server.listen(port, '127.0.0.1', function () {
  console.log('comment-mode test server listening on http://localhost:' + port);
});
