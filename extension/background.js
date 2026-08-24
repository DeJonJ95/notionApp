// Service worker — central message broker between content script,
// popup, and the notes app API. Holds no DOM; runs in a stripped-down
// MV3 worker context.

importScripts('config.js');

const API = self.NOTES_CLIPPER_CONFIG.apiBase;

// ── Token storage helpers ─────────────────────────────────────────
async function getToken() {
  const { token } = await chrome.storage.local.get('token');
  return token || '';
}

async function setToken(token) {
  await chrome.storage.local.set({ token });
}

// ── API client ────────────────────────────────────────────────────

// Parses a response as JSON but produces a USEFUL error when the server
// returns HTML (the common misconfiguration: apiBase points at the wrong
// domain → Vercel/Netlify 404 HTML → `<!doctype` parse explosion). Used
// by both fetchPages and saveImage.
async function readJson(res, opName) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    // Don't even try res.json() — the error from the parser is opaque.
    // Give the user something actionable instead.
    throw new Error(
      `${opName}: server returned ${ct || 'no content-type'} (status ${res.status}). ` +
      `Check apiBase in extension/config.js and reload the extension.`
    );
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `${opName} failed (${res.status})`);
  }
  return data;
}

async function fetchPages() {
  const token = await getToken();
  if (!token) throw new Error('Not connected — open the extension popup to paste your token.');
  const res = await fetch(`${API}/api/clipper/pages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await readJson(res, 'Load pages');
  return data.pages || [];
}

async function saveImage({ pageId, sourceUrl, alt }) {
  const token = await getToken();
  if (!token) throw new Error('Not connected');
  const res = await fetch(`${API}/api/clipper/save-image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageId, sourceUrl, alt }),
  });
  return readJson(res, 'Save image');
}

// ApplyKit: capture a scraped hiring.cafe listing into the jobs tracker.
// Same bearer-token auth as the clipper endpoints; the server upserts on
// (userId, sourceUrl) so re-capturing a job updates rather than duplicates.
async function ingestJob(payload) {
  const token = await getToken();
  if (!token) throw new Error('Not connected — open the extension popup to paste your token.');
  const res = await fetch(`${API}/api/jobs/ingest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJson(res, 'Capture job');
}

// Fallback capture for pages without JobPosting JSON-LD: send the visible page
// text and let the server LLM-extract the title/company.
async function ingestJobText(payload) {
  const token = await getToken();
  if (!token) throw new Error('Not connected — open the extension popup to paste your token.');
  const res = await fetch(`${API}/api/jobs/ingest-text`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJson(res, 'Capture job');
}

// Store a claude.ai conversation scraped by claude.js. The server upserts on
// the conversation id in the source URL, so re-capturing a thread you've
// added to updates the same page instead of duplicating it.
async function captureConversation(payload) {
  const token = await getToken();
  if (!token) throw new Error('Not connected — open the extension popup to paste your token.');
  const res = await fetch(`${API}/api/clipper/conversation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJson(res, 'Capture conversation');
}

// ── Per-tab activation state ───────────────────────────────────────
// Clipping is opt-in per tab: the content script ships dormant and only
// shows hover buttons once the user activates the current tab from the
// popup. We persist the active tab ids in session storage so the state
// survives a service-worker restart but clears when the browser closes.
async function getActiveTabs() {
  const { activeTabs } = await chrome.storage.session.get('activeTabs');
  return activeTabs || {};
}

async function setTabActive(tabId, active) {
  const tabs = await getActiveTabs();
  if (active) tabs[tabId] = true;
  else delete tabs[tabId];
  await chrome.storage.session.set({ activeTabs: tabs });
}

async function isTabActive(tabId) {
  const tabs = await getActiveTabs();
  return Boolean(tabs[tabId]);
}

// Forget a tab's state when it closes so the map doesn't grow unbounded.
chrome.tabs.onRemoved.addListener((tabId) => {
  setTabActive(tabId, false).catch(() => {});
});

// ── Message router ─────────────────────────────────────────────────
// All cross-frame communication goes through this; both content script
// and popup post messages here and await responses.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Content script asking, on load, whether ITS tab is active.
  if (msg?.type === 'getClipActive') {
    const tabId = _sender.tab?.id;
    if (tabId == null) {
      sendResponse({ active: false });
      return false;
    }
    isTabActive(tabId).then((active) => sendResponse({ active }));
    return true;
  }
  // Popup asking about a specific tab (it has no sender.tab of its own).
  if (msg?.type === 'getClipForTab') {
    isTabActive(msg.tabId).then((active) => sendResponse({ active }));
    return true;
  }
  // Popup flipping a tab on/off. Persist, then live-notify the content
  // script so it updates without a reload.
  if (msg?.type === 'setClipForTab') {
    setTabActive(msg.tabId, msg.active)
      .then(() =>
        chrome.tabs
          .sendMessage(msg.tabId, { type: 'applyClipActive', active: msg.active })
          .catch(() => {}) // tab may have no content script (chrome:// etc.)
      )
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === 'getPages') {
    fetchPages()
      .then((pages) => sendResponse({ ok: true, pages }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }
  if (msg?.type === 'saveImage') {
    saveImage(msg.payload)
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === 'ingestJob') {
    ingestJob(msg.payload)
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }
  if (msg?.type === 'ingestJobText') {
    ingestJobText(msg.payload)
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }
  if (msg?.type === 'captureConversation') {
    captureConversation(msg.payload)
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }
  if (msg?.type === 'setToken') {
    setToken(msg.token)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === 'getToken') {
    getToken().then((token) => sendResponse({ token }));
    return true;
  }
  return false;
});

// ── Context menu integration ──────────────────────────────────────
// Right-click any image on any page → "Save image to notes". Sends a
// message to the page's content script to open the picker overlay
// near the clicked image.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'clipper-save-image',
    title: 'Save image to notes',
    contexts: ['image'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'clipper-save-image') return;
  if (!info.srcUrl || !tab?.id) return;
  // Ask the content script to surface the picker with this image
  // pre-loaded. The content script knows the page DOM and can position
  // the overlay correctly.
  chrome.tabs.sendMessage(tab.id, {
    type: 'openPicker',
    sourceUrl: info.srcUrl,
  });
});
