import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { sessionUserId } from '@/lib/sessionUser';
import { prisma } from '@/lib/prisma';
import { ownedPage } from '@/lib/ownership';

const bodySchema = z.object({
  pageId: z.string().min(1),
  propertyId: z.string().min(1),
  value: z.unknown(),
});

// Sets one cell. The row must be the user's and the property must belong to
// the row's own database; a null or empty value clears the cell.
export async function PUT(request: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'PropertyId and pageId required' }, { status: 400 });
  const { pageId, propertyId, value } = parsed.data;

  const page = await ownedPage(userId, pageId);
  const property = page?.databaseId
    ? await prisma.property.findFirst({ where: { id: propertyId, databaseId: page.databaseId }, select: { id: true } })
    : null;
  if (!page || !property) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    if (value === null || value === undefined || value === '') {
      await prisma.propertyValue.deleteMany({ where: { propertyId, pageId } });
      return NextResponse.json({ propertyId, pageId, value: null });
    }
    const v = value as Prisma.InputJsonValue;
    const propertyValue = await prisma.propertyValue.upsert({
      where: { propertyId_pageId: { propertyId, pageId } },
      update: { value: v },
      create: { propertyId, pageId, value: v },
    });
    return NextResponse.json(propertyValue);
  } catch (error) {
    console.error('Error updating property value:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
