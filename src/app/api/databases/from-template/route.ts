import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { DB_TEMPLATES } from '@/lib/dbTemplates';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const { templateId, name, workspaceId } = await req.json();

  if (!templateId || !workspaceId) {
    return NextResponse.json({ error: 'templateId and workspaceId required' }, { status: 400 });
  }

  const template = DB_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    return NextResponse.json({ error: 'Unknown template' }, { status: 400 });
  }

  // Verify workspace ownership
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, ownerId: userId },
  });
  if (!workspace) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const dbName = (name as string | undefined)?.trim() || template.name;

  const database = await prisma.$transaction(async (tx) => {
    const db = await tx.database.create({
      data: { name: dbName, workspaceId },
    });

    // Create properties in order
    for (let i = 0; i < template.properties.length; i++) {
      const prop = template.properties[i];
      await tx.property.create({
        data: {
          name: prop.name,
          type: prop.type,
          formula: prop.options ? JSON.stringify(prop.options) : null,
          position: (i + 1) * 1024,
          databaseId: db.id,
        },
      });
    }

    // Create views in order
    for (let i = 0; i < template.views.length; i++) {
      const view = template.views[i];
      await tx.view.create({
        data: {
          name: view.name,
          type: view.type,
          databaseId: db.id,
        },
      });
    }

    return db;
  });

  return NextResponse.json({ databaseId: database.id });
}
