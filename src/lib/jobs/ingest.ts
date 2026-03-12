// Shared listing-creation logic used by both the manual "Paste job" route
// (/api/jobs, session auth) and the extension capture route (/api/jobs/ingest,
// bearer auth). De-dupes per user by source URL: re-capturing a posting
// updates the existing row instead of creating a duplicate.

import { prisma } from '@/lib/prisma';
import { parseJob } from './parse';
import { z } from 'zod';

export const ingestSchema = z.object({
  sourceUrl: z.string().url(),
  applyUrl: z.string().url().optional().nullable(),
  company: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  description: z.string().min(20).max(60_000),
  location: z.string().max(200).optional().nullable(),
  field: z.string().max(100).optional().nullable(),
  rawJson: z.any().optional(),
});

export type IngestInput = z.infer<typeof ingestSchema>;

export async function upsertListing(userId: string, input: IngestInput) {
  const heur = parseJob(input.description);
  const data = {
    userId,
    sourceUrl: input.sourceUrl,
    applyUrl: input.applyUrl ?? null,
    company: input.company,
    title: input.title,
    description: input.description,
    location: input.location ?? heur.location ?? null,
    remote: heur.remote,
    compMin: heur.compMin ?? null,
    compMax: heur.compMax ?? null,
    field: input.field ?? null,
    rawJson: input.rawJson ?? undefined,
  };

  return prisma.jobListing.upsert({
    where: { userId_sourceUrl: { userId, sourceUrl: input.sourceUrl } },
    create: data,
    // Don't clobber comp/field a user may have already corrected; refresh the
    // posting content and apply links on re-capture.
    update: {
      applyUrl: data.applyUrl,
      company: data.company,
      title: data.title,
      description: data.description,
      rawJson: data.rawJson,
    },
  });
}
