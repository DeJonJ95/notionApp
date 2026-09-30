export type ImportRow = { title: string; values: Record<string, string> };

export type ParsedImport = {
  rows: ImportRow[];
  columns: string[];
  headerless: boolean;
};

export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      out.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim() !== ''));
}

const NAME_HEADERS = ['name', 'title', 'guest'];

export function parseImportText(text: string, fallbackColumns: string[]): ParsedImport {
  const grid = parseCsv(text);
  if (grid.length === 0) return { rows: [], columns: [], headerless: false };
  const first = grid[0].map((c) => c.trim());
  const nameIdx = first.findIndex((h) => NAME_HEADERS.includes(h.toLowerCase()));
  const headerless = nameIdx === -1;
  const columns = headerless ? fallbackColumns.slice(0, grid[0].length) : first;
  const body = headerless ? grid : grid.slice(1);
  const titleIdx = headerless ? 0 : nameIdx;
  const rows: ImportRow[] = [];
  for (const cells of body) {
    const title = (cells[titleIdx] ?? '').trim();
    if (!title) continue;
    const values: Record<string, string> = {};
    columns.forEach((col, i) => {
      if (i === titleIdx || !col) return;
      const v = (cells[i] ?? '').trim();
      if (v) values[col] = v;
    });
    rows.push({ title, values });
  }
  return { rows, columns: columns.filter((_, i) => i !== titleIdx), headerless };
}

export function normalizeCell(type: string, raw: string): unknown {
  const v = raw.trim();
  if (type === 'date') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (type === 'number') {
    const n = Number(v.replace(/[$,]/g, ''));
    return isNaN(n) ? null : n;
  }
  if (type === 'checkbox') return /^(true|yes|y|1|x|✓)$/i.test(v);
  return v;
}
