// List the authenticated user's most recently-updated pages for the
// extension's note picker. Bearer-token authenticated.

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyClipperToken, corsPreflight, jsonWithCors } from '@/lib/clipperAuth';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req);
}

export async function GET(req: NextRequest) {
  const ctx = await verifyClipperToken(req);
  if (!ctx) return jsonWithCors(req, { error: 'Unauthorized' }, { status: 401 });

  const pages = await prisma.page.findMany({
    where: { authorId: ctx.userId, isArchived: false },
    orderBy: { updatedAt: 'desc' },
    take: 30,
    select: {
      id: true,
      title: true,
      icon: true,
      updatedAt: true,
      workspace: { select: { name: true, icon: true } },
    },
  });

  return jsonWithCors(req, {
    pages: pages.map((p) => ({
      id: p.id,
      title: p.title || 'Untitled',
      icon: p.icon ?? '📄',
      updatedAt: p.updatedAt,
      workspaceName: p.workspace?.name ?? '',
      workspaceIcon: p.workspace?.icon ?? null,
    })),
  });
}
