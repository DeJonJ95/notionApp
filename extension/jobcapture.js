// ApplyKit universal job capture — runs on every page (hiring.cafe is handled
// by its own dedicated script and excluded in the manifest).
//
// A floating "Capture this job" button appears ONLY when the page looks like a
// job posting: it has schema.org JobPosting JSON-LD, or it's on a known ATS /
// job-board host. Two capture paths:
//   • JSON-LD present  → parse it client-side → /api/jobs/ingest (rich).
//   • otherwise        → send the rendered visible text → /api/jobs/ingest-text
//     (the server LLM-extracts title/company). This handles JS-heavy sites
//     like Workday that a server-side fetch can't read.
//
// Reading the *rendered* DOM is the extension's advantage over the app's
// paste-a-URL flow, which only sees the initial server HTML.

(function () {
  'use strict';
  if (window.__applykitJobCapture) return;
  window.__applykitJobCapture = true;

  // ── JSON-LD JobPosting parsing (mirror of src/lib/jobs/jsonld.ts) ──
  function decodeEntities(s) {
    return s
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
      .replace(/&#0?39;|&rsquo;|&lsquo;|&apos;/gi, "'").replace(/&mdash;/gi, '—')
      .replace(/&[a-z]+;/gi, ' ');
  }
  function stripHtml(html) {
    if (!html) return '';
    return decodeEntities(
      html
        .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/tr|\/ul|\/ol)\s*\/?>/gi, '\n')
        .replace(/<\s*li[^>]*>/gi, '- ').replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, ''),
    ).replace(/\r/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }
  function asText(v) {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') return v.name || v.value || '';
    return String(v);
  }
  function collectJobPostings(node, out) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((n) => collectJobPostings(n, out)); return; }
    const t = node['@type'];
    if (Array.isArray(t) ? t.includes('JobPosting') : t === 'JobPosting') out.push(node);
    if (node['@graph']) collectJobPostings(node['@graph'], out);
  }
  function formatLocation(jp) {
    const remote = jp.jobLocationType === 'TELECOMMUTE' ||
      /telecommute|remote/i.test(JSON.stringify(jp.applicantLocationRequirements || ''));
    const jl = Array.isArray(jp.jobLocation) ? jp.jobLocation[0] : jp.jobLocation;
    const addr = jl && jl.address;
    const loc = addr
      ? [addr.addressLocality, addr.addressRegion, asText(addr.addressCountry)]
          .map(asText).filter(Boolean).join(', ')
      : '';
    return { loc, remote };
  }
  function formatSalary(jp) {
    const bs = jp.baseSalary;
    if (!bs) return '';
    const v = bs.value || bs;
    const currency = bs.currency || v.currency || 'USD';
    const unit = (v.unitText || '').toString().toUpperCase();
    const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : n);
    let amount = '';
    if (v.minValue && v.maxValue) amount = fmt(v.minValue) + ' - ' + fmt(v.maxValue);
    else if (v.value) amount = '' + fmt(v.value);
    else if (v.minValue) amount = fmt(v.minValue) + '+';
    if (!amount) return '';
    return currency + ' ' + amount + (unit ? ' per ' + unit : '');
  }
  function parseJsonLdJob() {
    const jobs = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((b) => {
      try { collectJobPostings(JSON.parse(b.textContent), jobs); } catch (e) { /* skip */ }
    });
    if (jobs.length === 0) return null;
    const jp = jobs[0];
    const title = asText(jp.title).trim();
    const company = asText(jp.hiringOrganization).trim();
    const descText = stripHtml(asText(jp.description));
    if (!title || !company || descText.length < 20) return null;
    const { loc, remote } = formatLocation(jp);
    const salary = formatSalary(jp);
    const employment = Array.isArray(jp.employmentType) ? jp.employmentType.join(', ') : jp.employmentType;
    const meta = [
      salary && 'Compensation: ' + salary,
      loc && 'Location: ' + loc,
      remote && 'Remote: Yes',
      employment && 'Employment type: ' + employment,
      jp.datePosted && 'Posted: ' + String(jp.datePosted).slice(0, 10),
    ].filter(Boolean);
    const description = (meta.length ? meta.join('\n') + '\n\n' : '') + descText;
    const applyUrl = (typeof jp.url === 'string' && /^https?:/i.test(jp.url)) ? jp.url : location.href;
    return { title, company, description: description.slice(0, 60000), location: loc || null, applyUrl };
  }

  // Strip chrome (nav/header/footer/scripts) and return the readable body text.
  function readableText() {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,nav,header,footer,svg,iframe,form').forEach((e) => e.remove());
    return (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ── job-page detection ────────────────────────────────────────────
  // Pure ATS hosts: every page is effectively a job posting.
  const ATS_HOSTS = [
    /(^|\.)greenhouse\.io$/, /(^|\.)lever\.co$/, /(^|\.)ashbyhq\.com$/,
    /(^|\.)myworkdayjobs\.com$/, /(^|\.)icims\.com$/, /(^|\.)smartrecruiters\.com$/,
    /(^|\.)jobvite\.com$/, /(^|\.)workable\.com$/, /(^|\.)breezy\.hr$/,
    /(^|\.)bamboohr\.com$/, /(^|\.)recruitee\.com$/, /(^|\.)pinpointhq\.com$/,
    /(^|\.)teamtailor\.com$/, /(^|\.)rippling\.com$/,
  ];
  // Aggregators: only show on a single-job view, not the feed/search.
  const AGGREGATORS = [
    { re: /(^|\.)linkedin\.com$/, path: /\/jobs\/view\// },
    { re: /(^|\.)indeed\.com$/, path: /viewjob|\/job\// },
    { re: /(^|\.)glassdoor\./, path: /job-listing|\/Job\//i },
    { re: /(^|\.)ziprecruiter\.com$/, path: /\/jobs?\// },
    { re: /(^|\.)dice\.com$/, path: /\/job(-detail)?\// },
    { re: /(^|\.)builtin\.com$/, path: /\/job\// },
    { re: /(^|\.)wellfound\.com$/, path: /\/jobs?\// },
    { re: /(^|\.)monster\.com$/, path: /job-openings|\/job\// },
  ];
  function hostLooksLikeJob() {
    const h = location.hostname;
    if (ATS_HOSTS.some((re) => re.test(h))) return true;
    return AGGREGATORS.some((a) => a.re.test(h) && a.path.test(location.pathname + location.search));
  }
  function looksLikeJob() {
    return !!parseJsonLdJob() || hostLooksLikeJob();
  }

  // ── UI ────────────────────────────────────────────────────────────
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
      const jp = parseJsonLdJob();
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
    if (btn) return btn;
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

  // Initial check + re-check on SPA navigations / late-rendered content.
  let timer = null;
  const debouncedEval = () => { clearTimeout(timer); timer = setTimeout(evaluate, 700); };
  evaluate();
  new MutationObserver(debouncedEval).observe(document.documentElement, { childList: true, subtree: true });
  // SPA route changes (LinkedIn/Indeed) don't fire on DOM mutations alone.
  ['pushState', 'replaceState'].forEach((m) => {
    const orig = history[m];
    history[m] = function () { const r = orig.apply(this, arguments); debouncedEval(); return r; };
  });
  window.addEventListener('popstate', debouncedEval);
})();
