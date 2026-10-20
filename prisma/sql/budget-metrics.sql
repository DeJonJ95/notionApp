-- Budget metric functions for the budget assistant.
--
-- The database computes every figure the assistant reports. The model only
-- chooses which of these functions to call and explains what they return.
--
-- Applied on every build by `prisma db execute` after `prisma db push`, so each
-- function is dropped and recreated: a changed return type then re-applies.
--
-- Access: this app has no row level security. Every function takes the
-- signed-in user's id and their budget database id, which the API route fills
-- from the session (never from the model), and reads only rows in a workspace
-- that user owns.
--
-- Dates: transaction dates are calendar dates copied from bank statements, so a
-- transaction's month is its date's month. "Today" is the date in Detroit.

-- Configurable constants -----------------------------------------------------

CREATE OR REPLACE FUNCTION budget_mom_min_usd() RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 25::numeric $$;
CREATE OR REPLACE FUNCTION budget_mom_min_pct() RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 15::numeric $$;
CREATE OR REPLACE FUNCTION budget_grace_days() RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT 0 $$;
-- A payment covers a bill only at this share of the bill or more, so a late fee can't.
CREATE OR REPLACE FUNCTION budget_min_payment_share() RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 0.5::numeric $$;
CREATE OR REPLACE FUNCTION budget_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Detroit')::date $$;

-- Month arithmetic on plain dates, so no session time zone can shift a month edge.
CREATE OR REPLACE FUNCTION budget_month_start(d date) RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT d - (extract(day FROM d)::int - 1)
$$;
CREATE OR REPLACE FUNCTION budget_month_end(d date) RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT (budget_month_start(d) + interval '1 month')::date - 1
$$;

-- Value parsing ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION budget_num(v text) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v ~ '^\s*-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?\s*$' THEN v::numeric END
$$;

CREATE OR REPLACE FUNCTION budget_date(v text) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF v !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
  RETURN left(v, 10)::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

-- Ledger ------------------------------------------------------------------------

DROP FUNCTION IF EXISTS budget_pages(text, text);
CREATE FUNCTION budget_pages(p_user_id text, p_database_id text)
RETURNS TABLE (page_id text, title text, created_at timestamp, props jsonb)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.title, p."createdAt",
         coalesce(jsonb_object_agg(pr.name, pv.value) FILTER (WHERE pr.name IS NOT NULL), '{}'::jsonb)
  FROM "Page" p
  JOIN "Database" d ON d.id = p."databaseId"
  JOIN "Workspace" w ON w.id = d."workspaceId"
  LEFT JOIN "PropertyValue" pv ON pv."pageId" = p.id
  LEFT JOIN "Property" pr ON pr.id = pv."propertyId"
  WHERE d.id = p_database_id
    AND w."ownerId" = p_user_id
    AND NOT p."isArchived"
  GROUP BY p.id, p.title, p."createdAt"
$$;

-- One row per transaction. Amounts are stored positive; Type carries direction,
-- so Income is positive here and everything else negative.
DROP FUNCTION IF EXISTS budget_ledger(text, text);
CREATE FUNCTION budget_ledger(p_user_id text, p_database_id text)
RETURNS TABLE (page_id text, created_at timestamp, tx_date date, tx_type text, category text, amount numeric,
               vendor text, payee text, account text, is_forecast boolean)
LANGUAGE sql STABLE AS $$
  SELECT page_id,
         created_at,
         budget_date(props->>'Date'),
         coalesce(props->>'Type', ''),
         coalesce(props->>'Category', 'Other'),
         CASE WHEN props->>'Type' = 'Income' THEN abs(budget_num(props->>'Amount'))
              ELSE -abs(budget_num(props->>'Amount')) END,
         coalesce(props->>'Vendor', title, ''),
         props->>'Notes',
         props->>'Account',
         -- A forecast says a bill is due, never that money moved: a row marked
         -- Planned, or one the retired recurring engine wrote that the user
         -- never set to Cleared.
         coalesce(props->>'Status', '') <> 'Cleared'
           AND (props->>'Status' = 'Planned' OR coalesce(props->>'Notes', '') ~ '^Recurring (income|expense): ')
  FROM budget_pages(p_user_id, p_database_id)
  WHERE coalesce(props->>'Type', '') <> 'Budget'
    AND coalesce(budget_num(props->>'Amount'), 0) <> 0
    AND budget_date(props->>'Date') IS NOT NULL
$$;

-- Spend: posted outflows, positive; refunds negative.
DROP FUNCTION IF EXISTS budget_spend_rows(text, text, date, date);
CREATE FUNCTION budget_spend_rows(p_user_id text, p_database_id text, p_start date, p_end date)
RETURNS TABLE (page_id text, tx_date date, category text, spend numeric, is_refund boolean,
               vendor text, payee text, account text)
LANGUAGE sql STABLE AS $$
  SELECT page_id, tx_date, category, -amount, tx_type = 'Income', vendor, payee, account
  FROM budget_ledger(p_user_id, p_database_id)
  WHERE tx_date BETWEEN p_start AND p_end
    -- Statements list posted transactions only, so there is no pending state to
    -- drop; forecasts are excluded because no money moved.
    AND NOT is_forecast
    -- The importer files moves between the user's own accounts and credit card
    -- payments under Transfers. Person-to-person payments it filed there are
    -- excluded too until the user recategorises them.
    AND category <> 'Transfers'
    AND (
      tx_type = 'Expense'
      -- A refund is an Income row filed under a spending category; it nets
      -- against that category. Income under Other (pay, and refunds the
      -- importer could not attribute) is not spend.
      OR (tx_type = 'Income' AND category NOT IN ('Other', 'Transfers'))
    )
    -- Savings rows move money to the user's own savings, so they are not spend.
$$;

-- Monthly targets from Type=Budget rows: "Budgeted Amount" (else "Amount") for
-- the row's "Budget Period", normalised to a month. A blank period is monthly.
DROP FUNCTION IF EXISTS budget_targets(text, text);
CREATE FUNCTION budget_targets(p_user_id text, p_database_id text)
RETURNS TABLE (category text, planned numeric)
LANGUAGE sql STABLE AS $$
  WITH rows AS (
    SELECT trim(props->>'Category') AS category,
           coalesce(nullif(abs(budget_num(props->>'Budgeted Amount')), 0), abs(budget_num(props->>'Amount'))) AS raw,
           trim(coalesce(props->>'Budget Period', '')) AS period
    FROM budget_pages(p_user_id, p_database_id)
    WHERE props->>'Type' = 'Budget'
  )
  SELECT category,
         sum(raw * CASE period WHEN 'Weekly' THEN 52 WHEN 'Bi-Weekly' THEN 26 WHEN 'Biweekly' THEN 26
                               WHEN 'Semi-Monthly' THEN 24 WHEN 'Quarterly' THEN 4 WHEN 'Annual' THEN 1
                               WHEN 'Yearly' THEN 1 ELSE 12 END / 12)
  FROM rows
  WHERE coalesce(category, '') <> '' AND raw > 0
  GROUP BY category
$$;

-- Metric: spend by category ---------------------------------------------------

DROP FUNCTION IF EXISTS spend_by_category(text, text, date, date);
CREATE FUNCTION spend_by_category(p_user_id text, p_database_id text, p_start_date date, p_end_date date)
RETURNS TABLE (category text, spend double precision, purchases double precision, refunds double precision,
               transactions int, is_total boolean)
LANGUAGE sql STABLE AS $$
  SELECT coalesce(category, 'All categories'),
         round(sum(spend), 2)::float8,
         round(coalesce(sum(spend) FILTER (WHERE NOT is_refund), 0), 2)::float8,
         round(coalesce(-sum(spend) FILTER (WHERE is_refund), 0), 2)::float8,
         count(*)::int,
         grouping(category) = 1
  FROM budget_spend_rows(p_user_id, p_database_id, p_start_date, p_end_date)
  GROUP BY GROUPING SETS ((category), ())
  ORDER BY grouping(category), sum(spend) DESC
$$;

-- Metric: month over month --------------------------------------------------------

-- The p_months most recent closed months (the current month only when
-- p_include_current), each category's spend against the month before. A change
-- is notable at budget_mom_min_usd() or more AND budget_mom_min_pct() or more.
DROP FUNCTION IF EXISTS month_over_month(text, text, int, boolean);
CREATE FUNCTION month_over_month(p_user_id text, p_database_id text, p_months int, p_include_current boolean DEFAULT false)
RETURNS TABLE (month date, category text, spend double precision, prev_month_spend double precision,
               change_usd double precision, change_pct double precision, notable boolean, is_total boolean,
               is_partial boolean)
LANGUAGE sql STABLE AS $$
  WITH this_month AS (SELECT budget_month_start(budget_today()) AS m),
  months AS (
    SELECT (t.m - make_interval(months => k))::date AS month
    FROM this_month t,
         generate_series(CASE WHEN p_include_current THEN 0 ELSE 1 END, greatest(least(p_months, 24), 1)) k
  ),
  spend AS (
    SELECT budget_month_start(s.tx_date) AS month, s.category, sum(s.spend) AS amt
    FROM budget_spend_rows(p_user_id, p_database_id,
                           ((SELECT min(month) FROM months) - interval '1 month')::date,
                           budget_month_end((SELECT max(month) FROM months))) s
    GROUP BY 1, 2
  ),
  totals AS (SELECT month, NULL::text AS category, sum(amt) AS amt FROM spend GROUP BY month),
  cells AS (
    SELECT m.month, c.category, false AS is_total
    FROM months m CROSS JOIN (SELECT DISTINCT category FROM spend) c
    UNION ALL
    SELECT m.month, NULL, true FROM months m
  ),
  joined AS (
    SELECT c.month, c.category, c.is_total,
           coalesce(cur.amt, 0) AS cur, coalesce(prev.amt, 0) AS prev
    FROM cells c
    LEFT JOIN (SELECT * FROM spend UNION ALL SELECT * FROM totals) cur
      ON cur.month = c.month AND cur.category IS NOT DISTINCT FROM c.category
    LEFT JOIN (SELECT * FROM spend UNION ALL SELECT * FROM totals) prev
      ON prev.month = (c.month - interval '1 month')::date AND prev.category IS NOT DISTINCT FROM c.category
  )
  SELECT j.month,
         coalesce(j.category, 'All categories'),
         round(j.cur, 2)::float8,
         round(j.prev, 2)::float8,
         round(j.cur - j.prev, 2)::float8,
         CASE WHEN j.prev = 0 THEN NULL ELSE round((j.cur - j.prev) / abs(j.prev) * 100, 1)::float8 END,
         abs(j.cur - j.prev) >= budget_mom_min_usd()
           AND (j.prev = 0 OR abs(j.cur - j.prev) / abs(j.prev) * 100 >= budget_mom_min_pct()),
         j.is_total,
         j.month = (SELECT m FROM this_month)
  FROM joined j
  WHERE j.is_total OR j.cur <> 0 OR j.prev <> 0
  ORDER BY j.month, j.is_total DESC, abs(j.cur - j.prev) DESC, j.category
$$;

-- Metric: budget variance and month-to-date pace ------------------------------------

DROP FUNCTION IF EXISTS budget_variance(text, text, date);
CREATE FUNCTION budget_variance(p_user_id text, p_database_id text, p_month date)
RETURNS TABLE (category text, planned double precision, actual double precision, remaining double precision,
               status text, is_total boolean, is_partial boolean)
LANGUAGE sql STABLE AS $$
  WITH m AS (SELECT budget_month_start(p_month) AS start, budget_month_end(p_month) AS finish),
  actual AS (
    SELECT s.category, sum(s.spend) AS amt
    FROM m, budget_spend_rows(p_user_id, p_database_id, m.start, m.finish) s
    GROUP BY s.category
  ),
  per AS (
    SELECT coalesce(t.category, a.category) AS category, t.planned, coalesce(a.amt, 0) AS amt
    FROM budget_targets(p_user_id, p_database_id) t
    FULL JOIN actual a ON a.category = t.category
  ),
  rows AS (
    SELECT category, planned, amt, false AS is_total FROM per
    UNION ALL
    SELECT 'All budgeted categories', sum(planned), sum(amt) FILTER (WHERE planned IS NOT NULL), true FROM per
    UNION ALL
    SELECT 'All spending', NULL, sum(amt), true FROM per
  )
  SELECT category,
         round(planned, 2)::float8,
         round(coalesce(amt, 0), 2)::float8,
         round(planned - coalesce(amt, 0), 2)::float8,
         CASE WHEN planned IS NULL THEN 'no budget'
              WHEN coalesce(amt, 0) > planned THEN 'over'
              WHEN coalesce(amt, 0) = planned THEN 'on budget'
              ELSE 'under' END,
         is_total,
         (SELECT finish FROM m) >= budget_today()
  FROM rows
  ORDER BY is_total, planned IS NULL, coalesce(amt, 0) - coalesce(planned, 0) DESC
$$;

-- Linear pace: by day d of an n-day month, spend should be at most planned * d / n.
DROP FUNCTION IF EXISTS month_to_date_pace(text, text, date);
CREATE FUNCTION month_to_date_pace(p_user_id text, p_database_id text, p_month date)
RETURNS TABLE (category text, planned double precision, spent double precision, expected_by_now double precision,
               over_pace_by double precision, projected_month_end double precision, days_elapsed int,
               days_in_month int, status text, is_total boolean)
LANGUAGE sql STABLE AS $$
  WITH m AS (SELECT budget_month_start(p_month) AS start, extract(day FROM budget_month_end(p_month))::int AS days),
  e AS (SELECT start, days, greatest(least(budget_today() - start + 1, days), 0) AS elapsed FROM m),
  v AS (SELECT * FROM budget_variance(p_user_id, p_database_id, p_month) WHERE category <> 'All spending')
  SELECT v.category,
         v.planned,
         v.actual,
         round((v.planned * e.elapsed / e.days)::numeric, 2)::float8,
         round((v.actual - v.planned * e.elapsed / e.days)::numeric, 2)::float8,
         CASE WHEN e.elapsed > 0 THEN round((v.actual / e.elapsed * e.days)::numeric, 2)::float8 END,
         e.elapsed,
         e.days,
         CASE WHEN v.planned IS NULL THEN 'no budget'
              WHEN v.actual > v.planned * e.elapsed / e.days THEN 'over pace'
              ELSE 'on or under pace' END,
         v.is_total
  FROM v, e
  ORDER BY v.is_total, v.planned IS NULL, v.actual - coalesce(v.planned * e.elapsed / e.days, 0) DESC
$$;

-- Metric: merchant groups ---------------------------------------------------------

-- A transaction belongs to a group when one of the group's patterns appears in
-- its raw payee or its vendor, ignoring case and anything but letters and digits.
DROP FUNCTION IF EXISTS spend_by_merchant_group(text, text, text, date, date);
CREATE FUNCTION spend_by_merchant_group(p_user_id text, p_database_id text, p_group text, p_start_date date, p_end_date date)
RETURNS TABLE (kind text, month date, tx_date date, vendor text, payee text, category text,
               amount double precision, transactions int)
LANGUAGE sql STABLE AS $$
  WITH pats AS (
    SELECT regexp_replace(lower(pattern), '[^a-z0-9]', '', 'g') AS p
    FROM "MerchantPattern"
    WHERE "userId" = p_user_id AND "groupName" = p_group
  ),
  tx AS (
    SELECT s.*
    FROM budget_spend_rows(p_user_id, p_database_id, p_start_date, p_end_date) s
    WHERE EXISTS (
      SELECT 1 FROM pats
      WHERE length(pats.p) >= 3
        AND (regexp_replace(lower(coalesce(s.payee, '')), '[^a-z0-9]', '', 'g') LIKE '%' || pats.p || '%'
             OR regexp_replace(lower(coalesce(s.vendor, '')), '[^a-z0-9]', '', 'g') LIKE '%' || pats.p || '%')
    )
  )
  SELECT u.* FROM (
    SELECT 'total' AS kind, NULL::date AS month, NULL::date AS tx_date, NULL::text AS vendor, NULL::text AS payee,
           NULL::text AS category, round(coalesce(sum(spend), 0), 2)::float8 AS amount, count(*)::int AS transactions
    FROM tx
    UNION ALL
    SELECT 'month', budget_month_start(tx_date), NULL, NULL, NULL, NULL, round(sum(spend), 2)::float8, count(*)::int
    FROM tx GROUP BY budget_month_start(tx_date)
    UNION ALL
    SELECT 'transaction', NULL, tx_date, vendor, payee, category, round(spend, 2)::float8, 1 FROM tx
  ) u
  ORDER BY CASE u.kind WHEN 'total' THEN 0 WHEN 'month' THEN 1 ELSE 2 END, u.month, u.tx_date, u.vendor
$$;

-- Metric: largest transactions --------------------------------------------------------

DROP FUNCTION IF EXISTS top_transactions(text, text, date, date, text, int);
CREATE FUNCTION top_transactions(p_user_id text, p_database_id text, p_start_date date, p_end_date date,
                                 p_category text DEFAULT NULL, p_limit int DEFAULT 10)
RETURNS TABLE (tx_date date, vendor text, payee text, category text, amount double precision, account text)
LANGUAGE sql STABLE AS $$
  SELECT tx_date, vendor, payee, category, round(spend, 2)::float8, account
  FROM budget_spend_rows(p_user_id, p_database_id, p_start_date, p_end_date)
  WHERE NOT is_refund
    AND (p_category IS NULL OR lower(category) = lower(p_category))
  ORDER BY spend DESC, tx_date
  LIMIT greatest(least(coalesce(p_limit, 10), 50), 1)
$$;

-- Bills ----------------------------------------------------------------------------

-- Mirrors normalizeVendor / vendorsSimilar in src/lib/budgetDb.ts, which the
-- dashboard uses, so both judge the same payment as paying the same bill.
CREATE OR REPLACE FUNCTION budget_normalize_vendor(s text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(string_agg(w, ' ' ORDER BY ord), '')
  FROM regexp_split_to_table(trim(regexp_replace(lower(coalesce(s, '')), '[^a-z0-9\s]+', ' ', 'g')), '\s+')
       WITH ORDINALITY AS t(w, ord)
  WHERE w <> '' AND w !~ '^\d{3,}$' AND w NOT IN ('inc', 'llc', 'llp', 'ltd', 'co', 'corp', 'the')
$$;

CREATE OR REPLACE FUNCTION budget_vendors_similar(a text, b text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  na text := budget_normalize_vendor(a);
  nb text := budget_normalize_vendor(b);
  short_name text;
  long_name text;
  ta text[];
  tb text[];
  shared int;
BEGIN
  IF na <> '' AND nb <> '' THEN
    IF na = nb THEN RETURN true; END IF;
    IF length(na) <= length(nb) THEN short_name := na; long_name := nb; ELSE short_name := nb; long_name := na; END IF;
    -- The shorter name must be at least 4 characters, so a stray fragment can't match.
    IF length(short_name) >= 4 AND position(short_name IN long_name) > 0 THEN RETURN true; END IF;
  END IF;
  ta := ARRAY(SELECT t FROM unnest(string_to_array(na, ' ')) t
              WHERE t <> '' AND t NOT IN ('of', 'and', 'for', 'to', 'at', 'in', 'on', 'a'));
  tb := ARRAY(SELECT t FROM unnest(string_to_array(nb, ' ')) t
              WHERE t <> '' AND t NOT IN ('of', 'and', 'for', 'to', 'at', 'in', 'on', 'a'));
  IF cardinality(ta) < 2 OR cardinality(tb) < 2 THEN RETURN false; END IF;
  SELECT count(DISTINCT t) INTO shared FROM unnest(ta) t WHERE t = ANY (tb);
  RETURN shared >= 2 AND shared::numeric / least(cardinality(ta), cardinality(tb)) >= 0.5;
END $$;

-- A rule's due dates from p_from to p_to, as occurrencesBetween computes them.
DROP FUNCTION IF EXISTS budget_rule_dues(date, text, date, date);
CREATE FUNCTION budget_rule_dues(p_anchor date, p_frequency text, p_from date, p_to date)
RETURNS SETOF date LANGUAGE sql IMMUTABLE AS $$
  SELECT d FROM (
    -- Weekly and biweekly: every stride from the anchor, before or after it.
    SELECT p_anchor + k * s AS d
    FROM (SELECT CASE p_frequency WHEN 'weekly' THEN 7 ELSE 14 END AS s) x,
         generate_series(floor((p_from - p_anchor)::numeric / x.s)::int, ceil((p_to - p_anchor)::numeric / x.s)::int) k
    WHERE p_frequency IN ('weekly', 'biweekly')
    UNION ALL
    -- Monthly: the anchor's day each month; a day past month end rolls over.
    SELECT ms::date + (extract(day FROM p_anchor)::int - 1)
    FROM generate_series(budget_month_start(p_from)::timestamp, budget_month_start(p_to)::timestamp, interval '1 month') ms
    WHERE p_frequency = 'monthly'
    UNION ALL
    -- Semimonthly: the anchor's day and 14 days later, each capped at month end.
    SELECT make_date(extract(year FROM ms)::int, extract(month FROM ms)::int,
                     least(extract(day FROM p_anchor)::int + off,
                           extract(day FROM budget_month_end(ms::date))::int))
    FROM generate_series(budget_month_start(p_from)::timestamp, budget_month_start(p_to)::timestamp, interval '1 month') ms,
         (VALUES (0), (14)) o(off)
    WHERE p_frequency = 'semimonthly'
  ) dues
  WHERE d BETWEEN p_from AND p_to
  ORDER BY d
$$;

-- Each active expense rule's due dates in the period that are not in the future,
-- settled oldest first with one payment per due date. A payment counts from half
-- a period before the due date until shortly before the next one, must be at least
-- budget_min_payment_share() of the bill, and must name a similar vendor.
--   on_time: paid on or before the due date plus budget_grace_days()
--   late: paid after that; days_late says by how much
--   missed: no payment, and an imported statement for the bill's account covers the date
--   not_confirmed: no payment, and no imported statement reaches the date yet
-- A rule's first due date is its anchor while the retired engine never moved it,
-- otherwise the day it was created. There is no autopay flag: every bill is checked.
DROP FUNCTION IF EXISTS bill_payment_status(text, text, date, date);
CREATE FUNCTION bill_payment_status(p_user_id text, p_database_id text, p_start_date date, p_end_date date)
RETURNS TABLE (bill text, amount_due double precision, due_date date, paid_date date, paid_amount double precision,
               paid_vendor text, status text, days_late int)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE
  r record;
  dues date[];
  pay_ids text[];
  pay_dates date[];
  pay_amounts numeric[];
  pay_vendors text[];
  pay_accounts text[];
  used boolean[];
  early int;
  first_due date;
  nxt date;
  acct text;
  hit int;
  today date := budget_today();
BEGIN
  FOR r IN SELECT * FROM "RecurringRule" rr
           WHERE rr."userId" = p_user_id AND rr."isActive" AND rr.type = 'expense'
           ORDER BY rr.name, rr.id LOOP
    early := CASE r.frequency WHEN 'weekly' THEN 3 WHEN 'biweekly' THEN 7 WHEN 'semimonthly' THEN 7 ELSE 14 END;
    first_due := CASE WHEN r."lastGeneratedDate" IS NULL THEN r."anchorDate"::date ELSE r."createdAt"::date END;
    dues := ARRAY(SELECT budget_rule_dues(r."anchorDate"::date, r.frequency, p_start_date - 60, p_end_date + 62));

    -- Candidate payments, oldest first; same-day ties newest-created first, as the dashboard orders them.
    SELECT array_agg(l.page_id ORDER BY l.tx_date, l.created_at DESC),
           array_agg(l.tx_date ORDER BY l.tx_date, l.created_at DESC),
           array_agg(-l.amount ORDER BY l.tx_date, l.created_at DESC),
           array_agg(l.vendor ORDER BY l.tx_date, l.created_at DESC),
           array_agg(l.account ORDER BY l.tx_date, l.created_at DESC)
      INTO pay_ids, pay_dates, pay_amounts, pay_vendors, pay_accounts
      FROM budget_ledger(p_user_id, p_database_id) l
      WHERE NOT l.is_forecast AND l.amount < 0
        AND -l.amount >= r.amount * budget_min_payment_share()
        AND budget_vendors_similar(l.vendor, r.name);
    used := array_fill(false, ARRAY[coalesce(array_length(pay_ids, 1), 0)]);

    -- The bill's account is the one its latest payment came from.
    acct := NULL;
    FOR j IN REVERSE coalesce(array_length(pay_ids, 1), 0) .. 1 LOOP
      IF coalesce(pay_accounts[j], '') <> '' THEN acct := pay_accounts[j]; EXIT; END IF;
    END LOOP;

    FOR i IN 1 .. coalesce(array_length(dues, 1), 0) LOOP
      nxt := coalesce(dues[i + 1], dues[i] + 62);
      hit := NULL;
      FOR j IN 1 .. coalesce(array_length(pay_ids, 1), 0) LOOP
        IF NOT used[j] AND pay_dates[j] >= dues[i] - early AND pay_dates[j] < nxt - ceil(early / 2.0)::int THEN
          hit := j; used[j] := true; EXIT;
        END IF;
      END LOOP;

      CONTINUE WHEN dues[i] < greatest(p_start_date, first_due) OR dues[i] > least(p_end_date, today);
      bill := r.name;
      amount_due := round(r.amount::numeric, 2)::float8;
      due_date := dues[i];
      IF hit IS NOT NULL THEN
        paid_date := pay_dates[hit];
        paid_amount := round(pay_amounts[hit], 2)::float8;
        paid_vendor := pay_vendors[hit];
        days_late := greatest(pay_dates[hit] - dues[i] - budget_grace_days(), 0);
        status := CASE WHEN days_late > 0 THEN 'late' ELSE 'on_time' END;
      ELSE
        paid_date := NULL; paid_amount := NULL; paid_vendor := NULL; days_late := NULL;
        status := CASE WHEN EXISTS (
          SELECT 1 FROM "ImportLog" il
          WHERE il."userId" = p_user_id
            AND dues[i] BETWEEN il."dateFrom"::date AND il."dateTo"::date
            AND (acct IS NULL OR il.account IS NULL OR il.account = acct)
        ) THEN 'missed' ELSE 'not_confirmed' END;
      END IF;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END $$;
