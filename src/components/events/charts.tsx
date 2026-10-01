'use client';

import { useState } from 'react';

export type Column = { label: string; value: number; detail?: string };

function Tip({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-bg px-2 py-1 text-xs text-text shadow">
      {text}
    </div>
  );
}

/** Single-series columns. Values sit on the bars only while there are few
 *  enough to read; past that the hover tooltip carries them. */
export function Columns({ data, height = 140 }: { data: Column[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const labelled = data.length <= 10;
  return (
    <figure className="space-y-1">
      <div className="flex items-end gap-[2px] border-b border-border" style={{ height }}>
        {data.map((d, i) => (
          <div
            key={d.label}
            className="relative flex h-full flex-1 flex-col justify-end"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {hover === i && <Tip text={d.detail ?? `${d.label}: ${d.value}`} />}
            {labelled && d.value > 0 && <span className="mb-0.5 text-center text-xs tabular-nums text-text">{d.value}</span>}
            <div
              className="mx-auto w-full max-w-[40px] rounded-t"
              style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0, background: 'var(--series-1)', opacity: hover === null || hover === i ? 1 : 0.6 }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-[2px]">
        {data.map((d) => (
          <span key={d.label} className="flex-1 truncate text-center text-[10px] text-muted">{d.label}</span>
        ))}
      </div>
    </figure>
  );
}

export type Stack = { label: string; a: number; b: number };

export function StackedColumns({ data, aLabel, bLabel, height = 160 }: { data: Stack[]; aLabel: string; bLabel: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.a + d.b));
  return (
    <figure className="space-y-2">
      <div className="flex gap-4 text-xs text-text">
        {[['--series-1', aLabel], ['--series-2', bLabel]].map(([v, l]) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: `var(${v})` }} /> {l}
          </span>
        ))}
      </div>
      <div className="flex items-end gap-[2px] border-b border-border" style={{ height }}>
        {data.map((d, i) => (
          <div key={d.label} className="relative flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {hover === i && <Tip text={`${d.label}: ${d.a} ${aLabel.toLowerCase()}, ${d.b} ${bLabel.toLowerCase()}`} />}
            <span className="mb-0.5 text-center text-xs tabular-nums text-text">{d.a + d.b}</span>
            <div className="mx-auto flex w-full max-w-[48px] flex-col gap-[2px]" style={{ height: `${((d.a + d.b) / max) * 100}%` }}>
              {d.b > 0 && <div className="rounded-t" style={{ flex: d.b, background: 'var(--series-2)' }} />}
              {d.a > 0 && <div className={d.b > 0 ? '' : 'rounded-t'} style={{ flex: d.a, background: 'var(--series-1)' }} />}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-[2px]">
        {data.map((d) => (
          <span key={d.label} className="flex-1 truncate text-center text-[10px] text-muted">{d.label}</span>
        ))}
      </div>
    </figure>
  );
}

/** A funnel reads best as horizontal bars against the first step. */
export function FunnelBars({ steps }: { steps: { label: string; value: number }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ul className="space-y-1.5">
      {steps.map((s) => (
        <li key={s.label} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-sm text-text">
          <span className="truncate">{s.label}</span>
          <span className="h-3 rounded-r bg-surface">
            <span className="block h-3 rounded-r" style={{ width: `${(s.value / max) * 100}%`, background: 'var(--series-1)' }} />
          </span>
          <span className="text-right tabular-nums">{s.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums text-text">{value}</dd>
      {note && <dd className="text-xs text-text">{note}</dd>}
    </div>
  );
}

export const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
