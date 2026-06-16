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
  "PUBLIC_USER_ID": "bazinga",
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
<frontmost-badge user="bazinga"></frontmost-badge>
```

If you self-host `widget.js`, pass the Worker endpoint:

```html
<script src="/assets/frontmost-widget.js"></script>
<frontmost-badge user="bazinga" endpoint="https://<your-worker-domain>"></frontmost-badge>
```

The badge uses Shadow DOM. Your site controls placement and outer layout; the component controls its internal badge style. For now, customize the look by self-hosting or editing `src/widget-source.js`.

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

curl 'http://localhost:8787/current?user=bazinga'
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
