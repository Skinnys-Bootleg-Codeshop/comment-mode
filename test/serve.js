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

  if (!filePath.startsWith(root)) {
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

server.listen(port, function () {
  console.log('comment-mode test server listening on http://localhost:' + port);
});
