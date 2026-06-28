# frontmost

A live "now using" badge for your Mac.

frontmost shows the foreground macOS app on any website as a small Web Component badge. It is self-hosted: your Mac reports to your own Cloudflare Worker, and your site reads the public status API.

## What It Exposes

- `POST /update` and `POST /icon/:bundleId` for the macOS collector. These require `Authorization: Bearer <secret>`.
- `GET /current?user=<id>` and `GET /icon/:bundleId` for public display. CORS is enabled.
- `GET /widget.js`, which registers `<frontmost-badge>`.
- `hammerspoon/init.lua`, the macOS collector template.

## Deploy

Install dependencies:

```sh
npm install
cp wrangler.example.jsonc wrangler.jsonc
```

Create the icon KV namespace:

```sh
npx wrangler kv namespace create ICONS
```

Paste the returned `id` into `wrangler.jsonc`, then set your public user id:

```jsonc
"vars": {
  "PUBLIC_USER_ID": "your-handle",
  "OFFLINE_AFTER_SECONDS": "150"
}
```

Create and upload a write secret:

```sh
openssl rand -base64 32
npx wrangler secret put FRONTMOST_WRITE_SECRET
```

Deploy:

```sh
npm run deploy
```

For a custom domain, add this to `wrangler.jsonc` before deploying:

```jsonc
"workers_dev": false,
"routes": [
  {
    "pattern": "frontmost.example.com",
    "custom_domain": true
  }
]
```

If the domain has Cloudflare security challenges enabled, skip WAF/Bot/Browser Integrity checks for this API hostname. Challenge pages break Hammerspoon and browser `fetch()`.

## Configure Hammerspoon

Install and open Hammerspoon:

```sh
brew install --cask hammerspoon
open -a Hammerspoon
```

Store the same write secret in Keychain:

```sh
security add-generic-password \
  -a write-secret \
  -s frontmost \
  -w '<your-write-secret>' \
  -U
```

Install the collector:

```sh
cp hammerspoon/init.lua ~/.hammerspoon/init.lua
```

Edit `~/.hammerspoon/init.lua`:

```lua
endpoint = "https://<your-worker-domain>/update"
```

Reload Hammerspoon. Logs are written to `~/.hammerspoon/frontmost.log`.

## Embed

Add this to any page:

```html
<script src="https://<your-worker-domain>/widget.js"></script>
<frontmost-badge user="your-handle"></frontmost-badge>
```

If you self-host `widget.js`, pass the Worker endpoint:

```html
<script src="/assets/frontmost-widget.js"></script>
<frontmost-badge user="your-handle" endpoint="https://<your-worker-domain>"></frontmost-badge>
```

The badge ships with minimal styling and inherits `color`, `font`, and `line-height` from its host. It renders inline (icon + name + a compact `12s` / `2m` / `locked` / `offline` indicator), without backgrounds, borders, or shadows — your site's typography drives the look.

Attributes:

| Attribute | Default | Purpose |
| --- | --- | --- |
| `user` | required | The user id served by your Worker. |
| `endpoint` | script origin | Override when self-hosting `widget.js`. |
| `interval` | `5000` (ms) | Poll cadence; clamped to >= 3000. |
| `hide-when-offline` | off | When set, the host element is hidden (`[hidden]`) while status is `offline`. |

Customize from the host page using CSS custom properties and shadow parts:

```css
frontmost-badge {
  --frontmost-icon-size: 1.4em;   /* icon scales with em */
  --frontmost-icon-radius: 6px;
}
frontmost-badge::part(name) { font-weight: 500; }
frontmost-badge::part(meta) { font-family: ui-monospace, monospace; }
frontmost-badge::part(icon) { box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.05); }
```

The badge also reflects its live state onto the host element, so you can style or label it (e.g. build your own tooltip) without reaching into the shadow DOM:

| Reflected attribute | When present | Value |
| --- | --- | --- |
| `data-status` | always after first poll | `active` / `locked` / `sleeping` / `offline` |
| `data-app-name` | only while `active` with a known app | the foreground app's name |

```css
frontmost-badge[data-status="offline"] { opacity: 0.6; }
```

For deeper changes (markup, copy), self-host or edit `src/widget-source.js`.

## Local Development

Create `.dev.vars`:

```sh
FRONTMOST_WRITE_SECRET=test-secret
```

Run the Worker:

```sh
npm run dev
```

Smoke test:

```sh
curl -X POST http://localhost:8787/update \
  -H 'Authorization: Bearer test-secret' \
  -H 'Content-Type: application/json' \
  -d '{"type":"switch","bundleId":"com.apple.Safari","name":"Safari"}'

curl 'http://localhost:8787/current?user=your-handle'
```

Test the local widget:

```sh
npm run dev:widget
cd dev
python3 -m http.server 8765
```

Open `http://localhost:8765/test-local.html`.

## Verify

```sh
npm run check
```
