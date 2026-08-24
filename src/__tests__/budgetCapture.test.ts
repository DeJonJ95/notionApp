import {
  isoDay,
  isIsoDate,
  stripFences,
  buildCaptureSystemPrompt,
  parseCaptureResponse,
  parseStructuredCapture,
} from '../lib/budgetCapture';

const TODAY = '2026-08-24';

describe('isoDay / isIsoDate', () => {
  it('formats a local date without shifting timezone', () => {
    expect(isoDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('accepts only YYYY-MM-DD', () => {
    expect(isIsoDate('2026-08-24')).toBe(true);
    expect(isIsoDate('8/24/2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});

describe('stripFences', () => {
  it('removes a json fence', () => {
    expect(stripFences('```json\n{"t":null}\n```')).toBe('{"t":null}');
  });

  it('leaves bare JSON alone', () => {
    expect(stripFences('{"t":null}')).toBe('{"t":null}');
  });
});

describe('buildCaptureSystemPrompt', () => {
  it('interpolates the user’s own categories and today', () => {
    const prompt = buildCaptureSystemPrompt(['Rent', 'Pet Care'], TODAY);
    expect(prompt).toContain('Rent, Pet Care');
    expect(prompt).toContain(TODAY);
  });
});

describe('parseCaptureResponse', () => {
  it('reads a well-formed reply', () => {
    const out = parseCaptureResponse(
      '{"t":["2026-08-23","Starbucks","card charged $14.52",-14.52,"Food & Dining"]}',
      TODAY,
    );
    expect(out).toEqual({
      date: '2026-08-23',
      vendor: 'Starbucks',
      description: 'card charged $14.52',
      amount: -14.52,
      category: 'Food & Dining',
    });
  });

  it('reads a fenced reply', () => {
    const out = parseCaptureResponse(
      '```json\n{"t":["2026-08-23","Shell","gas",-40,"Transport"]}\n```',
      TODAY,
    );
    expect(out?.vendor).toBe('Shell');
  });

  it('keeps a positive amount as money in', () => {
    const out = parseCaptureResponse('{"t":["2026-08-23","Employer","deposit",1200,"Other"]}', TODAY);
    expect(out?.amount).toBe(1200);
  });

  it('falls back to today when the date is unusable', () => {
    const out = parseCaptureResponse('{"t":["8/23","Shell","gas",-40,"Transport"]}', TODAY);
    expect(out?.date).toBe(TODAY);
  });

  it('returns null when the message is not a transaction', () => {
    expect(parseCaptureResponse('{"t":null}', TODAY)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseCaptureResponse('sorry, I cannot help', TODAY)).toBeNull();
  });

  it('returns null for a short or non-array row', () => {
    expect(parseCaptureResponse('{"t":["2026-08-23","Shell"]}', TODAY)).toBeNull();
    expect(parseCaptureResponse('{"t":{"vendor":"Shell"}}', TODAY)).toBeNull();
  });

  it('returns null for a zero or unreadable amount', () => {
    expect(parseCaptureResponse('{"t":["2026-08-23","Shell","gas",0,"Transport"]}', TODAY)).toBeNull();
    expect(parseCaptureResponse('{"t":["2026-08-23","Shell","gas","lots","Transport"]}', TODAY)).toBeNull();
  });

  it('returns null when no vendor came back', () => {
    expect(parseCaptureResponse('{"t":["2026-08-23","   ","gas",-40,"Transport"]}', TODAY)).toBeNull();
  });
});

describe('parseStructuredCapture', () => {
  it('treats a bare positive amount as spending', () => {
    const out = parseStructuredCapture({ amount: 14.52, vendor: 'Starbucks' }, TODAY);
    expect(out).toEqual({
      tx: {
        date: TODAY,
        vendor: 'Starbucks',
        description: 'Starbucks',
        amount: -14.52,
        category: '',
      },
    });
  });

  it('treats a negative amount as spending too', () => {
    const out = parseStructuredCapture({ amount: -14.52, vendor: 'Starbucks' }, TODAY);
    expect('tx' in out && out.tx.amount).toBe(-14.52);
  });

  it('flips the sign for type income', () => {
    const out = parseStructuredCapture({ amount: 1200, vendor: 'Employer', type: 'income' }, TODAY);
    expect('tx' in out && out.tx.amount).toBe(1200);
  });

  it('flips the sign for a negative amount marked income', () => {
    const out = parseStructuredCapture({ amount: -50, vendor: 'Refund', type: 'Income' }, TODAY);
    expect('tx' in out && out.tx.amount).toBe(50);
  });

  it('accepts a numeric string amount', () => {
    const out = parseStructuredCapture({ amount: '14.52', vendor: 'Starbucks' }, TODAY);
    expect('tx' in out && out.tx.amount).toBe(-14.52);
  });

  it('honours an explicit date and note', () => {
    const out = parseStructuredCapture(
      { amount: 20, vendor: 'Shell', date: '2026-08-20', note: 'fill up' },
      TODAY,
    );
    expect('tx' in out && out.tx.date).toBe('2026-08-20');
    expect('tx' in out && out.tx.description).toBe('fill up');
  });

  it('falls back to today for an unusable date', () => {
    const out = parseStructuredCapture({ amount: 20, vendor: 'Shell', date: '8/20/26' }, TODAY);
    expect('tx' in out && out.tx.date).toBe(TODAY);
  });

  it('rejects a missing, zero, or unreadable amount', () => {
    expect(parseStructuredCapture({ vendor: 'Shell' }, TODAY)).toEqual({
      error: 'amount must be a non-zero number',
    });
    expect(parseStructuredCapture({ amount: 0, vendor: 'Shell' }, TODAY)).toHaveProperty('error');
    expect(parseStructuredCapture({ amount: 'lots', vendor: 'Shell' }, TODAY)).toHaveProperty('error');
  });

  it('rejects a missing vendor', () => {
    expect(parseStructuredCapture({ amount: 20 }, TODAY)).toEqual({ error: 'vendor required' });
    expect(parseStructuredCapture({ amount: 20, vendor: '   ' }, TODAY)).toEqual({ error: 'vendor required' });
  });
});
