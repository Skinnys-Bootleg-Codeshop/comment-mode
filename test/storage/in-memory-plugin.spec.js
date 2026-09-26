// Runs the public storage contract suite against the in-memory fake plug-in,
// proving the suite passes against a real (if trivial) implementation.
'use strict';

var runStorageContractSuite = require('../contract-suite.js').runStorageContractSuite;
var createInMemoryPlugin = require('../fakes/in-memory-plugin.js').createInMemoryPlugin;

runStorageContractSuite('in-memory plug-in', function () {
  return createInMemoryPlugin();
});
