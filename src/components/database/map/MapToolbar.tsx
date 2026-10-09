'use client';

import Link from 'next/link';
import { STATUS_STYLE } from './mapModel';

const btn = 'min-h-[36px] px-3.5 rounded-lg border border-border bg-bg text-sm hover:bg-surface';

type Props = {
  onTidy?: () => void;
  onAdd: () => void;
  onCycle?: () => void;
  phase?: { exists: boolean; onAdd: () => void; onStart: () => void };
  archived: { count: number; shown: boolean; toggle: () => void };
  onAddWaitsOn?: () => void;
  noun: string;
  backHref?: string;
};

function Legend() {
  return (
    <div className="flex flex-wrap gap-3.5 text-xs flex-1">
      {(Object.keys(STATUS_STYLE) as (keyof typeof STATUS_STYLE)[]).map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px]" style={k === 'waiting' ? { border: `1px dashed ${STATUS_STYLE[k].color}` } : { background: STATUS_STYLE[k].color }} />
          {STATUS_STYLE[k].label}
        </span>
      ))}
    </div>
  );
}

export function MapToolbar({ onTidy, onAdd, onCycle, phase, archived, onAddWaitsOn, noun, backHref }: Props) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border">
        {backHref ? <Link href={backHref} className={btn + ' flex items-center'}>← All projects</Link> : null}
        <Legend />
        {archived.count > 0 ? (
          <label className="flex items-center gap-2 text-sm min-h-[36px]">
            <input type="checkbox" checked={archived.shown} onChange={archived.toggle} className="w-4 h-4" />
            Show archived ({archived.count})
          </label>
        ) : null}
        {onTidy ? <button type="button" onClick={onTidy} className={btn}>Tidy layout</button> : null}
        {onCycle ? <button type="button" onClick={onCycle} className={btn}>Start next cycle</button> : null}
        {phase && !phase.exists ? <button type="button" onClick={phase.onAdd} className={btn}>Group by phase</button> : null}
        {phase?.exists ? <button type="button" onClick={phase.onStart} className={btn}>Start new phase</button> : null}
        <button type="button" onClick={onAdd} className="min-h-[36px] px-3.5 rounded-lg bg-accent text-white text-sm font-semibold">New {noun}</button>
      </div>
      {onAddWaitsOn ? (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border bg-surface text-sm">
          <span className="flex-1">Arrows come from a “Waits on” relation that links {noun}s in this database to each other.</span>
          <button type="button" onClick={onAddWaitsOn} className={btn}>Add “Waits on”</button>
        </div>
      ) : null}
    </>
  );
}
