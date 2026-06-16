import {
  applyMessage,
  normalizeMessage,
  publicState
} from "./presence.js";
import {
  assertBearer,
  corsHeaders,
  json,
  notFound,
  parsePositiveInt,
  text,
  unauthorized
} from "./http.js";
import { WIDGET_JS } from "./widget-source.js";

const STATE_KEY = "state";
const MAX_ICON_BYTES = 512 * 1024;

export class PresenceActor {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/message") {
      return this.handleMessage(request);
    }

    if (request.method === "GET" && url.pathname === "/current") {
      const state = await this.ctx.storage.get(STATE_KEY);
      const offlineAfter = parsePositiveInt(this.env.OFFLINE_AFTER_SECONDS, 150);
      return json(publicState(state, undefined, offlineAfter), {
        headers: {
          "cache-control": "no-store"
        }
      });
    }

    return notFound();
  }

  async handleMessage(request) {
    let input;
    try {
      input = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, { status: 400 });
    }

    const normalized = normalizeMessage(input);
    if (!normalized.ok) {
      return json({ error: normalized.error }, { status: 400 });
    }

    const current = await this.ctx.storage.get(STATE_KEY);
    const next = applyMessage(current, normalized.message);
    await this.ctx.storage.put(STATE_KEY, next);

    return json({ ok: true });
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/widget.js") {
      return text(WIDGET_JS, {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/update") {
      if (!assertBearer(request, writeSecret(env))) {
        return unauthorized();
      }
      return forwardToPresence(request, env);
    }

    if (request.method === "GET" && url.pathname === "/current") {
      return current(request, env);
    }

    const iconMatch = url.pathname.match(/^\/icon\/([^/]+)$/);
    if (iconMatch && request.method === "POST") {
      if (!assertBearer(request, writeSecret(env))) {
        return unauthorized();
      }
      return putIcon(request, env, iconMatch[1]);
    }
    if (iconMatch && request.method === "GET") {
      return getIcon(env, iconMatch[1]);
    }

    return notFound();
  }
};

async function forwardToPresence(request, env) {
  const body = await request.text();
  const response = await presenceStub(env).fetch("https://frontmost.internal/message", {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") || "application/json"
    },
    body
  });

  return withCors(response);
}

async function current(request, env) {
  const url = new URL(request.url);
  const user = url.searchParams.get("user");
  const publicUser = env.PUBLIC_USER_ID;

  if (!publicUser || user !== publicUser) {
    return notFound();
  }

  const response = await presenceStub(env).fetch("https://frontmost.internal/current");
  const output = withCors(new Response(response.body, {
    status: response.status,
    headers: {
      ...Object.fromEntries(response.headers),
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  }));

  return output;
}

async function putIcon(request, env, encodedBundleId) {
  const bundleId = safeDecode(encodedBundleId);
  if (!isValidBundleId(bundleId)) {
    return json({ error: "Invalid bundle id." }, { status: 400 });
  }

  const contentType = request.headers.get("content-type") || "";
  if (contentType.toLowerCase().split(";")[0].trim() !== "image/png") {
    return json({ error: "Icon must be image/png." }, { status: 415 });
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_ICON_BYTES) {
    return iconSizeError();
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_ICON_BYTES) {
    return iconSizeError();
  }
  if (!hasPngSignature(body)) {
    return json({ error: "Icon body must be PNG bytes." }, { status: 415 });
  }

  await env.ICONS.put(iconKey(bundleId), body, {
    metadata: {
      contentType: "image/png",
      size: body.byteLength
    }
  });

  return json({ ok: true });
}

async function getIcon(env, encodedBundleId) {
  const bundleId = safeDecode(encodedBundleId);
  if (!isValidBundleId(bundleId)) {
    return json({ error: "Invalid bundle id." }, { status: 400 });
  }

  const icon = await env.ICONS.get(iconKey(bundleId), "arrayBuffer");
  if (!icon) {
    return notFound();
  }

  return new Response(icon, {
    headers: {
      ...corsHeaders(),
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable"
    }
  });
}

function presenceStub(env) {
  const user = env.PUBLIC_USER_ID;
  const id = env.PRESENCE.idFromName(user);
  return env.PRESENCE.get(id);
}

function writeSecret(env) {
  return env.FRONTMOST_WRITE_SECRET || env.IMA_WRITE_SECRET;
}

function withCors(response) {
  const next = new Response(response.body, response);
  next.headers.set("access-control-allow-origin", "*");
  next.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  next.headers.set("access-control-allow-headers", "authorization, content-type");
  return next;
}

function iconKey(bundleId) {
  return `icon:${bundleId}`;
}

function isValidBundleId(bundleId) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(bundleId);
}

function iconSizeError() {
  return json({ error: "Icon must be between 1 byte and 512 KiB." }, { status: 413 });
}

function hasPngSignature(body) {
  const bytes = new Uint8Array(body, 0, Math.min(body.byteLength, 8));
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((byte, index) => bytes[index] === byte);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
