// ApplyKit capture — runs only on hiring.cafe.
//
// Two flows:
//   • "Capture this job"  — when a job's detail modal is open, scrape the
//      full Job Description tab + header fields and send one listing.
//   • "Import all"         — read the page's embedded ssrHits (the SSR'd
//      result set) and bulk-send a structured summary for each. Full JDs
//      aren't in ssrHits, so bulk sends the processed summary; opening a
//      job and hitting "Capture this job" upgrades it to the full JD.
//
// All network calls go through the background worker (which holds the bearer
// token) via chrome.runtime.sendMessage({ type: 'ingestJob' }). The server
// upserts on (userId, sourceUrl) — we use the employer apply_url as sourceUrl
// so both flows dedupe to the same listing.

(function () {
  'use strict';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MONEY = /\$\s?\d[\d.,]*\s?[kK]?(?:\s?[-–]\s?\$?\s?\d[\d.,]*\s?[kK]?)?(?:\s?\/\s?(?:yr|hr|year|hour|mo))?/;

  // ── tiny toast ────────────────────────────────────────────────────
  function toast(msg, kind) {
    let t = document.getElementById('applykit-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'applykit-toast';
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

  async function send(payload) {
    const res = await chrome.runtime.sendMessage({ type: 'ingestJob', payload });
    if (!res?.ok) throw new Error(res?.error || 'Capture failed');
    return res;
  }

  // ── scraping helpers ──────────────────────────────────────────────
  function openModal() {
    return document.querySelector('.chakra-modal__content');
  }

  // The "Apply now" control is a JS button (no href) and the only anchor is
  // the company logo, so resolve the real apply link by matching the open
  // job's title/company against the page's embedded ssrHits data.
  function resolveFromSsr(title, company) {
    for (const h of readSsrHits()) {
      const v5 = h.v5_processed_job_data || {};
      const ji = h.job_information || {};
      const ec = h.enriched_company_data || {};
      const t = v5.core_job_title || ji.title;
      if (t === title && (!company || ec.name === company)) {
        return { applyUrl: h.apply_url || '', field: v5.job_category || null };
      }
    }
    return { applyUrl: '', field: null };
  }

  // Click the "Job Description" tab and return the full JD text.
  async function readJobDescription(modal) {
    const tab = [...modal.querySelectorAll('button,[role="tab"]')]
      .find((b) => /^job description$/i.test((b.textContent || '').trim()));
    if (tab) { tab.click(); await sleep(450); }
    const body = modal.querySelector('.chakra-modal__body') || modal;
    const text = body.innerText || '';
    const marker = 'Copy Job Description';
    const i = text.lastIndexOf(marker);
    return (i >= 0 ? text.slice(i + marker.length) : text).trim();
  }

  // Pull title / company / location / salary out of the modal header lines.
  function readHeader(modal) {
    const lines = (modal.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
    let title = '', company = '', location = '', salary = '';
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!title && /^Posted\b.*ago$/i.test(l) && lines[i + 1]) title = lines[i + 1];
      if (!company && l.startsWith('@ ')) company = l.slice(2).trim();
      if (!salary && MONEY.test(l) && l.length < 40) salary = l.match(MONEY)[0];
      if (!location && /,\s*[A-Z]{2}\b|United States|Remote|, [A-Za-z]+$/.test(l) &&
          !l.startsWith('@') && l.length < 60 && !MONEY.test(l) &&
          !/^(Job|Company|Apply|Save|Website|View|Posted|Full View|Contact)/i.test(l)) location = l;
    }
    // Title fallback: the biggest heading in the modal.
    if (!title) {
      const h = modal.querySelector('h1, h2');
      if (h) title = (h.textContent || '').trim();
    }
    return { title, company, location, salary };
  }

  async function captureOpenJob() {
    const modal = openModal();
    if (!modal) { toast('Open a job first, then capture.', 'err'); return; }
    toast('Capturing…', 'busy');
    try {
      const { title, company, location, salary } = readHeader(modal);
      const jd = await readJobDescription(modal);
      if (!title || !company) throw new Error('Could not read the job header');
      if (jd.length < 20) throw new Error('Job description looked empty');

      // apply_url comes from the matching ssrHit (the "Apply now" button has
      // no href). If the job was loaded past the SSR set, fall back to a
      // stable hiring.cafe-scoped URL so the listing still dedupes cleanly.
      const { applyUrl, field } = resolveFromSsr(title, company);
      const sourceUrl = applyUrl ||
        `https://hiring.cafe/#${encodeURIComponent(`${company}--${title}`.slice(0, 120))}`;

      const description =
        (salary ? `Compensation: ${salary}\n` : '') +
        (location ? `Location: ${location}\n` : '') +
        `\n${jd}`;

      await send({
        sourceUrl,
        applyUrl: applyUrl || null,
        company,
        title,
        location: location || null,
        field: field || null,
        description: description.slice(0, 60000),
      });
      toast(`Captured: ${title} @ ${company}`, 'ok');
    } catch (e) {
      toast(e.message || 'Capture failed', 'err');
    }
  }

  // ── bulk import from embedded ssrHits ─────────────────────────────
  function readSsrHits() {
    try {
      const nd = JSON.parse(document.getElementById('__NEXT_DATA__').textContent);
      return nd?.props?.pageProps?.ssrHits || [];
    } catch { return []; }
  }

  function hitToPayload(h) {
    const v5 = h.v5_processed_job_data || {};
    const ec = h.enriched_company_data || {};
    const ji = h.job_information || {};
    const title = v5.core_job_title || ji.title;
    const company = ec.name;
    const applyUrl = h.apply_url;
    if (!title || !company || !applyUrl) return null;

    const min = v5.yearly_min_compensation, max = v5.yearly_max_compensation;
    const salary = min ? (max && max !== min ? `$${min} - $${max}/yr` : `$${min}/yr`) : '';
    const loc = v5.formatted_workplace_location ||
      (Array.isArray(v5.workplace_countries) ? v5.workplace_countries.join(', ') : '');
    const acts = Array.isArray(v5.role_activities) ? v5.role_activities.join('; ') : '';
    const tools = Array.isArray(v5.technical_tools) ? v5.technical_tools.join(', ') : '';

    const description =
      `${title} at ${company}.\n` +
      (salary ? `Compensation: ${salary}\n` : '') +
      (loc ? `Location: ${loc}\n` : '') +
      (v5.workplace_type ? `Workplace: ${v5.workplace_type}\n` : '') +
      (v5.seniority_level ? `Seniority: ${v5.seniority_level}\n` : '') +
      (v5.requirements_summary ? `\nRequirements: ${v5.requirements_summary}\n` : '') +
      (acts ? `Responsibilities: ${acts}\n` : '') +
      (tools ? `Tools: ${tools}\n` : '') +
      `\n(Structured summary imported from hiring.cafe — open the job and "Capture this job" for the full description.)`;

    return {
      sourceUrl: applyUrl,
      applyUrl,
      company,
      title,
      location: loc || null,
      field: v5.job_category || null,
      description: description.slice(0, 60000),
    };
  }

  async function importAll() {
    const hits = readSsrHits();
    if (hits.length === 0) { toast('No jobs found on this page to import.', 'err'); return; }
    if (!confirm(`Import ${hits.length} jobs from this page into ApplyKit as structured summaries?`)) return;
    let ok = 0, fail = 0;
    for (let i = 0; i < hits.length; i++) {
      const payload = hitToPayload(hits[i]);
      if (!payload) { fail++; continue; }
      toast(`Importing ${i + 1}/${hits.length}…`, 'busy');
      try { await send(payload); ok++; } catch { fail++; }
      await sleep(120); // be gentle on the API
    }
    toast(`Imported ${ok} job${ok === 1 ? '' : 's'}${fail ? `, ${fail} skipped` : ''}.`, fail && !ok ? 'err' : 'ok');
  }

  // ── floating UI ───────────────────────────────────────────────────
  function mkBtn(label, bg) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      `display:block;width:100%;margin-top:6px;padding:8px 12px;border:0;border-radius:8px;` +
      `background:${bg};color:#fff;font:600 12px system-ui;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2)`;
    return b;
  }

  function mountUI() {
    if (document.getElementById('applykit-ui')) return;
    const wrap = document.createElement('div');
    wrap.id = 'applykit-ui';
    wrap.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483646;width:170px';

    const capture = mkBtn('➕ Capture this job', '#7c3aed');
    capture.id = 'applykit-capture';
    capture.disabled = true;
    capture.style.opacity = '.45';
    capture.onclick = captureOpenJob;

    const bulk = mkBtn('📥 Import all on page', '#2563eb');
    bulk.onclick = importAll;

    wrap.append(capture, bulk);
    document.documentElement.appendChild(wrap);

    // Enable "Capture this job" only while a job modal is open.
    const sync = () => {
      const on = !!openModal();
      capture.disabled = !on;
      capture.style.opacity = on ? '1' : '.45';
    };
    new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
    sync();
  }

  if (document.body) mountUI();
  else window.addEventListener('DOMContentLoaded', mountUI);
})();
