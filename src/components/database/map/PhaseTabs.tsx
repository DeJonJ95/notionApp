'use client';

import type { MapTab } from './mapModel';
import { ALL_PHASES } from './usePhaseTabs';

type Props = { tabs: MapTab[]; active: string | null; pick: (name: string) => void };

const tabCls = (on: boolean) =>
  `shrink-0 min-h-[40px] px-3.5 text-sm whitespace-nowrap border-b-2 ${on ? 'border-accent font-semibold' : 'border-transparent hover:bg-surface'}`;

export function PhaseTabs({ tabs, active, pick }: Props) {
  if (!tabs.length) return null;
  return (
    <div role="tablist" aria-label="Phases" className="flex gap-1 px-3 border-b border-border overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.name} type="button" role="tab" aria-selected={active === t.name} onClick={() => pick(t.name)} className={tabCls(active === t.name)}>
          {t.name} <span className="text-xs">{t.done}/{t.total}</span>
        </button>
      ))}
      <button type="button" role="tab" aria-selected={active === ALL_PHASES} onClick={() => pick(ALL_PHASES)} className={tabCls(active === ALL_PHASES)}>
        All
      </button>
    </div>
  );
}
