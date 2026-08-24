// Pure parsing for POST /api/budget/capture-tx — turning either a structured
// body or a bank-alert string into one transaction. Kept out of the route so
// it can be unit-tested without pulling in prisma or next-auth.

export type CapturedTx = {
  date: string;        // ISO YYYY-MM-DD
  vendor: string;
  description: string;
  amount: number;      // signed: negative = spending, positive = money in
  category: string;    // validated against the user's options by the caller
};

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Strip markdown fences if the model wraps its JSON despite response_format. */
export function stripFences(s: string): string {
  return s.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

export const buildCaptureSystemPrompt = (categories: string[], today: string) =>
  `You turn ONE bank or credit-card notification into ONE transaction.

Return ONLY a JSON object with this exact shape — no prose, no markdown fences:
{ "t": ["YYYY-MM-DD","Vendor","short description",-14.52,"Category"] }

Fields in order:
  0: date — ISO. Today is ${today}. If the message gives a day with no year, use the year that puts it closest to today. If it gives no date at all, use ${today}.
  1: vendor — cleaned merchant name, no store numbers, city, state, or reference codes.
  2: description — the original message trimmed to 120 characters.
  3: amount — NEGATIVE for a charge, purchase, withdrawal, or payment sent. POSITIVE for a deposit, refund, credit, or payment received.
  4: category — MUST be exactly one of: ${categories.join(', ')}

If the message is not about a transaction, return { "t": null }.`;

/** Read the model's reply. Returns null for anything unusable so the caller
 *  can answer 422 rather than filing a junk row. */
export function parseCaptureResponse(raw: string, today: string): CapturedTx | null {
  let parsed: any;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return null;
  }
  const row = parsed?.t;
  if (!Array.isArray(row) || row.length < 5) return null;

  const amount = Number(row[3]);
  if (!Number.isFinite(amount) || amount === 0) return null;
  const vendor = String(row[1] ?? '').trim().slice(0, 100);
  if (!vendor) return null;

  const date = String(row[0] ?? '').slice(0, 10);
  return {
    date: isIsoDate(date) ? date : today,
    vendor,
    description: String(row[2] ?? '').slice(0, 200),
    amount,
    category: String(row[4] ?? '').trim(),
  };
}

/** Normalize a structured request body. Bank alerts quote charges as positive
 *  numbers, so spending is the default; `type: "income"` flips the sign. */
export function parseStructuredCapture(
  body: Record<string, unknown>,
  today: string,
): { tx: CapturedTx } | { error: string } {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    return { error: 'amount must be a non-zero number' };
  }
  const vendor = String(body.vendor ?? '').trim().slice(0, 100);
  if (!vendor) return { error: 'vendor required' };

  const isIncome = String(body.type ?? 'expense').toLowerCase() === 'income';
  const date = String(body.date ?? '').slice(0, 10);
  const note = String(body.note ?? '').trim().slice(0, 200);

  return {
    tx: {
      date: isIsoDate(date) ? date : today,
      vendor,
      description: note || vendor,
      amount: isIncome ? Math.abs(amount) : -Math.abs(amount),
      category: String(body.category ?? '').trim(),
    },
  };
}
