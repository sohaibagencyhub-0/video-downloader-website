# Video Downloader

Download videos from **YouTube, TikTok, Facebook and Instagram** — fast, free,
no installation. Paste a link, pick MP4 or MP3 and a quality, press Convert,
then Download.

## How it works

- **Frontend** (`index.html`, `styles.css`, `app.js`) — static, English only.
  The Paste button reads the clipboard with `navigator.clipboard.readText()`;
  if the browser blocks clipboard access it focuses the input and shows the
  hint *"Clipboard blocked by your browser — press Ctrl+V to paste"*.
  Native Ctrl+V / long-press paste works through the input as usual.
- **`POST /api/resolve`** (`api/resolve.js`) — detects the platform and
  resolves the link with **free APIs only, no keys**:
  - YouTube → SaveTube chain over `cdn400–cdn406.savetube.vip`
    (`/v2/info` then `/download`, AES-128-CBC decrypt), qualities 720→480→360,
    MP3 audio at 128kbps.
  - TikTok → JawadTech `/download/tiktok` → `/download/ttdl` → tikwm
    (no-watermark video + MP3) → deline.
  - Facebook → aswin-sparky `fbdl` (`?url=` then `?ur=` fallback), HD/SD.
  - Instagram → aswin-sparky `igdl` → JawadTech `igdl` → JawadTech `/downloader`.
  - If every free service fails it returns an honest
    `{ ok: false, error }` — it never invents a link.
- **`GET /api/download?url=…&filename=…`** (`api/download.js`) — server-side
  proxy that streams the resolved file with a proper
  `Content-Disposition: attachment` header, so Download buttons actually
  save the file instead of opening a blocked CDN link.

Shared resolver logic lives in `lib/downloader.js` (plain Node.js, global
`fetch` + `node:crypto`, no npm dependencies).

## Run locally

```bash
# Full stack (frontend + API functions), needs the Vercel CLI:
npx vercel dev

# Frontend only (API calls will fail without the functions):
python3 -m http.server 8000
# then open http://localhost:8000
```

Syntax-check the JavaScript:

```bash
node --check app.js
node --check lib/downloader.js
node --check api/resolve.js
node --check api/download.js
```

## Deploy

1. Push this folder to GitHub.
2. In Vercel: **Add New → Project → Import** the repo. No build command,
   no environment variables, no framework preset needed.
3. Deploy. The site is live at the `*.vercel.app` URL Vercel gives you.

## Honest limitations

These are free third-party services, not an official API. They can be slow,
rate-limited or down for a while — YouTube's SaveTube in particular goes
through outages. When that happens the site shows a clear error and a retry
instead of a fake download button. Only download content you own or are
authorized to download.
