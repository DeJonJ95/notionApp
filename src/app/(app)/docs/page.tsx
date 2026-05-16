import Link from 'next/link';
import { BookOpen } from 'lucide-react';

export const metadata = { title: 'Docs · Kove' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-9">
      <h2 className="text-lg font-bold text-text mb-2 scroll-mt-6" id={title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
        {title}
      </h2>
      <div className="space-y-2 text-sm text-muted leading-relaxed">{children}</div>
    </section>
  );
}
function Item({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="text-text font-medium">{name}</span> — {children}
    </p>
  );
}

export default function DocsPage() {
  const toc = [
    'Workspaces & pages', 'Canvas notes', 'Text formatting', 'Databases',
    'Views, filters & grouping', 'Relations & rollups', 'Budget', 'Recurring & forecast',
    'Goals, rules & trends', 'Transcripts & audio', 'Extract from notes',
    'Gestures & shortcuts',
  ];
  return (
    <div className="max-w-3xl mx-auto px-6 md:px-12 py-12">
      <div className="flex items-center gap-2 mb-1">
        <BookOpen size={20} className="text-accent" />
        <h1 className="text-3xl font-bold">Kove documentation</h1>
      </div>
      <p className="text-muted mb-8">Every feature, in one page.</p>

      <nav className="mb-10 rounded-xl border border-border bg-surface p-4">
        <p className="text-xs uppercase tracking-wide text-muted mb-2 font-semibold">Contents</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {toc.map((t) => (
            <a key={t} href={`#${t.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="text-accent hover:underline">
              {t}
            </a>
          ))}
        </div>
      </nav>

      <Section title="Workspaces & pages">
        <Item name="Workspaces">Top-level containers in the sidebar. Create one with “+ New workspace”, rename or change its icon with the hover controls, delete via the trash icon (you always keep at least one). Workspace trees start collapsed — click the chevron to expand.</Item>
        <Item name="Pages">Live in a workspace tree, can nest. Create with the “+” on a workspace or page row. Deleting a page is a soft-delete — an Undo toast appears so you can restore it.</Item>
        <Item name="Today’s Journal">A dated page is auto-created each day and pinned near the top of the sidebar.</Item>
        <Item name="Favorites">Star a page (in its editor) to surface it under Favorites in the sidebar.</Item>
      </Section>

      <Section title="Canvas notes">
        <Item name="Free positioning">Notes are a canvas, not a linear doc. Click empty space to create a text block; drag blocks anywhere.</Item>
        <Item name="Moving blocks">Desktop: hover a block and drag its grip, or hold Alt and drag anywhere on it. Mobile: tap the bar above a block, then drag; lift to drop. The canvas auto-scrolls when you drag near an edge.</Item>
        <Item name="Resizing">Drag a block’s right edge. Images have their own corner handle — the block grows with the image so nothing overlaps.</Item>
        <Item name="Delete">The X on a block, or Alt+Delete on the focused/hovered block.</Item>
        <Item name="Zoom">Pinch on mobile, or the floating bottom-right controls. Notes open at ~55% zoom on phones so the page fits.</Item>
        <Item name="Slash menu">Type “/” at the start of a block for headings, lists, to-dos, quote, code, etc.</Item>
        <Item name="Images">The image button uploads from your device (stored in R2). Click an image to enter resize mode; drag the corner.</Item>
      </Section>

      <Section title="Text formatting">
        <Item name="Toolbar">Bold, italic, underline, strikethrough, link, font family, and font-size steppers — all operate on the currently-focused block. Works on mobile and desktop.</Item>
        <Item name="Links">The link button prompts for a URL (auto-prefixes https). Leave blank to remove a link.</Item>
      </Section>

      <Section title="Databases">
        <Item name="Creating">From Templates (Project Tracker, Personal Budget, Reading List, Habit Tracker, CRM, etc.) or as a database block inside a note.</Item>
        <Item name="Properties">Add/edit/delete columns via the property header (pencil/trash on hover) or “Add Property”. Types: text, number, date, checkbox, select, formula, relation, rollup. Editing a type warns before it can mis-display existing values.</Item>
        <Item name="Move page in">Pulls an existing page into this database. A page belongs to exactly one database, so this *moves* it (it leaves its old one) — you’ll be asked to confirm. For a reference that doesn’t move the page, use a Relation property instead.</Item>
        <Item name="Move database">The “Move” button in a database header relocates the whole database (and its rows) to another workspace.</Item>
        <Item name="Editing cells">Inline and instant — edits buffer locally and save debounced, so typing never lags.</Item>
      </Section>

      <Section title="Views, filters & grouping">
        <Item name="View types">Table, board, gallery, list, calendar, plus budget-specific Budget Summary and Spending Breakdown.</Item>
        <Item name="Filter / Sort / Group">The config bar above table/list/gallery/board views: filter by any property (contains / is), sort asc/desc (numeric-aware), and group a table by a select property. All of it persists on the view.</Item>
        <Item name="Reordering rows">Desktop: drag a row. Mobile: long-press (~0.5s) a row, drag, release on the target.</Item>
      </Section>

      <Section title="Relations & rollups">
        <Item name="Relation">A property type that links rows to another database. Each cell is a searchable picker; a row can link to many. Nothing moves — both rows stay in their own databases.</Item>
        <Item name="Rollup">Aggregates a field across a relation’s linked rows: count, sum, average, min, or max. Read-only, recomputed live.</Item>
        <Item name="Use which?">Use a Relation/Rollup to reference & summarize across databases. Use “Move page in” only to relocate a misfiled page.</Item>
      </Section>

      <Section title="Budget">
        <Item name="Import statements">/budget → Import statement. Upload a CSV or PDF from any bank; DeepSeek extracts and categorizes every transaction. Review/edit the preview table, then confirm — rows save to your Personal Budget database.</Item>
        <Item name="Dashboard">Income, expenses, net, projected end-of-month, spending excesses (categories up &gt;50% vs last month), category breakdown, recent transactions, and detected recurring charges.</Item>
        <Item name="Budget Summary view">In the Personal Budget database — weekly/bi-weekly/monthly windows. Click a category to expand the individual transactions behind its total.</Item>
        <Item name="Cancel subscriptions">On any detected recurring charge, the email icon drafts a cancellation email (DeepSeek) with a best-guess support address; copy it or open in Gmail/mail.</Item>
      </Section>

      <Section title="Recurring & forecast">
        <Item name="Recurring rules">Budget → Recurring. Define paychecks and bills (weekly / biweekly / semimonthly / monthly + next date). On each visit the engine auto-creates any due transactions and advances the schedule — a banner tells you how many were added.</Item>
        <Item name="Track button">On any repeat vendor or transaction, “Track” pre-fills a recurring rule from it.</Item>
        <Item name="Forecast">“Coming up — next 14 days” lists scheduled income/expense; the Projected EoM card folds it into the month-end estimate.</Item>
      </Section>

      <Section title="Goals, rules & trends">
        <Item name="Savings goals">Budget → Goals. Target amount, optional deadline, progress bar, quick +25/+100/+500 or custom contributions, and a pace hint vs the deadline.</Item>
        <Item name="Categorization rules">Budget → Rules. “If vendor contains X → category Y”, overriding the AI on import. Auto-learned whenever you correct a category in the import preview.</Item>
        <Item name="Trends">Last 6 months of income vs expenses as a bar chart on the dashboard.</Item>
      </Section>

      <Section title="Transcripts & audio">
        <Item name="YouTube / TikTok">Toolbar buttons import a video’s transcript (via Supadata) as a new text block. TikTok only works when the video has captions.</Item>
        <Item name="Audio notes">Record button transcribes speech (Groq Whisper); long recordings chunk automatically.</Item>
      </Section>

      <Section title="Extract from notes">
        <Item name="What it does">Sidebar → Extract from notes. Pulls structured records out of free text and proposes create/update operations against your databases. Review each, then apply.</Item>
        <Item name="Sources">Paste text, pick a single page, or batch over recent pages. New rows can include an AI-written body summary.</Item>
      </Section>

      <Section title="Gestures & shortcuts">
        <Item name="⌘K / Ctrl+K">Search.</Item>
        <Item name="“/”">Slash command menu inside a block.</Item>
        <Item name="Alt+Delete">Delete the focused/hovered canvas block.</Item>
        <Item name="Alt+drag">Move a canvas block from anywhere on it (desktop).</Item>
        <Item name="Long-press">Mobile: drag a canvas block, or reorder a database row.</Item>
        <Item name="Undo toast">After deleting a page, an Undo button appears for a few seconds.</Item>
      </Section>

      <p className="text-xs text-muted border-t border-border pt-6">
        Missing something or hit a bug? <Link href="/" className="text-accent hover:underline">Back to home</Link>.
      </p>
    </div>
  );
}
