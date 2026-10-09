'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

const DEFAULT_ZOOM = 0.7;
const MIN_ZOOM = 0.4;

// Starts at 70% and keeps zooming out as the map outgrows its window, until the person zooms by hand.
export function useAutoZoom(box: RefObject<HTMLElement>, width: number, height: number) {
  const [fit, setFit] = useState(DEFAULT_ZOOM);
  const [manual, setManual] = useState<number | null>(null);
  const size = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      size.current = { w: el.clientWidth, h: el.clientHeight };
      const room = Math.min(size.current.w / width, size.current.h / height);
      setFit(Math.max(MIN_ZOOM, Math.min(DEFAULT_ZOOM, Math.floor(room * 20) / 20)));
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [box, width, height]);

  const zoom = manual ?? fit;
  return {
    zoom,
    auto: manual === null,
    step: (d: number) => setManual(Math.min(1.5, Math.max(MIN_ZOOM, Math.round((zoom + d) * 10) / 10))),
    reset: () => setManual(null),
  };
}
