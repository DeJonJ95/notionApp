# Notes Clipper — Chrome extension

Save images from any site (Pinterest, Tumblr, fashion blogs, anywhere) straight
into a chosen note on your notes app with one click.

## How it works

Clipping is **off by default** on every page. Turn it on per tab when you
want it:

- **Activate per page** — click the toolbar icon and hit **"Activate clipping
  on this page."** Hover buttons stay off everywhere else until you do.
- **Hover any image ≥80×80** (once activated) → a small "Save to notes" button
  floats over the top-right of the image.
- **Right-click any image** → "Save image to notes" in the context menu. This
  works on any page **without** activating — it's already an explicit action.
- Any path opens a picker: search through your 30 most recently-updated
  notes, click one → image lands on that note's canvas, full-res, hosted on
  your R2 bucket so it doesn't break if the source site removes it.

The activation state is remembered per tab (it survives reloads within that
tab) and clears when you close the browser.

## One-time setup (per browser)

### 1. Edit `config.js` to point at your deployment

```js
self.NOTES_CLIPPER_CONFIG = {
  apiBase: 'https://your-notes-app.vercel.app',
};
```

Replace with your actual app URL. No trailing slash.

For local dev: `http://localhost:3000`.

### 2. Generate a token

Sign into your notes app in your normal browser, go to **`/clipper`** (also
linked in the sidebar as "Browser clipper"), label your token something memorable
(e.g. "Laptop Chrome"), click **Generate**. **Copy the token** — you only get
to see it once.

### 3. Load the extension

1. Open `chrome://extensions/` (or `edge://extensions/` for Edge)
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Select this `extension/` folder
5. The extension's icon appears in your toolbar — click it
6. Paste your token → click **Connect**
7. You should see "Connected ✓"

You're done. The extension now works on every page you visit.

## Troubleshooting

- **"Not connected" error**: open the extension popup and paste your token again.
- **Token rejected**: the token was revoked from `/clipper`, or you copied it
  wrong. Generate a fresh one.
- **Hover button doesn't appear**: the image might be smaller than 80×80, or
  the host page is using shadow DOM. Right-click → "Save image to notes" still works.
- **"Could not reach the image source"**: the host site blocks bot User-Agents.
  Rare. No workaround beyond saving the image to disk and uploading manually.

## Privacy notes

- The extension only fires API requests when you click Save or open the picker.
- It does NOT read or transmit any page content otherwise.
- Tokens are stored in `chrome.storage.local` (per-profile, per-browser).
- All API traffic is HTTPS to your own notes app.

## Distribution

For personal use you can give friends this folder as a zip; they sideload with
"Load unpacked." For a wider audience, package and submit to the Chrome Web
Store ($5 one-time developer fee, ~1 week review).
