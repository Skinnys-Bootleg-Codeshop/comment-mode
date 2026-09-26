// A tiny in-process HTTP server implementing the web-address plug-in's
// documented request/response format (README "Storage plug-ins"), used only
// to run the storage contract suite against CommentMode.plugins.webAddress
// without a real network. Reuses test/serve.js's plain http.createServer
// pattern rather than adding a dependency.
'use strict';

var http = require('http');
var upsertById = require('./merge-by-id.js').upsertById;

function keyFor(pageReference) {
  return JSON.stringify(pageReference);
}

function createWebAddressServer() {
  var store = {};

  function upsert(pageReference, comments) {
    var key = keyFor(pageReference);
    store[key] = upsertById(store[key], comments);
  }

  var server = http.createServer(function (req, res) {
    var url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET') {
      var raw = url.searchParams.get('pageReference');
      var pageReference;
      try {
        pageReference = JSON.parse(raw);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid pageReference' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ comments: store[keyFor(pageReference)] || [] }));
      return;
    }

    if (req.method === 'POST') {
      var chunks = [];
      req.on('data', function (chunk) { chunks.push(chunk); });
      req.on('end', function () {
        var body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid body' }));
          return;
        }
        upsert(body.pageReference, body.comments);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
      return;
    }

    res.writeHead(405);
    res.end();
  });

  return {
    listen: function () {
      return new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', function () {
          resolve('http://127.0.0.1:' + server.address().port);
        });
      });
    },
    close: function () {
      return new Promise(function (resolve) {
        server.close(function () { resolve(); });
      });
    }
  };
}

module.exports = { createWebAddressServer: createWebAddressServer };
