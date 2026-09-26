// Runs the public storage contract suite against CommentMode.plugins.webAddress,
// backed by a tiny in-process fake HTTP server implementing the documented
// request/response format (README "Storage plug-ins"). Proves the built-in
// web-address plug-in satisfies the same contract as any implementor's.
'use strict';

var test = require('node:test');
var runStorageContractSuite = require('../contract-suite.js').runStorageContractSuite;
var createWebAddressServer = require('../fakes/web-address-server.js').createWebAddressServer;
var CommentMode = require('../../comment-mode.js');

var servers = [];

runStorageContractSuite('web-address plug-in', async function () {
  var server = createWebAddressServer();
  var endpoint = await server.listen();
  servers.push(server);
  return CommentMode.plugins.webAddress({ endpoint: endpoint });
});

test.after(async function () {
  await Promise.all(servers.map(function (s) { return s.close(); }));
});
