import { parseJobPostingFromHtml, stripHtml } from '@/lib/jobs/jsonld';

const page = (jsonld: string) =>
  `<html><head><script type="application/ld+json">${jsonld}</script></head><body>x</body></html>`;

const jobPosting = {
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Senior Frontend Engineer',
  hiringOrganization: { '@type': 'Organization', name: 'Acme Corp' },
  description: '<p>Build great UIs.</p><ul><li>React</li><li>TypeScript</li></ul>',
  jobLocation: { '@type': 'Place', address: { addressLocality: 'Austin', addressRegion: 'TX', addressCountry: 'US' } },
  baseSalary: { '@type': 'MonetaryAmount', currency: 'USD', value: { '@type': 'QuantitativeValue', minValue: 150000, maxValue: 190000, unitText: 'YEAR' } },
  employmentType: 'FULL_TIME',
  datePosted: '2026-05-30',
  url: 'https://boards.greenhouse.io/acme/jobs/123',
};

describe('parseJobPostingFromHtml', () => {
  it('parses a standard JobPosting with salary, location, and HTML description', () => {
    const r = parseJobPostingFromHtml(page(JSON.stringify(jobPosting)), 'https://x.com/job');
    expect(r).not.toBeNull();
    expect(r!.title).toBe('Senior Frontend Engineer');
    expect(r!.company).toBe('Acme Corp');
    expect(r!.applyUrl).toBe('https://boards.greenhouse.io/acme/jobs/123');
    expect(r!.location).toBe('Austin, TX, US');
    expect(r!.description).toContain('Compensation: USD 150,000 - 190,000 per YEAR');
    expect(r!.description).toContain('- React');
    expect(r!.description).not.toContain('<p>'); // HTML stripped
  });

  it('finds a JobPosting nested under @graph', () => {
    const graph = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite' }, jobPosting] };
    const r = parseJobPostingFromHtml(page(JSON.stringify(graph)), 'https://x.com/job');
    expect(r?.company).toBe('Acme Corp');
  });

  it('handles @type as an array', () => {
    const r = parseJobPostingFromHtml(page(JSON.stringify({ ...jobPosting, '@type': ['JobPosting', 'Thing'] })), 'https://x.com/job');
    expect(r?.title).toBe('Senior Frontend Engineer');
  });

  it('skips invalid JSON-LD blocks but still finds a valid one', () => {
    const html =
      `<script type="application/ld+json">{ broken json,,, }</script>` +
      page(JSON.stringify(jobPosting));
    expect(parseJobPostingFromHtml(html, 'https://x.com/job')?.company).toBe('Acme Corp');
  });

  it('returns null when there is no JobPosting', () => {
    const r = parseJobPostingFromHtml(page(JSON.stringify({ '@type': 'Article', headline: 'hi' })), 'https://x.com/a');
    expect(r).toBeNull();
  });

  it('falls back to the page URL when the posting has no url', () => {
    const { url, ...noUrl } = jobPosting;
    const r = parseJobPostingFromHtml(page(JSON.stringify(noUrl)), 'https://x.com/page');
    expect(r?.applyUrl).toBe('https://x.com/page');
  });
});

describe('stripHtml', () => {
  it('converts list items and decodes entities', () => {
    expect(stripHtml('<ul><li>A &amp; B</li><li>C</li></ul>')).toContain('- A & B');
  });
});
