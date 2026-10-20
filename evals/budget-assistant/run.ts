/** @jest-environment node */
import { evalUser } from './env';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { answerBudgetQuestion } from '@/lib/budgetAssist/assistant';
import { detroitToday } from '@/lib/budgetAssist/periods';
import { checkEntry, table, type Check, type Golden } from './golden';

test('every golden answer is backed by matching sources', async () => {
  const path = join(__dirname, 'golden.json');
  if (!existsSync(path)) throw new Error('No golden.json yet. Run npm run eval:budget:fill first.');
  const golden: Golden = JSON.parse(readFileSync(path, 'utf8'));
  if (golden.today !== detroitToday()) console.warn(`golden.json was filled on ${golden.today}; bill statuses can change as statements arrive.`);

  const user = await evalUser();
  const checks: Check[] = [];
  const answers: unknown[] = [];
  for (const entry of golden.entries) {
    try {
      const answer = await answerBudgetQuestion({ userId: user.id, question: entry.question });
      checks.push(...checkEntry(entry, answer.sources));
      answers.push({ id: entry.id, question: entry.question, ...answer });
    } catch (err) {
      checks.push({ entry: entry.id, check: 'assistant answered', expected: true, actual: String(err), pass: false });
    }
  }

  const dir = join(__dirname, 'results');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(dir, `${stamp}.json`), JSON.stringify({ golden_generated_at: golden.generated_at, checks, answers }, null, 2));
  console.log(table(checks));
  expect(checks.filter((c) => !c.pass)).toEqual([]);
}, 600_000);
