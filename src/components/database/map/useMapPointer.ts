'use client';

import { useRef, useState, type MouseEvent, type RefObject } from 'react';
import { edgePath, NODE_H, type MapModel, type MapProp, type Point } from './mapModel';

type Drag = { id: string; sx: number; sy: number; origin: Point; lane: Point; moved: boolean };

type Deps = {
  model: MapModel;
  zoom: number;
  plane: RefObject<HTMLDivElement>;
  waitsOn?: MapProp;
  setValue: (pageId: string, prop: MapProp, value: unknown) => void;
  select: (id: string) => void;
  layout: { move: (id: string, at: Point) => void; commit: () => void };
};

export function useMapPointer({ model, zoom, plane, waitsOn, setValue, select, layout }: Deps) {
  const [link, setLink] = useState<{ from: string; to: Point } | null>(null);
  const drag = useRef<Drag | null>(null);
  const justDragged = useRef(false);

  const toPlane = (e: MouseEvent): Point => {
    const r = plane.current?.getBoundingClientRect();
    return r ? { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom } : { x: 0, y: 0 };
  };

  const handlers = {
    onGrab: (id: string, e: MouseEvent) => {
      const node = model.nodes.find((n) => n.id === id);
      if (!node) return;
      justDragged.current = false;
      drag.current = { id, sx: e.clientX, sy: e.clientY, origin: node.at, lane: node.laneOrigin, moved: false };
    },
    onLinkStart: (id: string, e: MouseEvent) => { e.stopPropagation(); setLink({ from: id, to: toPlane(e) }); },
    onDrop: (id: string) => {
      const target = model.nodes.find((n) => n.id === id);
      if (!link || !target || !waitsOn || link.from === id || target.deps.includes(link.from)) return;
      setValue(id, waitsOn, [...target.deps, link.from]);
    },
    onPick: (id: string) => {
      if (justDragged.current) { justDragged.current = false; return; }
      select(id);
    },
  };

  const onMove = (e: MouseEvent) => {
    if (link) { setLink({ ...link, to: toPlane(e) }); return; }
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / zoom, dy = (e.clientY - d.sy) / zoom;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    d.moved = true;
    layout.move(d.id, { x: Math.round(d.origin.x + dx - d.lane.x), y: Math.round(d.origin.y + dy - d.lane.y) });
  };

  const onUp = () => {
    if (drag.current?.moved) { justDragged.current = true; layout.commit(); }
    drag.current = null;
    setLink(null);
  };

  const from = link ? model.nodes.find((n) => n.id === link.from) : null;
  const linkPath = from && link ? edgePath(from.at, { x: link.to.x + 4, y: link.to.y - NODE_H / 2 }) : null;

  return { handlers, onMove, onUp, linkPath };
}
