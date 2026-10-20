import { loadEnvConfig } from '@next/env';
import { prisma } from '@/lib/prisma';

loadEnvConfig(process.cwd());

/** The account the evals read, named by EVAL_USER_EMAIL in .env. */
export async function evalUser(): Promise<{ id: string; email: string }> {
  const email = process.env.EVAL_USER_EMAIL;
  if (!email) throw new Error('Set EVAL_USER_EMAIL in .env to the account whose ledger the evals read.');
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, email: true } });
  if (!user?.email) throw new Error(`No user with the email in EVAL_USER_EMAIL.`);
  return { id: user.id, email: user.email };
}
