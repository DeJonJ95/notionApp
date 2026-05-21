// Per-install configuration. Edit this file to point the extension at
// your deployment. Both popup.js and background.js read these via
// importScripts() / <script> tag in popup.html.
//
// In a future version this could live in chrome.storage too so users
// could change it without editing files, but for v1 the URL is fixed.
self.NOTES_CLIPPER_CONFIG = {
  // Origin of your deployed notes app, no trailing slash.
  // For local dev override to "http://localhost:3000".
  apiBase: 'https://your-notes-app.vercel.app',
};
