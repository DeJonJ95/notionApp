'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

const DEFAULT_ZOOM = 0.7;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.5;
const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

// Starts at 70% and keeps zooming out as the map outgrows its window, until the person zooms by hand.
// A left-to-right timeline only fits its height and scrolls sideways, so cards stay readable.
export function useAutoZoom(box: RefObject<HTMLElement>, width: number, height: number, across = false) {
  const [fit, setFit] = useState(DEFAULT_ZOOM);
  const [manual, setManual] = useState<number | null>(null);
  const size = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      size.current = { w: el.clientWidth, h: el.clientHeight };
      const room = across ? size.current.h / height : Math.min(size.current.w / width, size.current.h / height);
      setFit(Math.max(MIN_ZOOM, Math.min(DEFAULT_ZOOM, Math.floor(room * 20) / 20)));
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [box, width, height, across]);

  const zoom = manual ?? fit;
  const current = useRef(zoom);
  current.current = zoom;
  useWheelZoom(box, current, setManual, across);
  return {
    zoom,
    auto: manual === null,
    step: (d: number) => setManual(clamp(Math.round((zoom + d) * 10) / 10)),
    reset: () => setManual(null),
  };
}

// Ctrl/Cmd + wheel (and a trackpad pinch, which browsers report as ctrl+wheel) zooms around the pointer; a plain wheel still scrolls.
function useWheelZoom(box: RefObject<HTMLElement>, current: { current: number }, set: (z: number) => void, across: boolean) {
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        // A timeline with nothing to scroll vertically turns an ordinary mouse wheel into sideways scrolling.
        if (across && !e.shiftKey && e.deltaX === 0 && el.scrollHeight <= el.clientHeight) { e.preventDefault(); el.scrollLeft += e.deltaY; }
        return;
      }
      e.preventDefault();
      const from = current.current;
      const to = clamp(from * Math.exp(-e.deltaY * 0.01));
      const r = el.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      const cx = (el.scrollLeft + ox) / from, cy = (el.scrollTop + oy) / from;
      current.current = to;
      set(to);
      requestAnimationFrame(() => { el.scrollLeft = cx * to - ox; el.scrollTop = cy * to - oy; });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [box, current, set, across]);
}
