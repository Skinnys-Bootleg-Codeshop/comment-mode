// A minimal stand-in for what Next.js builds for `res` on an API route:
// enough for lib/handler.js's `res.status(code).json(body)` calls. Shared by
// test/contract.test.js and test/concurrency.test.js so both drive the real
// handler the same way.
'use strict';

function fakeResponse() {
  var res = {
    statusCode: undefined,
    body: undefined,
    status: function (code) {
      res.statusCode = code;
      return res;
    },
    json: function (payload) {
      res.body = payload;
      return res;
    }
  };
  return res;
}

module.exports = { fakeResponse: fakeResponse };
