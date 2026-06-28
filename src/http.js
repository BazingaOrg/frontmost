export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...init.headers
    }
  });
}

export function text(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: {
      ...corsHeaders(),
      ...init.headers
    }
  });
}

export function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type"
  };
}

export function unauthorized() {
  return json({ error: "Unauthorized." }, { status: 401 });
}

export function notFound() {
  return json({ error: "Not found." }, { status: 404 });
}

export function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Cheap, synchronous content fingerprint (FNV-1a) for a weak ETag — enough to
// let caches revalidate static assets like widget.js without a build step.
export function weakEtag(content) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `W/"${content.length.toString(16)}-${(hash >>> 0).toString(16)}"`;
}

export function assertBearer(request, secret) {
  if (!secret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}
