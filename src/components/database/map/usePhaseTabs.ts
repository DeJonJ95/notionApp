'use client';

import { useMemo, useState } from 'react';
import { laneTabs, type MapDb, type MapProp, type MapProps } from './mapModel';

export const ALL_PHASES = '__all__';

// Phase maps open on the first phase that still has unfinished work; other maps have no tabs.
export function usePhaseTabs(db: MapDb, props: MapProps, showArchived: boolean, setValue: (pageId: string, prop: MapProp, value: unknown) => void) {
  const isPhased = Boolean(props.lane && /phase/i.test(props.lane.name));
  const tabs = useMemo(() => (isPhased ? laneTabs(db, props, showArchived) : []), [db, props, showArchived, isPhased]);
  const [picked, setPicked] = useState<string | null>(null);
  const current = tabs.find((t) => t.done < t.total)?.name ?? tabs[0]?.name ?? null;
  const active = picked === ALL_PHASES || (picked && tabs.some((t) => t.name === picked)) ? picked : current;
  const only = active && active !== ALL_PHASES ? active : null;
  return {
    tabs,
    active,
    only,
    pick: setPicked,
    // A card created while a phase tab is open belongs to that phase.
    stamp: (pageId: string) => { if (only && props.lane) setValue(pageId, props.lane, only); },
  };
}
