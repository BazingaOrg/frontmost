import {
  applyMessage,
  DEFAULT_OFFLINE_AFTER_SECONDS,
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
  unauthorized,
  weakEtag
} from "./http.js";
import { getIcon, putIcon } from "./icons.js";
import { WIDGET_JS } from "./widget-source.js";

const STATE_KEY = "state";
const WIDGET_ETAG = weakEtag(WIDGET_JS);
// widget.js is static code; let caches hold it briefly and revalidate via ETag.
const WIDGET_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";

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
      const offlineAfter = parsePositiveInt(this.env.OFFLINE_AFTER_SECONDS, DEFAULT_OFFLINE_AFTER_SECONDS);
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
      const cacheHeaders = {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": WIDGET_CACHE_CONTROL,
        "etag": WIDGET_ETAG
      };
      if (request.headers.get("if-none-match") === WIDGET_ETAG) {
        return new Response(null, {
          status: 304,
          headers: { ...corsHeaders(), "cache-control": WIDGET_CACHE_CONTROL, "etag": WIDGET_ETAG }
        });
      }
      return text(WIDGET_JS, { headers: cacheHeaders });
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

function presenceStub(env) {
  const user = env.PUBLIC_USER_ID;
  const id = env.PRESENCE.idFromName(user);
  return env.PRESENCE.get(id);
}

function writeSecret(env) {
  return env.FRONTMOST_WRITE_SECRET;
}

function withCors(response) {
  const next = new Response(response.body, response);
  next.headers.set("access-control-allow-origin", "*");
  next.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  next.headers.set("access-control-allow-headers", "authorization, content-type");
  return next;
}
