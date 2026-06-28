import test from "node:test";
import assert from "node:assert/strict";

import { hasPngSignature, iconKey, isValidBundleId, safeDecode } from "../src/icons.js";

test("isValidBundleId accepts real bundle ids and rejects junk", () => {
  assert.equal(isValidBundleId("com.apple.Safari"), true);
  assert.equal(isValidBundleId("com.anthropic.claude"), true);
  assert.equal(isValidBundleId("app-name_1.2"), true);
  assert.equal(isValidBundleId(""), false);
  assert.equal(isValidBundleId(".leading-dot"), false);
  assert.equal(isValidBundleId("has space"), false);
  assert.equal(isValidBundleId("path/traversal"), false);
  assert.equal(isValidBundleId("a".repeat(257)), false);
});

test("hasPngSignature only passes the 8-byte PNG magic", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const notPng = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  assert.equal(hasPngSignature(png.buffer), true);
  assert.equal(hasPngSignature(notPng.buffer), false);
  assert.equal(hasPngSignature(new Uint8Array([0x89, 0x50]).buffer), false);
});

test("safeDecode decodes or returns empty string on malformed input", () => {
  assert.equal(safeDecode("com.apple.Safari"), "com.apple.Safari");
  assert.equal(safeDecode("a%2Fb"), "a/b");
  assert.equal(safeDecode("%"), "");
});

test("iconKey namespaces the bundle id", () => {
  assert.equal(iconKey("com.apple.Safari"), "icon:com.apple.Safari");
});
