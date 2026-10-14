import { findSpan, snapQuote } from '@/lib/jobs/textMatch';
import { hasKeyword, coverage, newFigures, coreTitle, keywordsAdded } from '@/lib/jobs/keywords';

describe('findSpan', () => {
  it('matches through smart quotes, dash spacing, case and a bullet glyph', () => {
    const hay = 'Shipped the “Insights” app – used by 3 teams.';
    const span = findSpan(hay, '• shipped the "insights" app-used by 3 teams');
    expect(span).not.toBeNull();
    expect(hay.slice(...span!)).toBe('Shipped the “Insights” app – used by 3 teams');
  });

  it('finds a quote inside a longer line', () => {
    const hay = 'Acme Corp: Built dashboards in React.';
    expect(hay.slice(...findSpan(hay, 'Built dashboards in React')!)).toBe('Built dashboards in React');
  });

  it('returns null when the text is absent', () => {
    expect(findSpan('Built dashboards', 'Managed a budget of $2M')).toBeNull();
  });
});

describe('snapQuote', () => {
  const resume = 'Jane Doe\n\nBuilt React dashboards used by 40 analysts.\n\nLed the migration to Postgres for billing.';

  it('returns the verbatim resume text for a lightly paraphrased quote', () => {
    expect(snapQuote(resume, 'Led the migration to PostgreSQL for billing')).toBe('Led the migration to Postgres for billing.');
  });

  it('drops a quote the resume never contained', () => {
    expect(snapQuote(resume, 'Managed a team of 12 engineers across three time zones')).toBeNull();
  });
});

describe('keywords', () => {
  it('forgives separators and plurals but not substrings', () => {
    expect(hasKeyword('Built services in NodeJS', 'Node.js')).toBe(true);
    expect(hasKeyword('Owned the CI CD pipeline', 'CI/CD')).toBe(true);
    expect(hasKeyword('Wrote REST APIs', 'REST API')).toBe(true);
    expect(hasKeyword('Reactive streams', 'React')).toBe(false);
    expect(hasKeyword('C++ and Rust', 'C')).toBe(false);
    expect(hasKeyword('C++ and Rust', 'C++')).toBe(true);
  });

  it('splits keywords into matched and missing, deduped', () => {
    expect(coverage('React and SQL', ['React', 'react', 'Kubernetes', 'SQL'])).toEqual({
      matched: ['React', 'SQL'],
      missing: ['Kubernetes'],
    });
  });

  it('flags figures a rewrite adds that the original never had', () => {
    expect(newFigures('Built dashboards for 40 analysts', 'Built dashboards for 40 analysts, cutting reporting time 30%')).toEqual(['30%']);
    expect(newFigures('Saved $2M in 2021', 'Saved $2M across 2021 renewals')).toEqual([]);
  });

  it('reports keywords a rewrite brings in', () => {
    expect(keywordsAdded(['PostgreSQL', 'React'], 'React apps on Postgres', 'Migrated billing to PostgreSQL')).toEqual(['PostgreSQL']);
  });

  it('reduces a posting title to the role', () => {
    expect(coreTitle('Senior Data Engineer (Remote)')).toBe('Data Engineer');
    expect(coreTitle('Sr. Frontend Engineer - Payments')).toBe('Frontend Engineer');
    expect(coreTitle('Software Engineer II')).toBe('Software Engineer');
  });
});
