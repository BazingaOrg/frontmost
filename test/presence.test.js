import test from "node:test";
import assert from "node:assert/strict";

import {
  applyMessage,
  deriveStatus,
  normalizeMessage,
  publicState
} from "../src/presence.js";

test("switch updates app and heartbeat timestamp", () => {
  const state = applyMessage(null, {
    type: "switch",
    bundleId: "com.anthropic.claude",
    name: "Claude"
  }, 1000);

  assert.deepEqual(state.app, {
    bundleId: "com.anthropic.claude",
    name: "Claude"
  });
  assert.equal(state.presence, "active");
  assert.equal(state.lastActivityAt, 1000);
  assert.equal(state.lastHeartbeatAt, 1000);
});

test("heartbeat does not overwrite app or presence", () => {
  const previous = {
    app: { bundleId: "com.apple.Safari", name: "Safari" },
    presence: "locked",
    lastActivityAt: 1000,
    lastHeartbeatAt: 1000
  };

  const state = applyMessage(previous, { type: "heartbeat" }, 1060);

  assert.deepEqual(state.app, previous.app);
  assert.equal(state.presence, "locked");
  assert.equal(state.lastActivityAt, 1000);
  assert.equal(state.lastHeartbeatAt, 1060);
});

test("offline is derived from heartbeat age", () => {
  const state = {
    app: { bundleId: "com.apple.Safari", name: "Safari" },
    presence: "locked",
    lastActivityAt: 1000,
    lastHeartbeatAt: 1000
  };

  assert.equal(deriveStatus(state, 1149, 150), "locked");
  assert.equal(deriveStatus(state, 1151, 150), "offline");
});

test("public state keeps compatibility fields", () => {
  const state = {
    app: { bundleId: "com.apple.Safari", name: "Safari" },
    presence: "active",
    lastActivityAt: 1000,
    lastHeartbeatAt: 1000
  };

  assert.deepEqual(publicState(state, 1001, 150), {
    app: { bundleId: "com.apple.Safari", name: "Safari" },
    bundleId: "com.apple.Safari",
    name: "Safari",
    status: "active",
    presence: "active",
    lastActivityAt: 1000,
    lastHeartbeatAt: 1000,
    serverTime: 1001
  });
});

test("message normalization rejects invalid switch payloads", () => {
  assert.equal(normalizeMessage({ type: "switch", name: "Safari" }).ok, false);
  assert.equal(normalizeMessage({ type: "switch", bundleId: "com.apple.Safari" }).ok, false);
  assert.equal(normalizeMessage({ type: "unknown" }).ok, false);
});
