import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { deleteObject } from '@/lib/r2';

export const runtime = 'nodejs';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const resume = await prisma.resume.findFirst({
    where: { id: params.id, userId },
    select: { id: true, r2Key: true },
  });
  if (!resume) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.resume.delete({ where: { id: resume.id } });
  // Remove the stored file too so deleted resumes don't linger in R2.
  await deleteObject(resume.r2Key).catch(() => {});
  return NextResponse.json({ ok: true });
}
