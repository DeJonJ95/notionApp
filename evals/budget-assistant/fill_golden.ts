/** @jest-environment node */
import { evalUser } from './env';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '@/lib/prisma';
import { detroitToday } from '@/lib/budgetAssist/periods';
import { PERIOD, QUESTIONS, type Expected, type Golden } from './golden';

test('fill golden.json from compute_expected.sql', async () => {
  const user = await evalUser();
  const today = detroitToday();
  const sql = readFileSync(join(__dirname, 'compute_expected.sql'), 'utf8');
  const settings = { user_email: user.email, start_date: PERIOD.start, end_date: PERIOD.end, today };
  const [row] = await prisma.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(settings)) {
      await tx.$queryRaw`SELECT set_config(${`budget_eval.${key}`}, ${value}, true)`;
    }
    return tx.$queryRawUnsafe<{ expected: Expected }[]>(sql);
  });
  const e = row.expected;
  const golden: Golden = {
    generated_at: new Date().toISOString(),
    today,
    period: PERIOD,
    entries: [
      { id: 'month_over_month', question: QUESTIONS.month_over_month, expected: e.month_over_month, verified_against_statement: false },
      { id: 'bill_payment_status', question: QUESTIONS.bill_payment_status, expected: e.bill_payment_status, verified_against_statement: false },
      { id: 'fast_food', question: QUESTIONS.fast_food, expected: e.fast_food, verified_against_statement: false },
    ],
  };
  writeFileSync(join(__dirname, 'golden.json'), JSON.stringify(golden, null, 2) + '\n');
  console.log(JSON.stringify(golden, null, 2));
}, 120_000);
