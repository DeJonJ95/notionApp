import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { statusSchema } from '@/lib/jobs/status';
import { z } from 'zod';

export const runtime = 'nodejs';

const patchSchema = z.object({
  status: statusSchema.optional(),
  field: z.string().max(100).nullable().optional(),
  compOfferMin: z.number().int().min(0).max(100_000_000).nullable().optional(),
  compOfferMax: z.number().int().min(0).max(100_000_000).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  // Optional note attached to a status change in the timeline.
  statusNote: z.string().max(500).optional(),
});

// Update an application. A status change appends an ApplicationEvent so the
// timeline reflects how it moved through the pipeline.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const existing = await prisma.jobApplication.findFirst({
    where: { id: params.id, userId },
    select: { id: true, status: true, appliedAt: true },
  });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { status, field, compOfferMin, compOfferMax, notes, statusNote } = parsed.data;
  const data: Record<string, unknown> = {};
  if (status !== undefined) data.status = status;
  if (field !== undefined) data.field = field;
  if (compOfferMin !== undefined) data.compOfferMin = compOfferMin;
  if (compOfferMax !== undefined) data.compOfferMax = compOfferMax;
  if (notes !== undefined) data.notes = notes;
  // Backfill appliedAt the first time it leaves SAVED, if not already set.
  if (status && status !== 'SAVED' && !existing.appliedAt) data.appliedAt = new Date();

  const application = await prisma.jobApplication.update({
    where: { id: existing.id },
    data,
    include: { events: { orderBy: { createdAt: 'desc' } } },
  });

  if (status && status !== existing.status) {
    await prisma.applicationEvent.create({
      data: {
        applicationId: existing.id,
        fromStatus: existing.status,
        toStatus: status,
        note: statusNote ?? null,
      },
    });
  }

  return NextResponse.json({ application });
}
