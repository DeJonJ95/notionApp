// Runs on every page (manifest <all_urls>). Two responsibilities:
//   1. Show a "Save to notes" button when the user hovers an image
//      so they can save without right-clicking.
//   2. Render the picker overlay when either the hover-button or the
//      context-menu integration asks for it.
//
// Everything is namespaced with class prefix "nclip-" so we don't
// collide with host-page CSS. The picker UI is plain DOM (no React)
// to keep the bundle tiny and the host-page side-effects minimal.

(function () {
  'use strict';

  // ── Hover button ───────────────────────────────────────────────
  // A single floating button positioned over the currently-hovered
  // image. Cheaper than injecting per-image buttons because most
  // sites have hundreds of off-screen images.
  const hoverBtn = document.createElement('button');
  hoverBtn.className = 'nclip-save-btn';
  hoverBtn.textContent = '+ Save to notes';
  hoverBtn.style.position = 'fixed';
  document.documentElement.appendChild(hoverBtn);

  let hoveredImage = null;

  function updateHoverBtnPosition() {
    if (!hoveredImage) {
      hoverBtn.classList.remove('visible');
      return;
    }
    const r = hoveredImage.getBoundingClientRect();
    // Hide button for tiny images (icons, sprites) — usually noise.
    if (r.width < 80 || r.height < 80) {
      hoverBtn.classList.remove('visible');
      return;
    }
    hoverBtn.style.top = `${Math.max(8, r.top + 6)}px`;
    hoverBtn.style.left = `${Math.max(8, r.right - 100)}px`;
    hoverBtn.classList.add('visible');
  }

  document.addEventListener('mouseover', (e) => {
    const img = e.target instanceof HTMLImageElement ? e.target : null;
    if (img && img !== hoveredImage) {
      hoveredImage = img;
      updateHoverBtnPosition();
    } else if (!img && !hoverBtn.contains(e.target)) {
      // Hovering anything that's not an image and not our button → hide
      hoveredImage = null;
      hoverBtn.classList.remove('visible');
    }
  });

  window.addEventListener('scroll', updateHoverBtnPosition, true);
  window.addEventListener('resize', updateHoverBtnPosition);

  hoverBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!hoveredImage) return;
    // Prefer srcset best candidate if available; otherwise src.
    const url = bestImageUrl(hoveredImage);
    if (!url) return;
    openPicker(url, hoveredImage.alt || '');
  });

  function bestImageUrl(img) {
    // srcset gives us the largest version when available. Fall back to
    // currentSrc (the resolved version the browser chose), then src.
    if (img.srcset) {
      const candidates = img.srcset
        .split(',')
        .map((s) => s.trim().split(/\s+/))
        .filter((parts) => parts[0]);
      if (candidates.length > 0) {
        // Pick the highest density / width candidate
        candidates.sort((a, b) => {
          const aw = parseFloat(a[1]) || 0;
          const bw = parseFloat(b[1]) || 0;
          return bw - aw;
        });
        return candidates[0][0];
      }
    }
    return img.currentSrc || img.src;
  }

  // ── Picker overlay ─────────────────────────────────────────────
  // Built lazily on first open so pages we never clip from pay zero
  // cost beyond the hover button.
  let picker = null;

  function openPicker(sourceUrl, alt) {
    closePicker(); // never double-stack
    picker = buildPicker(sourceUrl, alt);
    document.documentElement.appendChild(picker.root);
    picker.search.focus();
    loadPages(picker);
  }

  function closePicker() {
    if (picker?.root?.parentNode) picker.root.remove();
    picker = null;
  }

  function buildPicker(sourceUrl, alt) {
    const root = document.createElement('div');
    root.className = 'nclip-picker-backdrop';

    const panel = document.createElement('div');
    panel.className = 'nclip-picker';
    root.appendChild(panel);

    // Header — image preview + close button
    const header = document.createElement('div');
    header.className = 'nclip-picker-header';
    const thumb = document.createElement('img');
    thumb.className = 'nclip-thumb';
    thumb.src = sourceUrl;
    thumb.alt = '';
    thumb.onerror = () => { thumb.style.opacity = '0.3'; };
    header.appendChild(thumb);
    const titleBlock = document.createElement('div');
    titleBlock.style.minWidth = '0';
    titleBlock.style.flex = '1';
    const title = document.createElement('p');
    title.className = 'nclip-picker-title';
    title.textContent = 'Save to which note?';
    titleBlock.appendChild(title);
    const sub = document.createElement('p');
    sub.className = 'nclip-picker-sub';
    sub.textContent = 'Pick a recent note or search.';
    titleBlock.appendChild(sub);
    header.appendChild(titleBlock);
    const close = document.createElement('button');
    close.className = 'nclip-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', closePicker);
    header.appendChild(close);
    panel.appendChild(header);

    // Search input
    const searchWrap = document.createElement('div');
    searchWrap.className = 'nclip-search';
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Search notes…';
    searchWrap.appendChild(search);
    panel.appendChild(searchWrap);

    // Page list
    const list = document.createElement('div');
    list.className = 'nclip-list';
    panel.appendChild(list);

    // Footer / status row
    const footer = document.createElement('div');
    footer.className = 'nclip-picker-footer';
    footer.textContent = 'Enter to save · Esc to close';
    panel.appendChild(footer);

    // Keyboard handling: Esc to close, Enter to save active item
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePicker();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const active = list.querySelector('.nclip-page-item.active');
        if (active) active.click();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveActive(list, e.key === 'ArrowDown' ? 1 : -1);
      }
    };
    root.addEventListener('keydown', handleKey);

    // Backdrop click closes
    root.addEventListener('click', (e) => {
      if (e.target === root) closePicker();
    });

    // Filter as the user types
    let allPages = [];
    search.addEventListener('input', () => {
      renderList(list, filterPages(allPages, search.value), sourceUrl, alt);
    });

    return {
      root,
      search,
      list,
      footer,
      setPages: (pages) => { allPages = pages; renderList(list, pages, sourceUrl, alt); },
      setStatus: (text, kind) => {
        list.innerHTML = '';
        const div = document.createElement('div');
        div.className = `nclip-status ${kind || ''}`;
        div.textContent = text;
        list.appendChild(div);
      },
    };
  }

  function filterPages(pages, q) {
    const query = q.trim().toLowerCase();
    if (!query) return pages;
    return pages.filter((p) => p.title.toLowerCase().includes(query));
  }

  function renderList(list, pages, sourceUrl, alt) {
    list.innerHTML = '';
    if (pages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'nclip-status';
      empty.textContent = 'No notes match.';
      list.appendChild(empty);
      return;
    }
    pages.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.className = 'nclip-page-item' + (i === 0 ? ' active' : '');
      const icon = document.createElement('span');
      icon.className = 'nclip-page-icon';
      icon.textContent = p.icon || '📄';
      const title = document.createElement('span');
      title.className = 'nclip-page-title';
      title.textContent = p.title;
      const ws = document.createElement('span');
      ws.className = 'nclip-page-ws';
      ws.textContent = p.workspaceName || '';
      btn.appendChild(icon);
      btn.appendChild(title);
      btn.appendChild(ws);
      btn.addEventListener('mouseenter', () => {
        list.querySelectorAll('.nclip-page-item.active').forEach((el) => el.classList.remove('active'));
        btn.classList.add('active');
      });
      btn.addEventListener('click', () => savePicked(p, sourceUrl, alt));
      list.appendChild(btn);
    });
  }

  function moveActive(list, delta) {
    const items = Array.from(list.querySelectorAll('.nclip-page-item'));
    if (items.length === 0) return;
    const currentIdx = items.findIndex((el) => el.classList.contains('active'));
    const nextIdx = ((currentIdx === -1 ? 0 : currentIdx + delta) + items.length) % items.length;
    items.forEach((el) => el.classList.remove('active'));
    items[nextIdx].classList.add('active');
    items[nextIdx].scrollIntoView({ block: 'nearest' });
  }

  async function loadPages(p) {
    p.setStatus('Loading…');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'getPages' });
      if (!res.ok) throw new Error(res.error || 'Failed to load');
      p.setPages(res.pages || []);
    } catch (err) {
      p.setStatus(err.message || String(err), 'err');
    }
  }

  async function savePicked(page, sourceUrl, alt) {
    const target = picker;
    if (!target) return;
    target.setStatus(`Saving to "${page.title}"…`);
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'saveImage',
        payload: { pageId: page.id, sourceUrl, alt },
      });
      if (!res.ok) throw new Error(res.error || 'Save failed');
      closePicker();
      showToast(`Saved to "${page.title}"`);
    } catch (err) {
      target.setStatus(err.message || String(err), 'err');
    }
  }

  function showToast(text, isError) {
    const t = document.createElement('div');
    t.className = 'nclip-toast' + (isError ? ' err' : '');
    t.textContent = text;
    document.documentElement.appendChild(t);
    setTimeout(() => { t.remove(); }, 2200);
  }

  // ── Context-menu route ─────────────────────────────────────────
  // background.js relays the "openPicker" message when the user
  // right-clicks an image and picks "Save image to notes".
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'openPicker' && msg.sourceUrl) {
      openPicker(msg.sourceUrl, '');
    }
  });
})();
