// Toolbar-popup logic. Reads + writes the token, validates it against
// the notes app, and switches between the connect/connected views.

const $ = (id) => document.getElementById(id);

const API = self.NOTES_CLIPPER_CONFIG.apiBase;

function setStatus(text, kind) {
  const el = $('status');
  if (!text) {
    el.style.display = 'none';
    return;
  }
  el.textContent = text;
  el.className = `status ${kind || ''}`;
  el.style.display = 'block';
}

function showConnected(connected) {
  $('connectForm').style.display = connected ? 'none' : 'block';
  $('connected').style.display = connected ? 'block' : 'none';
}

async function refresh() {
  const { token } = await chrome.storage.local.get('token');
  if (token) {
    showConnected(true);
  } else {
    showConnected(false);
  }
}

// Early guard: the default placeholder in config.js sends requests to
// a domain we don't own, which returns Vercel's HTML 404 page. Show a
// clear error instead of letting the user think they're "Connected"
// when the URL is wrong.
function looksLikePlaceholder(url) {
  return /your-notes-app|example\.com|localhost:3000/.test(url) && !url.includes(location.host);
}

$('connect').addEventListener('click', async () => {
  const token = $('token').value.trim();
  if (!token) {
    setStatus('Paste a token first.', 'err');
    return;
  }
  $('connect').disabled = true;
  setStatus('Verifying…');
  try {
    if (!API || /your-notes-app\.vercel\.app/.test(API)) {
      throw new Error('Edit extension/config.js first — apiBase still has the placeholder URL.');
    }

    const res = await fetch(`${API}/api/clipper/pages`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Reading content-type catches the "wrong URL returning HTML" case
    // where status is 200 but the body is a 404 page or parking screen.
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error(
        `Server returned ${ct || 'unknown'} (status ${res.status}) — apiBase in config.js probably points to the wrong URL.`
      );
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(
        res.status === 401
          ? 'Token rejected. Double-check the value you copied.'
          : data.error || `Server returned ${res.status}`
      );
    }
    // Final sanity check on shape.
    const data = await res.json();
    if (!Array.isArray(data.pages)) {
      throw new Error('Unexpected response shape — make sure apiBase points to your notes app.');
    }

    await chrome.storage.local.set({ token });
    setStatus('Connected ✓', 'ok');
    setTimeout(() => { setStatus(''); showConnected(true); }, 500);
  } catch (e) {
    setStatus(e.message, 'err');
  } finally {
    $('connect').disabled = false;
  }
});

$('disconnect').addEventListener('click', async () => {
  await chrome.storage.local.remove('token');
  showConnected(false);
  $('token').value = '';
  setStatus('Disconnected.', '');
});

refresh();
