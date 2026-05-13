import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { BudgetReminders } from '@/components/budget/BudgetReminders';

export default async function DashboardPage() {
  const session = await auth();
  const userId = (session?.user as any)?.id;

  const [recentPages, workspaces] = await Promise.all([
    prisma.page.findMany({
      where: { authorId: userId, isArchived: false },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      include: { workspace: true },
    }),
    prisma.workspace.findMany({
      where: { ownerId: userId },
      include: { _count: { select: { pages: true } } },
    }),
  ]);

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-12 py-12">
      <h1 className="text-3xl font-bold mb-2">
        Hi{session?.user?.name ? `, ${session.user.name.split(' ')[0]}` : ''}
      </h1>
      <p className="text-muted mb-10">Pick up where you left off.</p>

      {/* Budget reminders — only renders if there are upcoming/overdue items */}
      <BudgetReminders />

      <section className="mb-12">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">
          Workspaces
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {workspaces.map((w) => (
            <Link
              key={w.id}
              href={`/workspace/${w.slug}`}
              className="rounded-lg border border-border p-4 hover:bg-surface transition"
            >
              <div className="text-2xl mb-2">{w.icon}</div>
              <div className="font-medium">{w.name}</div>
              <div className="text-xs text-muted">{w._count.pages} pages</div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">
          Recently edited
        </h2>
        {recentPages.length === 0 ? (
          <p className="text-sm text-muted">
            No pages yet. Pick a workspace and create your first page.
          </p>
        ) : (
          <ul className="space-y-1">
            {recentPages.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/page/${p.id}`}
                  className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-surface"
                >
                  <span>{p.icon ?? '📄'}</span>
                  <span className="flex-1 truncate">{p.title}</span>
                  <span className="text-xs text-muted">{p.workspace.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
