'use strict';
// Job-page detection + JobPosting JSON-LD parsing for jobcapture.js, which loads
// right after this file and reads `self.applykitJob`. A block, not an IIFE,
// keeps the helpers out of the shared content-script global scope.
{
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
    { re: /(^|\.)linkedin\.com$/, path: /\/jobs\/view\/|[?&]currentJobId=\d/ },
    { re: /(^|\.)indeed\.com$/, path: /viewjob|\/job\/|[?&]vjk=/ },
    { re: /(^|\.)glassdoor\./, path: /job-listing|\/Job\/|[?&]jl=\d/i },
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
  // Company career sites with no JSON-LD: a job-ish path plus a visible Apply control.
  const JOB_PATH = /\/(jobs?|careers?|positions?|openings?|vacanc\w*|requisitions?|roles?)(\/|-|$)/i;
  const APPLY_TEXT = /^\s*(apply|apply now|apply for this (job|role|position)|easy apply|i'?m interested)\s*$/i;
  function careerPageLooksLikeJob() {
    if (!JOB_PATH.test(location.pathname)) return false;
    const controls = document.querySelectorAll('a,button,[role="button"],input[type="submit"]');
    for (let i = 0; i < controls.length && i < 3000; i++) {
      const el = controls[i];
      if (APPLY_TEXT.test(el.innerText || el.value || '') && el.offsetParent !== null) return true;
    }
    return false;
  }
  // SPAs swap the visible job without touching the JSON-LD from the first load,
  // so it is only trusted while the URL is still the one the page loaded with.
  const loadHref = location.href;
  function currentJsonLdJob() {
    const jp = parseJsonLdJob();
    if (!jp || location.href === loadHref) return jp;
    try {
      const u = new URL(jp.applyUrl, location.href);
      return u.host === location.host && u.pathname === location.pathname ? jp : null;
    } catch (e) { return null; }
  }
  function looksLikeJob() {
    return hostLooksLikeJob() || !!currentJsonLdJob() || careerPageLooksLikeJob();
  }

  self.applykitJob = { currentJsonLdJob, readableText, looksLikeJob };
}
