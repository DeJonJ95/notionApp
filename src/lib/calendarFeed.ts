// Read-only ICS calendar feed: turns dated database items into an
// iCalendar (RFC 5545) document that Google Calendar / Outlook can
// subscribe to by URL.
//
// Date property values are stored as plain "YYYY-MM-DD" strings (from an
// <input type="date">), so every event is an all-day VEVENT with
// VALUE=DATE — no timezone math. One event per (page, date-property) pair
// that has a value.

import { prisma } from './prisma';

// ── ICS text helpers ────────────────────────────────────────────────

// Escape per RFC 5545 §3.3.11: backslash, semicolon, comma, newline.
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Fold lines to <=75 octets per RFC 5545 §3.1. We approximate octets with
// chars (titles are usually ASCII); continuation lines start with a space.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  parts.push(line.slice(0, 75));
  i = 75;
  while (i < line.length) {
    parts.push(' ' + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join('\r\n');
}

// "YYYY-MM-DD" -> "YYYYMMDD" for VALUE=DATE. Returns null if not a valid
// date-only string so malformed values are skipped rather than emitted.
function toIcsDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}`;
}

// All-day DTEND is exclusive, so a single-day event ends the next day.
function nextDay(icsDate: string): string {
  const y = Number(icsDate.slice(0, 4));
  const mo = Number(icsDate.slice(4, 6)) - 1;
  const d = Number(icsDate.slice(6, 8));
  const dt = new Date(Date.UTC(y, mo, d + 1));
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function dtStamp(): string {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}` +
    `T${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}Z`
  );
}

// ── Feed builder ─────────────────────────────────────────────────────

/**
 * Build the full ICS document for a user's dated database items.
 * `baseUrl` is used to link each event back to its Kove page.
 */
export async function buildIcsForUser(userId: string, baseUrl: string): Promise<string> {
  const rows = await prisma.propertyValue.findMany({
    where: {
      property: { type: 'date' },
      page: {
        isArchived: false,
        workspace: { ownerId: userId },
      },
    },
    select: {
      value: true,
      property: { select: { id: true, name: true } },
      page: { select: { id: true, title: true } },
    },
  });

  const stamp = dtStamp();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kove//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Kove',
  ];

  for (const row of rows) {
    // value is JSON; a date cell holds a "YYYY-MM-DD" string.
    const raw = typeof row.value === 'string' ? row.value : row.value == null ? '' : String(row.value);
    const start = toIcsDate(raw);
    if (!start) continue;

    const title = row.page.title?.trim() || 'Untitled';
    const propName = row.property.name?.trim() || '';
    // Disambiguate when the date isn't the generic "Date" column.
    const summary =
      propName && propName.toLowerCase() !== 'date' ? `${title} (${propName})` : title;

    lines.push('BEGIN:VEVENT');
    // Stable UID so re-fetches update the same event rather than duplicate.
    lines.push(foldLine(`UID:${row.page.id}-${row.property.id}@kove`));
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${nextDay(start)}`);
    lines.push(foldLine(`SUMMARY:${escapeText(summary)}`));
    lines.push(foldLine(`URL:${baseUrl}/page/${row.page.id}`));
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  // RFC 5545 requires CRLF line endings.
  return lines.join('\r\n') + '\r\n';
}
