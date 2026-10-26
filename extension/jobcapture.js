// ApplyKit universal job capture — runs on every page (hiring.cafe is handled
// by its own dedicated script and excluded in the manifest).
//
// The button shows when jobdetect.js says the page is a job. JSON-LD goes to
// /api/jobs/ingest; otherwise the rendered text goes to /api/jobs/ingest-text,
// which reads JS-heavy sites (Workday) that the app's paste-a-URL fetch cannot.

(function () {
  'use strict';
  if (window.__applykitJobCapture) return;
  window.__applykitJobCapture = true;

  const { currentJsonLdJob, readableText, looksLikeJob } = self.applykitJob;

  function toast(msg, kind) {
    let t = document.getElementById('applykit-jc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'applykit-jc-toast';
      t.style.cssText =
        'position:fixed;bottom:84px;right:16px;z-index:2147483647;max-width:320px;' +
        'padding:10px 14px;border-radius:8px;font:13px system-ui;color:#fff;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.25);transition:opacity .3s;opacity:0';
      document.documentElement.appendChild(t);
    }
    t.style.background = kind === 'err' ? '#dc2626' : kind === 'busy' ? '#374151' : '#059669';
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    if (kind !== 'busy') t._timer = setTimeout(() => { t.style.opacity = '0'; }, 3500);
  }

  async function send(type, payload) {
    const res = await chrome.runtime.sendMessage({ type, payload });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Capture failed');
    return res;
  }

  async function capture() {
    toast('Capturing…', 'busy');
    try {
      const jp = currentJsonLdJob();
      if (jp) {
        await send('ingestJob', {
          sourceUrl: location.href, applyUrl: jp.applyUrl, company: jp.company,
          title: jp.title, location: jp.location, description: jp.description,
        });
        toast('Captured: ' + jp.title + ' @ ' + jp.company, 'ok');
      } else {
        const text = readableText();
        if (text.length < 200) throw new Error('No job description found on this page');
        await send('ingestJobText', {
          sourceUrl: location.href, applyUrl: location.href, text: text.slice(0, 120000),
        });
        toast('Captured this job', 'ok');
      }
    } catch (e) {
      toast(e.message || 'Capture failed', 'err');
    }
  }

  let btn = null;
  function ensureButton() {
    if (btn && btn.isConnected) return btn;
    btn = document.createElement('button');
    btn.id = 'applykit-jc-btn';
    btn.textContent = '➕ Capture this job';
    btn.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483646;display:none;' +
      'align-items:center;gap:6px;padding:9px 13px;border:0;border-radius:9px;' +
      'background:#7c3aed;color:#fff;font:600 12px system-ui;cursor:pointer;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.25)';
    btn.addEventListener('click', capture);
    document.documentElement.appendChild(btn);
    return btn;
  }

  function evaluate() {
    const b = ensureButton();
    b.style.display = looksLikeJob() ? 'flex' : 'none';
  }

  // Throttled, not debounced: busy pages (LinkedIn, Indeed) mutate faster than
  // any debounce window, which starved the check and left the button hidden.
  let pending = false;
  function scheduleEval() {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; evaluate(); }, 700);
  }
  evaluate();
  new MutationObserver(scheduleEval).observe(document.documentElement, { childList: true, subtree: true });
  // A content script's history.pushState patch never sees the page's own calls
  // (isolated world), so SPA route changes are caught by polling the URL.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    scheduleEval();
  }, 800);
  window.addEventListener('popstate', scheduleEval);
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'captureJob') capture();
  });
})();
