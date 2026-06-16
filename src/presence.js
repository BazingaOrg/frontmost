export const DEFAULT_OFFLINE_AFTER_SECONDS = 150;

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function deriveStatus(state, now = nowSeconds(), offlineAfterSeconds = DEFAULT_OFFLINE_AFTER_SECONDS) {
  if (!state || !state.lastHeartbeatAt) {
    return "offline";
  }

  if (now - state.lastHeartbeatAt > offlineAfterSeconds) {
    return "offline";
  }

  return state.presence === "locked" || state.presence === "sleeping"
    ? state.presence
    : "active";
}

export function normalizeMessage(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Payload must be a JSON object." };
  }

  switch (input.type) {
    case "switch": {
      const bundleId = cleanString(input.bundleId, 256);
      const name = cleanString(input.name, 128);
      if (!bundleId || !name) {
        return { ok: false, error: "switch requires bundleId and name." };
      }
      return { ok: true, message: { type: "switch", bundleId, name } };
    }
    case "heartbeat":
      return { ok: true, message: { type: "heartbeat" } };
    case "lock":
    case "unlock":
    case "sleep":
    case "wake":
      return { ok: true, message: { type: input.type } };
    default:
      return { ok: false, error: "Unsupported message type." };
  }
}

export function applyMessage(state, message, now = nowSeconds()) {
  const next = {
    app: state?.app ?? null,
    presence: state?.presence ?? "active",
    lastActivityAt: state?.lastActivityAt ?? 0,
    lastHeartbeatAt: state?.lastHeartbeatAt ?? 0
  };

  if (message.type === "switch") {
    next.app = { bundleId: message.bundleId, name: message.name };
    next.presence = "active";
    next.lastActivityAt = now;
    next.lastHeartbeatAt = now;
    return next;
  }

  if (message.type === "heartbeat") {
    next.lastHeartbeatAt = now;
    return next;
  }

  if (message.type === "lock") {
    next.presence = "locked";
    next.lastActivityAt = now;
    next.lastHeartbeatAt = now;
    return next;
  }

  if (message.type === "unlock" || message.type === "wake") {
    next.presence = "active";
    next.lastActivityAt = now;
    next.lastHeartbeatAt = now;
    return next;
  }

  if (message.type === "sleep") {
    next.presence = "sleeping";
    next.lastActivityAt = now;
    next.lastHeartbeatAt = now;
    return next;
  }

  return next;
}

export function publicState(state, now = nowSeconds(), offlineAfterSeconds = DEFAULT_OFFLINE_AFTER_SECONDS) {
  const status = deriveStatus(state, now, offlineAfterSeconds);

  return {
    app: state?.app ?? null,
    bundleId: state?.app?.bundleId ?? null,
    name: state?.app?.name ?? null,
    status,
    presence: state?.presence ?? "active",
    lastActivityAt: state?.lastActivityAt ?? null,
    lastHeartbeatAt: state?.lastHeartbeatAt ?? null,
    serverTime: now
  };
}

function cleanString(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.slice(0, maxLength);
}
