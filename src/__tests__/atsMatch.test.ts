import { findSpan, snapQuote } from '@/lib/jobs/textMatch';
import { hasKeyword, coverage, newFigures, unverifiedClaims, coreTitle, keywordsAdded } from '@/lib/jobs/keywords';
import { parsePrep, PRACTICE_SYSTEM, PREP_SYSTEM } from '@/lib/jobs/prep';
import { ANALYZE_SYSTEM } from '@/lib/jobs/deepseek';

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

  it('matches a plural keyword against singular text, but keeps short terms exact', () => {
    expect(hasKeyword('pulled data from a REST API', 'REST APIs')).toBe(true);
    expect(hasKeyword('B.S. in CS', 'CSS')).toBe(false);
    expect(hasKeyword('Deployed to AWS', 'AWS')).toBe(true);
    expect(hasKeyword('Moved freight by rail', 'Rails')).toBe(false);
    expect(hasKeyword('Owns the deploy pipeline', 'CI pipelines')).toBe(false);
    expect(hasKeyword('Owns the CI pipeline', 'CI pipelines')).toBe(true);
  });

  it('flags rank words a rewrite adds, alongside new figures', () => {
    expect(unverifiedClaims('Frontend developer who builds web apps', 'Senior Frontend Engineer who builds web apps')).toEqual(['Senior']);
    expect(unverifiedClaims('Senior engineer on payments', 'Senior engineer on payments, 3 teams')).toEqual(['3']);
    expect(unverifiedClaims('Led the migration', 'Led the PostgreSQL migration')).toEqual([]);
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

describe('prep parsing', () => {
  const q = (kind: string, text: string) => ({ q: text, kind, why: '', points: [], evidence: '' });

  it('keeps each half to its own question kinds', () => {
    const a = JSON.stringify({ pitch: 'Hi', questions: [q('behavioral', 'Conflict?'), q('technical', 'Stray tech?')] });
    const b = JSON.stringify({ questions: [q('technical', 'Testing?'), q('motivation', 'Stray why?')], gaps: [], ask: ['Team size?'] });
    expect(parsePrep([a, b]).questions.map((x) => x.q)).toEqual(['Conflict?', 'Testing?']);
  });

  it('keeps the half that parsed when the other is cut off', () => {
    const a = JSON.stringify({ pitch: 'Hi', questions: [q('behavioral', 'Conflict?')] });
    const pack = parsePrep([a, '{"questions": [{"q": "Testing?", "kind": "techn']);
    expect(pack.pitch).toBe('Hi');
    expect(pack.questions.map((x) => x.q)).toEqual(['Conflict?']);
  });

  it('names JSON in every json-mode prompt, which DeepSeek requires', () => {
    [PRACTICE_SYSTEM, PREP_SYSTEM, ANALYZE_SYSTEM].forEach((p) => expect(p.toLowerCase()).toContain('json'));
  });
});
