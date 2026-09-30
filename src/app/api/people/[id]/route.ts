import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { currentUserId } from '@/lib/events/session';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  contact: z.string().trim().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const person = await prisma.person.findFirst({ where: { id: params.id, ownerId: userId } });
  if (!person) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { name, ...rest } = parsed.data;
  // Naming a "+1" makes them a real person; the old spelling stays matchable.
  const rename = name && name !== person.name
    ? { name, isPlaceholder: false, aliases: person.isPlaceholder ? person.aliases : [...person.aliases, person.name] }
    : {};
  const updated = await prisma.person.update({ where: { id: person.id }, data: { ...rest, ...rename } });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { count } = await prisma.person.deleteMany({ where: { id: params.id, ownerId: userId } });
  if (count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
