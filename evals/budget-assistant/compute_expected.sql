-- Independent expected answers for the budget assistant evals.
--
-- Reads the raw tables directly. It deliberately calls none of the functions in
-- prisma/sql/budget-metrics.sql (no budget_* helpers, no metric functions):
-- this file exists to catch bugs in them, so every rule is written again here.
--
-- Settings, applied by fill_golden.ts in the same transaction:
--   budget_eval.user_email  whose ledger to read
--   budget_eval.start_date  first day of the period, YYYY-MM-DD
--   budget_eval.end_date    last day of the period
--   budget_eval.today       today in Detroit; bills due after it are not judged
--
-- Returns one row with one jsonb column, "expected".

WITH params AS (
  SELECT u.id AS user_id,
         current_setting('budget_eval.start_date')::date AS p_start,
         current_setting('budget_eval.end_date')::date AS p_end,
         current_setting('budget_eval.today')::date AS today
  FROM "User" u
  WHERE lower(u.email) = lower(current_setting('budget_eval.user_email'))
),
-- The ledger the app uses: the user's oldest database shaped like the Personal Budget template.
ledger_db AS (
  SELECT d.id
  FROM "Database" d
  JOIN "Workspace" w ON w.id = d."workspaceId"
  JOIN params ON w."ownerId" = params.user_id
  WHERE EXISTS (SELECT 1 FROM "Property" p WHERE p."databaseId" = d.id AND p.name = 'Amount' AND p.type = 'number')
    AND EXISTS (SELECT 1 FROM "Property" p WHERE p."databaseId" = d.id AND p.name = 'Date' AND p.type = 'date')
    AND EXISTS (SELECT 1 FROM "Property" p WHERE p."databaseId" = d.id AND p.name = 'Category')
    AND EXISTS (SELECT 1 FROM "Property" p WHERE p."databaseId" = d.id AND p.name = 'Vendor')
  ORDER BY d."createdAt"
  LIMIT 1
),
raw AS (
  SELECT pg.id, pg.title, pg."createdAt" AS created, pr.name, pv.value #>> '{}' AS v
  FROM "Page" pg
  JOIN ledger_db ON pg."databaseId" = ledger_db.id
  JOIN "PropertyValue" pv ON pv."pageId" = pg.id
  JOIN "Property" pr ON pr.id = pv."propertyId"
  WHERE NOT pg."isArchived"
),
pages AS (
  SELECT id, max(title) AS title, max(created) AS created,
         max(v) FILTER (WHERE name = 'Type') AS typ,
         max(v) FILTER (WHERE name = 'Category') AS cat,
         max(v) FILTER (WHERE name = 'Amount') AS amt,
         max(v) FILTER (WHERE name = 'Date') AS dt,
         max(v) FILTER (WHERE name = 'Vendor') AS vendor,
         max(v) FILTER (WHERE name = 'Notes') AS notes,
         max(v) FILTER (WHERE name = 'Account') AS account,
         max(v) FILTER (WHERE name = 'Status') AS status
  FROM raw
  GROUP BY id
),
tx AS (
  SELECT id, created,
         left(dt, 10)::date AS d,
         coalesce(typ, '') AS typ,
         coalesce(cat, 'Other') AS cat,
         abs(amt::numeric) AS amt,
         coalesce(vendor, title, '') AS vendor,
         notes,
         account,
         -- Unconfirmed forecasts: Planned, or the old engine's rows never set to Cleared.
         coalesce(status, '') <> 'Cleared'
           AND (status = 'Planned' OR notes LIKE 'Recurring expense: %' OR notes LIKE 'Recurring income: %') AS forecast
  FROM pages
  WHERE coalesce(typ, '') <> 'Budget'
    AND amt ~ '^-?[0-9]+(\.[0-9]+)?$' AND amt::numeric <> 0
    AND dt ~ '^\d{4}-\d{2}-\d{2}'
),
-- Spend: expenses positive, refunds (income under a spending category) negative;
-- transfers, forecasts, pay and unattributed income left out.
spend AS (
  SELECT id, d, cat, CASE WHEN typ = 'Expense' THEN amt ELSE -amt END AS amount, vendor, notes
  FROM tx
  WHERE NOT forecast
    AND cat <> 'Transfers'
    AND (typ = 'Expense' OR (typ = 'Income' AND cat NOT IN ('Other', 'Transfers')))
),
-- Question 1: month over month. The thresholds are the documented defaults.
months AS (
  SELECT m::date AS m FROM params, generate_series(p_start::timestamp, p_end::timestamp, interval '1 month') m
),
monthly AS (
  SELECT date_trunc('month', s.d::timestamp)::date AS m, s.cat, sum(s.amount) AS amt
  FROM spend s, params
  WHERE s.d BETWEEN (p_start - interval '1 month')::date AND p_end
  GROUP BY 1, 2
),
mom AS (
  SELECT to_char(months.m, 'YYYY-MM') AS month, c.cat,
         coalesce(cur.amt, 0) AS cur, coalesce(prev.amt, 0) AS prev
  FROM months
  CROSS JOIN (SELECT DISTINCT cat FROM monthly) c
  LEFT JOIN monthly cur ON cur.m = months.m AND cur.cat = c.cat
  LEFT JOIN monthly prev ON prev.m = (months.m - interval '1 month')::date AND prev.cat = c.cat
),
mom_json AS (
  SELECT jsonb_build_object(
    'totals', (SELECT jsonb_object_agg(month, round(t, 2)) FROM (SELECT month, sum(cur) AS t FROM mom GROUP BY month) x),
    'notable', coalesce((
      SELECT jsonb_agg(jsonb_build_object('month', month, 'category', cat, 'change_usd', round(cur - prev, 2)) ORDER BY month, cat)
      FROM mom
      WHERE abs(cur - prev) >= 25 AND (prev = 0 OR abs(cur - prev) / abs(prev) * 100 >= 15)
    ), '[]'::jsonb)
  ) AS j
),
-- Question 3: fast food, matched on statement text or vendor without case or punctuation.
ff AS (
  SELECT to_char(s.d, 'YYYY-MM') AS month, s.amount
  FROM spend s, params
  WHERE s.d BETWEEN p_start AND p_end
    AND EXISTS (
      SELECT 1 FROM "MerchantPattern" mp
      WHERE mp."userId" = params.user_id AND mp."groupName" = 'fast_food'
        AND length(regexp_replace(lower(mp.pattern), '[^a-z0-9]', '', 'g')) >= 3
        AND (regexp_replace(lower(coalesce(s.notes, '')), '[^a-z0-9]', '', 'g') LIKE '%' || regexp_replace(lower(mp.pattern), '[^a-z0-9]', '', 'g') || '%'
          OR regexp_replace(lower(s.vendor), '[^a-z0-9]', '', 'g') LIKE '%' || regexp_replace(lower(mp.pattern), '[^a-z0-9]', '', 'g') || '%')
    )
),
ff_json AS (
  SELECT jsonb_build_object(
    'total', (SELECT round(coalesce(sum(amount), 0), 2) FROM ff),
    'transactions', (SELECT count(*) FROM ff),
    'months', coalesce((SELECT jsonb_object_agg(month, t) FROM (SELECT month, round(sum(amount), 2) AS t FROM ff GROUP BY month) x), '{}'::jsonb)
  ) AS j
),
-- Question 2: bills. Active expense rules; due dates by frequency; a payment
-- (any non-income row that is not a forecast, at least half the bill, similar
-- vendor) counts from half a period before the due date until half of that
-- before the next due date; one payment per due date, oldest due date first.
rules AS (
  SELECT rr.id, rr.name, rr.amount, rr.frequency, rr."anchorDate"::date AS anchor,
         CASE rr.frequency WHEN 'weekly' THEN 3 WHEN 'biweekly' THEN 7 WHEN 'semimonthly' THEN 7 ELSE 14 END AS early,
         CASE WHEN rr."lastGeneratedDate" IS NULL THEN rr."anchorDate"::date ELSE rr."createdAt"::date END AS first_due
  FROM "RecurringRule" rr JOIN params ON rr."userId" = params.user_id
  WHERE rr."isActive" AND rr.type = 'expense'
),
due_dates AS (
  SELECT r.id AS rule_id, x.due
  FROM rules r, params,
  LATERAL (
    SELECT (gs::date + (extract(day FROM r.anchor)::int - 1)) AS due
    FROM generate_series(date_trunc('month', (p_start - 60)::timestamp), date_trunc('month', (p_end + 62)::timestamp), interval '1 month') gs
    WHERE r.frequency = 'monthly'
    UNION ALL
    SELECT r.anchor + k * CASE r.frequency WHEN 'weekly' THEN 7 ELSE 14 END
    FROM generate_series(-400, 400) k
    WHERE r.frequency IN ('weekly', 'biweekly')
    UNION ALL
    SELECT make_date(extract(year FROM gs)::int, extract(month FROM gs)::int,
                     least(extract(day FROM r.anchor)::int + o, extract(day FROM (gs + interval '1 month' - interval '1 day'))::int))
    FROM generate_series(date_trunc('month', (p_start - 60)::timestamp), date_trunc('month', (p_end + 62)::timestamp), interval '1 month') gs,
         (VALUES (0), (14)) v(o)
    WHERE r.frequency = 'semimonthly'
  ) x
  WHERE x.due BETWEEN p_start - 60 AND p_end + 62
),
dues AS (
  SELECT rule_id, due,
         coalesce(lead(due) OVER w, due + 62) AS nxt,
         row_number() OVER w AS i
  FROM due_dates
  WINDOW w AS (PARTITION BY rule_id ORDER BY due)
),
names AS (
  SELECT key, array_to_string(ARRAY(
           SELECT w FROM regexp_split_to_table(trim(regexp_replace(lower(coalesce(src, '')), '[^a-z0-9\s]+', ' ', 'g')), '\s+') WITH ORDINALITY t(w, o)
           WHERE w <> '' AND w !~ '^\d{3,}$' AND w NOT IN ('inc', 'llc', 'llp', 'ltd', 'co', 'corp', 'the')
           ORDER BY o), ' ') AS n
  FROM (SELECT 'rule:' || id AS key, name AS src FROM rules
        UNION ALL SELECT 'tx:' || id, vendor FROM tx) s
),
pairs AS (
  SELECT r.id AS rule_id, t.id AS pay_id, t.d AS pay_date, t.amt, t.vendor, t.account, t.created,
         rn.n AS a, tn.n AS b,
         ARRAY(SELECT x FROM unnest(string_to_array(rn.n, ' ')) x WHERE x <> '' AND x NOT IN ('of', 'and', 'for', 'to', 'at', 'in', 'on', 'a')) AS ta,
         ARRAY(SELECT x FROM unnest(string_to_array(tn.n, ' ')) x WHERE x <> '' AND x NOT IN ('of', 'and', 'for', 'to', 'at', 'in', 'on', 'a')) AS tb
  FROM rules r
  JOIN tx t ON NOT t.forecast AND t.typ <> 'Income' AND t.amt >= r.amount * 0.5
  JOIN names rn ON rn.key = 'rule:' || r.id
  JOIN names tn ON tn.key = 'tx:' || t.id
),
cand AS (
  SELECT p.*, row_number() OVER (PARTITION BY rule_id ORDER BY pay_date, created DESC) AS ord
  FROM pairs p
  WHERE (a <> '' AND b <> '' AND (a = b OR (least(length(a), length(b)) >= 4
          AND (CASE WHEN length(a) <= length(b) THEN strpos(b, a) ELSE strpos(a, b) END) > 0)))
     OR (cardinality(ta) >= 2 AND cardinality(tb) >= 2
         AND (SELECT count(DISTINCT x) FROM unnest(ta) x WHERE x = ANY (tb)) >= 2
         AND (SELECT count(DISTINCT x) FROM unnest(ta) x WHERE x = ANY (tb))::numeric / least(cardinality(ta), cardinality(tb)) >= 0.5)
),
walk AS (
  WITH RECURSIVE w(rule_id, i, due, pay_id, used) AS (
    SELECT d.rule_id, d.i, d.due, pick.pay_id, CASE WHEN pick.pay_id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[pick.pay_id] END
    FROM dues d JOIN rules r ON r.id = d.rule_id
    LEFT JOIN LATERAL (
      SELECT c.pay_id FROM cand c
      WHERE c.rule_id = d.rule_id AND c.pay_date >= d.due - r.early AND c.pay_date < d.nxt - ceil(r.early / 2.0)::int
      ORDER BY c.ord LIMIT 1
    ) pick ON true
    WHERE d.i = 1
    UNION ALL
    SELECT d.rule_id, d.i, d.due, pick.pay_id, CASE WHEN pick.pay_id IS NULL THEN w.used ELSE w.used || pick.pay_id END
    FROM w
    JOIN dues d ON d.rule_id = w.rule_id AND d.i = w.i + 1
    JOIN rules r ON r.id = d.rule_id
    LEFT JOIN LATERAL (
      SELECT c.pay_id FROM cand c
      WHERE c.rule_id = d.rule_id AND NOT (c.pay_id = ANY (w.used))
        AND c.pay_date >= d.due - r.early AND c.pay_date < d.nxt - ceil(r.early / 2.0)::int
      ORDER BY c.ord LIMIT 1
    ) pick ON true
  )
  SELECT * FROM w
),
bill_account AS (
  SELECT DISTINCT ON (rule_id) rule_id, account
  FROM cand WHERE coalesce(account, '') <> ''
  ORDER BY rule_id, ord DESC
),
bills AS (
  SELECT r.name AS bill, w.due, c.pay_date,
         CASE
           WHEN c.pay_id IS NOT NULL AND c.pay_date > w.due THEN 'late'
           WHEN c.pay_id IS NOT NULL THEN 'on_time'
           WHEN EXISTS (
             SELECT 1 FROM "ImportLog" il
             WHERE il."userId" = params.user_id
               AND w.due BETWEEN il."dateFrom"::date AND il."dateTo"::date
               AND (ba.account IS NULL OR il.account IS NULL OR il.account = ba.account)
           ) THEN 'missed'
           ELSE 'not_confirmed'
         END AS status,
         CASE WHEN c.pay_id IS NOT NULL THEN greatest(c.pay_date - w.due, 0) END AS days_late
  FROM walk w
  JOIN rules r ON r.id = w.rule_id
  CROSS JOIN params
  LEFT JOIN cand c ON c.rule_id = w.rule_id AND c.pay_id = w.pay_id
  LEFT JOIN bill_account ba ON ba.rule_id = w.rule_id
  WHERE w.due BETWEEN greatest(params.p_start, r.first_due) AND least(params.p_end, params.today)
),
bills_json AS (
  SELECT jsonb_build_object('bills', coalesce(jsonb_agg(jsonb_build_object(
           'bill', bill, 'due_date', to_char(due, 'YYYY-MM-DD'), 'status', status, 'days_late', days_late,
           'paid_date', to_char(pay_date, 'YYYY-MM-DD')) ORDER BY bill, due), '[]'::jsonb)) AS j
  FROM bills
)
SELECT jsonb_build_object(
  'month_over_month', (SELECT j FROM mom_json),
  'bill_payment_status', (SELECT j FROM bills_json),
  'fast_food', (SELECT j FROM ff_json)
) AS expected
