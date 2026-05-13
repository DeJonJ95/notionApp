import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export type ReminderItem = {
  pageId: string;
  title: string;
  databaseId: string;
  databaseName: string;
  dueDate: string;
  daysUntilDue: number;
  amount: number | null;
  vendor: string | null;
  category: string | null;
  priority: string | null;
  status: string | null;
  recurring: boolean;
  statusPropertyId: string | null;
};

export type RemindersPayload = {
  overdue: ReminderItem[];
  dueSoon: ReminderItem[];
  upcoming: ReminderItem[];
  total: number;
};

function toStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  return String(v);
}

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Find all databases that have a "Due Date" date property
  const databases = await prisma.database.findMany({
    where: {
      workspace: { ownerId: userId },
      properties: { some: { name: 'Due Date', type: 'date' } },
    },
    include: {
      properties: {
        where: {
          name: { in: ['Due Date', 'Status', 'Amount', 'Vendor', 'Category', 'Recurring', 'Priority'] },
        },
      },
      pages: {
        where: { isArchived: false },
        include: {
          properties: {
            include: { property: { select: { name: true } } },
          },
        },
      },
    },
  });

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const overdue: ReminderItem[] = [];
  const dueSoon: ReminderItem[] = [];
  const upcoming: ReminderItem[] = [];

  for (const db of databases) {
    const propIdMap: Record<string, string> = {};
    for (const p of db.properties) propIdMap[p.name] = p.id;

    for (const page of db.pages) {
      const pvByName: Record<string, unknown> = {};
      for (const pv of page.properties) {
        pvByName[pv.property.name] = pv.value;
      }

      const rawDueDate = toStr(pvByName['Due Date']);
      if (!rawDueDate) continue;

      const dueDate = new Date(rawDueDate);
      if (isNaN(dueDate.getTime())) continue;

      const status = toStr(pvByName['Status']);
      if (status === 'Cleared') continue;

      const daysUntilDue = Math.ceil(
        (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      const amountRaw = pvByName['Amount'];
      const recurringRaw = pvByName['Recurring'];

      const item: ReminderItem = {
        pageId: page.id,
        title: page.title,
        databaseId: db.id,
        databaseName: db.name,
        dueDate: dueDate.toISOString(),
        daysUntilDue,
        amount: amountRaw != null ? Number(amountRaw) : null,
        vendor: toStr(pvByName['Vendor']),
        category: toStr(pvByName['Category']),
        priority: toStr(pvByName['Priority']),
        status,
        recurring: recurringRaw === true || recurringRaw === 'true',
        statusPropertyId: propIdMap['Status'] ?? null,
      };

      if (daysUntilDue < 0) overdue.push(item);
      else if (dueDate <= sevenDaysOut) dueSoon.push(item);
      else if (dueDate <= thirtyDaysOut) upcoming.push(item);
    }
  }

  const byDue = (a: ReminderItem, b: ReminderItem) =>
    new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();

  const payload: RemindersPayload = {
    overdue: overdue.sort(byDue),
    dueSoon: dueSoon.sort(byDue),
    upcoming: upcoming.sort(byDue),
    total: overdue.length + dueSoon.length + upcoming.length,
  };

  return NextResponse.json(payload);
}
