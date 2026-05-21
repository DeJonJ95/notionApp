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

$('connect').addEventListener('click', async () => {
  const token = $('token').value.trim();
  if (!token) {
    setStatus('Paste a token first.', 'err');
    return;
  }
  $('connect').disabled = true;
  setStatus('Verifying…');
  // Validate by hitting /pages — if it 200s the token is good.
  try {
    const res = await fetch(`${API}/api/clipper/pages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(
        res.status === 401
          ? 'Token rejected. Double-check the value you copied.'
          : `Server returned ${res.status}`
      );
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
