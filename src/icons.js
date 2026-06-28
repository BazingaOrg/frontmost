import { corsHeaders, json, notFound } from "./http.js";

const MAX_ICON_BYTES = 512 * 1024;
// App icons rarely change, but they are not truly immutable (an app update can
// ship a new icon). A long-but-finite max-age lets caches refresh eventually
// without giving up the CDN win.
const ICON_CACHE_CONTROL = "public, max-age=604800";

export async function putIcon(request, env, encodedBundleId) {
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

export async function getIcon(env, encodedBundleId) {
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
      "cache-control": ICON_CACHE_CONTROL
    }
  });
}

export function iconKey(bundleId) {
  return `icon:${bundleId}`;
}

export function isValidBundleId(bundleId) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(bundleId);
}

export function hasPngSignature(body) {
  const bytes = new Uint8Array(body, 0, Math.min(body.byteLength, 8));
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((byte, index) => bytes[index] === byte);
}

export function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function iconSizeError() {
  return json({ error: "Icon must be between 1 byte and 512 KiB." }, { status: 413 });
}
