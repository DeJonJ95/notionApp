'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/components/ui/feedback';
import { saveValue, savePositions } from './mapApi';
import type { MapDb, MapNode, MapProp, Point } from './mapModel';
import { spotApplies, type Saved } from './mapLayout';

type Overrides = Record<string, { pageId: string; propertyId: string; value: unknown }>;

function readPositions(grouping: unknown): Record<string, Saved> {
  const raw = grouping && typeof grouping === 'object' ? (grouping as { positions?: unknown }).positions : null;
  return raw && typeof raw === 'object' ? { ...(raw as Record<string, Saved>) } : {};
}

export function useValueEdits(db: MapDb, onChanged: () => void) {
  const [overrides, setOverrides] = useState<Overrides>({});
  const pending = useRef(0);

  useEffect(() => {
    if (pending.current === 0) setOverrides({});
  }, [db]);

  const merged = useMemo<MapDb>(() => {
    const list = Object.values(overrides);
    if (!list.length) return db;
    const pages = db.pages.map((p) => {
      const mine = list.filter((o) => o.pageId === p.id);
      if (!mine.length) return p;
      const kept = p.properties.filter((pv) => !mine.some((o) => o.propertyId === pv.property.id));
      return { ...p, properties: [...kept, ...mine.map((o) => ({ property: { id: o.propertyId }, value: o.value }))] };
    });
    return { ...db, pages };
  }, [db, overrides]);

  const setValue = (pageId: string, prop: MapProp, value: unknown) => {
    const key = `${pageId}|${prop.id}`;
    setOverrides((o) => ({ ...o, [key]: { pageId, propertyId: prop.id, value } }));
    pending.current += 1;
    saveValue(pageId, prop.id, value)
      .catch(() => {
        toast.error('Couldn’t save that change. Reverted.');
        setOverrides((o) => { const { [key]: _drop, ...rest } = o; return rest; });
      })
      .finally(() => { pending.current -= 1; onChanged(); });
  };

  return { merged, setValue };
}

export function usePositions(dbId: string, viewId: string, grouping: unknown) {
  const [positions, setPositions] = useState<Record<string, Saved>>(() => readPositions(grouping));
  const latest = useRef(positions);
  const busy = useRef(0);
  const dragging = useRef(false);
  const serverJson = JSON.stringify(readPositions(grouping));
  // A refetch that lands mid-drag or before the PATCH would snap nodes back to stale positions.
  useEffect(() => { if (busy.current === 0 && !dragging.current) setPositions(JSON.parse(serverJson)); }, [viewId, serverJson]);
  useEffect(() => { latest.current = positions; }, [positions]);

  const persist = (next: Record<string, Saved>) => {
    setPositions(next);
    latest.current = next;
    busy.current += 1;
    savePositions(dbId, viewId, next)
      .catch(() => toast.error('Couldn’t save the layout.'))
      .finally(() => { busy.current -= 1; });
  };

  return {
    positions,
    handPlaced: Object.values(positions).filter((p) => !p.auto).length,
    move: (id: string, at: Saved) => { dragging.current = true; setPositions((p) => ({ ...p, [id]: at })); },
    commit: () => { dragging.current = false; persist(latest.current); },
    unpin: (id: string) => { const { [id]: _drop, ...rest } = positions; persist(rest); },
    tidy: () => persist({}),
    // An auto-placed card that gains a dependency re-flows to the right of it instead of staying put.
    release: (id: string) => { if (latest.current[id]?.auto) { const { [id]: _drop, ...rest } = latest.current; persist(rest); } },
    // Remembers where auto-placed cards landed so later additions can't move them.
    freeze: (spots: Record<string, Saved>) => { if (!dragging.current) persist({ ...latest.current, ...spots }); },
  };
}

export function useFrozenLayout(nodes: MapNode[], layout: ReturnType<typeof usePositions>) {
  useEffect(() => {
    const fresh = nodes.filter((n) => !spotApplies(layout.positions[n.id], n.lane));
    if (!fresh.length) return;
    layout.freeze(Object.fromEntries(fresh.map((n) => [n.id, { x: n.at.x - n.laneOrigin.x, y: n.at.y - n.laneOrigin.y, auto: true, lane: n.lane }])));
  }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps
}

type SetValue = (pageId: string, prop: MapProp, value: unknown) => void;

// Writing a Waits on value also lets an auto-placed card re-flow next to what it now waits on.
export function linkAware(setValue: SetValue, waitsOn: MapProp | undefined, release: (id: string) => void): SetValue {
  return (pageId, prop, value) => {
    setValue(pageId, prop, value);
    if (prop.id === waitsOn?.id) release(pageId);
  };
}
