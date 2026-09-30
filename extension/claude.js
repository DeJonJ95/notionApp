// Capture the open claude.ai conversation into Kove.
//
// A floating "Send to Kove" button appears on conversation views. Clicking it
// reads the RENDERED transcript out of the DOM and posts it to
// /api/clipper/conversation, which stores it as a page in the "Claude Chats"
// workspace. From there "Extract to database" can mine it for rows.
//
// Reading the DOM (rather than an API or a share link) is deliberate: it works
// on private conversations with no sharing step, and it's the same trick
// jobcapture.js uses for JS-rendered job boards.
//
// Two caveats worth knowing, both surfaced to the user in the button label
// and the toast:
//   • claude.ai's markup is not a public contract. SELECTORS below is an
//     ordered list of candidates with a whole-thread text fallback, so a
//     class rename degrades to "one big blob" instead of breaking.
//   • Very long threads may be virtualised — turns scrolled far out of view
//     can be absent from the DOM. The button shows the turn count it can see
//     so a short count on a long thread is obvious before you click.

(function () {
  'use strict';
  if (window.__koveClaudeCapture) return;
  window.__koveClaudeCapture = true;

  // ── Transcript scraping ───────────────────────────────────────────
  // Ordered candidates. Everything matching is collected, then nested
  // matches are dropped and the survivors sorted into document order.
  const SELECTORS = [
    { role: 'user', sel: '[data-testid="user-message"]' },
    { role: 'assistant', sel: '[data-testid="assistant-message"]' },
    { role: 'assistant', sel: '.font-claude-response' },
    { role: 'assistant', sel: '.font-claude-message' },
  ];

  // Chrome that sits inside message nodes but isn't part of what was said:
  // copy/retry/edit buttons, icons, the artifact preview card's controls.
  const NOISE = 'button,svg,noscript,style,script,[role="toolbar"],[aria-hidden="true"]';

  function nodeText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(NOISE).forEach((n) => n.remove());
    return (clone.innerText || clone.textContent || '')
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function collectTurns() {
    const found = [];
    for (const { role, sel } of SELECTORS) {
      document.querySelectorAll(sel).forEach((el) => found.push({ role, el }));
    }
    // Drop any node contained in another match — the selectors overlap
    // (an assistant message can match two of them, one nested in the other)
    // and we want each turn exactly once, at its outermost node.
    const outermost = found.filter(
      ({ el }) => !found.some((o) => o.el !== el && o.el.contains(el))
    );
    // Same element matched by two selectors → keep the first occurrence.
    const seen = new Set();
    const unique = outermost.filter(({ el }) => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });
    unique.sort((a, b) =>
      a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );
    return unique
      .map(({ role, el }) => ({ role, text: nodeText(el) }))
      .filter((t) => t.text.length > 0);
  }

  // Last resort when the selectors find nothing: hand over the readable body
  // as a single turn. Loses the speaker labels; keeps the content.
  function fallbackTurns() {
    const root = document.querySelector('main') || document.body;
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,nav,header,footer,svg,iframe,form').forEach((e) => e.remove());
    const text = (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
    return text.length > 200 ? [{ role: 'user', text }] : [];
  }

  function conversationTitle() {
    const h = document.querySelector('main h1, [data-testid="chat-menu-trigger"]');
    const fromDom = h && (h.innerText || '').trim();
    if (fromDom) return fromDom.slice(0, 200);
    // document.title is "<chat name> - Claude" on a named conversation.
    return (document.title || '').replace(/\s*[-–|]\s*Claude\s*$/i, '').trim().slice(0, 200);
  }

  function pathLooksLikeConversation() {
    return /^\/(chat|project\/[^/]+\/chat)\/[^/]+/.test(location.pathname);
  }

  // ── UI ────────────────────────────────────────────────────────────
  function toast(msg, kind) {
    let t = document.getElementById('kove-claude-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'kove-claude-toast';
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
    if (kind !== 'busy') t._timer = setTimeout(() => { t.style.opacity = '0'; }, 4500);
  }

  async function capture() {
    let turns = collectTurns();
    let degraded = false;
    if (turns.length === 0) {
      turns = fallbackTurns();
      degraded = turns.length > 0;
    }
    if (turns.length === 0) {
      toast('Nothing to capture — is the conversation loaded?', 'err');
      return;
    }
    toast('Sending ' + turns.length + ' turn' + (turns.length === 1 ? '' : 's') + '…', 'busy');
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'captureConversation',
        payload: { sourceUrl: location.href, title: conversationTitle(), turns },
      });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Capture failed');
      const verb = res.created ? 'Saved' : 'Updated';
      toast(
        verb + ' ' + res.turnCount + ' turn' + (res.turnCount === 1 ? '' : 's') + ' in Kove' +
          (degraded ? ' (as one block — speaker labels unavailable)' : ''),
        'ok'
      );
    } catch (e) {
      toast(e.message || 'Capture failed', 'err');
    }
  }

  let btn = null;
  function ensureButton() {
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = 'kove-claude-btn';
    btn.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483646;display:none;' +
      'align-items:center;gap:6px;padding:9px 13px;border:0;border-radius:9px;' +
      'background:#D97757;color:#fff;font:600 12px system-ui;cursor:pointer;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.25)';
    btn.addEventListener('click', capture);
    document.documentElement.appendChild(btn);
    return btn;
  }

  // Show the button when the URL looks like a conversation OR when turns are
  // actually on screen. The second half matters: if claude.ai changes its URL
  // shape, a path-only gate would hide the button with no error anywhere.
  let lastLogged = -1;
  function evaluate() {
    const b = ensureButton();
    const count = collectTurns().length;
    const show = pathLooksLikeConversation() || count > 0;
    if (count !== lastLogged) {
      lastLogged = count;
      console.log('[Kove] claude.js — path', location.pathname, '· turns detected:', count,
        count === 0 ? '(selectors found nothing; capture will fall back to one block)' : '');
    }
    b.style.display = show ? 'flex' : 'none';
    b.textContent = count > 0 ? '💬 Send ' + count + ' turns to Kove' : '💬 Send to Kove';
    b.title = count > 0
      ? 'Captures the ' + count + ' turns currently in the page. Scroll up first if the thread is long.'
      : 'Captures this conversation into your Kove Claude Chats workspace.';
  }

  // Re-check on SPA navigation and as turns stream in / scroll into view.
  let timer = null;
  const debouncedEval = () => { clearTimeout(timer); timer = setTimeout(evaluate, 700); };
  console.log('[Kove] claude.js loaded on', location.href);
  evaluate();
  new MutationObserver(debouncedEval).observe(document.documentElement, { childList: true, subtree: true });
  ['pushState', 'replaceState'].forEach((m) => {
    const orig = history[m];
    history[m] = function () { const r = orig.apply(this, arguments); debouncedEval(); return r; };
  });
  window.addEventListener('popstate', debouncedEval);
})();
