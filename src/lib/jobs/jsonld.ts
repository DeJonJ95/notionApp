// Universal job capture via schema.org JobPosting JSON-LD.
//
// Most job pages (Greenhouse, Lever, Ashby, Workday, Indeed, LinkedIn public
// postings, and company career sites) embed a
// <script type="application/ld+json"> block with a JobPosting object, because
// Google for Jobs requires it. One parser therefore covers thousands of sites.
// This is the source-agnostic path that frees capture from any single board.

export type ParsedPosting = {
  title: string;
  company: string;
  description: string; // plain text, with a small meta header
  location: string | null;
  applyUrl: string;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&rsquo;|&lsquo;|&apos;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&[a-z]+;/gi, ' ');
}

// Turn a JobPosting's HTML description into readable plain text.
export function stripHtml(html: string): string {
  if (!html) return '';
  return decodeEntities(
    html
      .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/tr|\/ul|\/ol)\s*\/?>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '- ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\r/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// JSON-LD may be a single object, an array, or wrap nodes under @graph.
function collectJobPostings(node: any, out: any[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectJobPostings(n, out);
    return;
  }
  const t = node['@type'];
  const isJob = Array.isArray(t) ? t.includes('JobPosting') : t === 'JobPosting';
  if (isJob) out.push(node);
  if (node['@graph']) collectJobPostings(node['@graph'], out);
}

function asText(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v.name || v.value || '';
  return String(v);
}

function formatLocation(jp: any): { loc: string; remote: boolean } {
  const remote =
    jp.jobLocationType === 'TELECOMMUTE' ||
    /telecommute|remote/i.test(JSON.stringify(jp.applicantLocationRequirements || ''));
  const jl = Array.isArray(jp.jobLocation) ? jp.jobLocation[0] : jp.jobLocation;
  const addr = jl?.address;
  const loc = addr
    ? [addr.addressLocality, addr.addressRegion, asText(addr.addressCountry)]
        .map(asText)
        .filter(Boolean)
        .join(', ')
    : '';
  return { loc, remote };
}

function formatSalary(jp: any): string {
  const bs = jp.baseSalary;
  if (!bs) return '';
  const v = bs.value || bs;
  const currency = bs.currency || v.currency || 'USD';
  const unit = (v.unitText || '').toString().toUpperCase();
  const fmt = (n: any) => (typeof n === 'number' ? n.toLocaleString('en-US') : n);
  let amount = '';
  if (v.minValue && v.maxValue) amount = `${fmt(v.minValue)} - ${fmt(v.maxValue)}`;
  else if (v.value) amount = `${fmt(v.value)}`;
  else if (v.minValue) amount = `${fmt(v.minValue)}+`;
  if (!amount) return '';
  return `${currency} ${amount}${unit ? ` per ${unit}` : ''}`;
}

/**
 * Parse the first schema.org JobPosting out of a page's HTML. Returns null if
 * no usable JobPosting JSON-LD is present (caller should fall back).
 */
export function parseJobPostingFromHtml(html: string, pageUrl: string): ParsedPosting | null {
  const blocks =
    html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || [];
  const jobs: any[] = [];
  for (const b of blocks) {
    const json = b.replace(/^<script[^>]*>/i, '').replace(/<\/script>\s*$/i, '').trim();
    try {
      collectJobPostings(JSON.parse(json), jobs);
    } catch {
      /* some sites emit invalid JSON-LD; skip that block */
    }
  }
  if (jobs.length === 0) return null;

  const jp = jobs[0];
  const title = asText(jp.title).trim();
  const company = asText(jp.hiringOrganization).trim();
  const descText = stripHtml(asText(jp.description));
  if (!title || !company || descText.length < 20) return null;

  const { loc, remote } = formatLocation(jp);
  const salary = formatSalary(jp);
  const employment = Array.isArray(jp.employmentType)
    ? jp.employmentType.join(', ')
    : jp.employmentType;

  const meta = [
    salary && `Compensation: ${salary}`,
    loc && `Location: ${loc}`,
    remote && 'Remote: Yes',
    employment && `Employment type: ${employment}`,
    jp.datePosted && `Posted: ${String(jp.datePosted).slice(0, 10)}`,
  ].filter(Boolean);

  const description = (meta.length ? meta.join('\n') + '\n\n' : '') + descText;
  const applyUrl =
    typeof jp.url === 'string' && /^https?:/i.test(jp.url) ? jp.url : pageUrl;

  return {
    title,
    company,
    description: description.slice(0, 60000),
    location: loc || null,
    applyUrl,
  };
}
