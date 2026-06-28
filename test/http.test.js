import test from "node:test";
import assert from "node:assert/strict";

import { assertBearer, parsePositiveInt, weakEtag } from "../src/http.js";

function requestWith(authorization) {
  return {
    headers: {
      get(name) {
        return name === "authorization" ? authorization : null;
      }
    }
  };
}

test("parsePositiveInt parses positive integers, else falls back", () => {
  assert.equal(parsePositiveInt("150", 10), 150);
  assert.equal(parsePositiveInt("0", 10), 10);
  assert.equal(parsePositiveInt("-5", 10), 10);
  assert.equal(parsePositiveInt(undefined, 10), 10);
  assert.equal(parsePositiveInt("not-a-number", 10), 10);
});

test("assertBearer only accepts the exact bearer token", () => {
  assert.equal(assertBearer(requestWith("Bearer s3cret"), "s3cret"), true);
  assert.equal(assertBearer(requestWith("Bearer wrong"), "s3cret"), false);
  assert.equal(assertBearer(requestWith("s3cret"), "s3cret"), false);
  assert.equal(assertBearer(requestWith(null), "s3cret"), false);
  assert.equal(assertBearer(requestWith("Bearer s3cret"), ""), false);
});

test("weakEtag is stable for equal content and differs otherwise", () => {
  assert.equal(weakEtag("hello"), weakEtag("hello"));
  assert.notEqual(weakEtag("hello"), weakEtag("hellp"));
  assert.match(weakEtag("hello"), /^W\/".+"$/);
});
