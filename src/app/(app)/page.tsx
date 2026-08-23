import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { BudgetReminders } from '@/components/budget/BudgetReminders';
import { WelcomeCard } from '@/components/onboarding/WelcomeCard';
import { EntityIcon } from '@/components/icons/registry';
import { TodaysNoteButton } from '@/components/journal/TodaysNoteButton';
import { VoiceCaptureButton } from '@/components/journal/VoiceCaptureButton';

// Relative age for the "worth revisiting" card.
function agoLabel(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default async function DashboardPage() {
  const session = await auth();
  const userId = (session?.user as any)?.id;

  const resurfaceCutoff = new Date(Date.now() - 14 * 86_400_000);

  const [recentPages, workspaces, resurfaceCandidates] = await Promise.all([
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
    prisma.page.findMany({
      where: {
        authorId: userId,
        isArchived: false,
        databaseId: null, // real notes, not database rows
        createdAt: { lt: resurfaceCutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: 60,
      include: { workspace: true },
    }),
  ]);

  // Pick up to 3 older notes to resurface, stable for the whole day so the
  // card doesn't reshuffle on every navigation but changes day to day.
  const todaySeed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const resurfaced: typeof resurfaceCandidates = [];
  if (resurfaceCandidates.length) {
    const used = new Set<number>();
    for (let i = 0; i < Math.min(3, resurfaceCandidates.length); i++) {
      let idx = (todaySeed * 7 + i * 13) % resurfaceCandidates.length;
      let guard = 0;
      while (used.has(idx) && guard < resurfaceCandidates.length) {
        idx = (idx + 1) % resurfaceCandidates.length;
        guard++;
      }
      used.add(idx);
      resurfaced.push(resurfaceCandidates[idx]);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-12 py-12">
      <h1 className="text-3xl font-bold mb-2">
        Hi{session?.user?.name ? `, ${session.user.name.split(' ')[0]}` : ''}
      </h1>
      <p className="text-muted mb-6">Pick up where you left off.</p>

      {/* Quick access to today's journal + voice capture — saves a sidebar trip on mobile */}
      <div className="mb-10 flex flex-wrap gap-3">
        <TodaysNoteButton />
        <VoiceCaptureButton />
      </div>

      {/* First-run onboarding — dismissible, localStorage-gated */}
      <WelcomeCard />

      {/* Budget reminders — only renders if there are upcoming/overdue items */}
      <BudgetReminders />

      {/* Resurfaced older notes — a nudge to revisit past thinking */}
      {resurfaced.length > 0 && (
        <section className="mb-12">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">
            Worth revisiting
          </h2>
          <ul className="space-y-1">
            {resurfaced.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/page/${p.id}`}
                  className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-surface"
                >
                  <EntityIcon icon={p.icon} size={16} className="shrink-0 text-muted" />
                  <span className="flex-1 truncate">{p.title}</span>
                  <span className="text-xs text-muted shrink-0">{agoLabel(p.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

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
              <EntityIcon icon={w.icon} kind="workspace" size={24} className="mb-2" />
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
                  <EntityIcon icon={p.icon} size={16} className="shrink-0 text-muted" />
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
