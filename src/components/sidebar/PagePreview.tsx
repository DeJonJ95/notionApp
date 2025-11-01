'use client';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

type PreviewData = {
  title: string;
  icon: string | null;
  snippet: string;
  firstImage: string | null;
  updatedAt: string;
};

type Props = {
  pageId: string | null;
  anchor: DOMRect | null;
};

// Per-page preview cache so opening the same hover twice doesn't re-fetch.
// Module-level so it survives unmounts (sidebar tree rerenders a lot).
const cache = new Map<string, PreviewData>();

export function PagePreview({ pageId, anchor }: Props) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  // Track the in-flight pageId so an unmount or quick hover-swap doesn't
  // commit stale results from a previous request.
  const inflightRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pageId) {
      setData(null);
      setLoading(false);
      return;
    }
    const cached = cache.get(pageId);
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }
    inflightRef.current = pageId;
    setLoading(true);
    setData(null);
    fetch(`/api/pages/${pageId}/preview`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PreviewData | null) => {
        if (inflightRef.current !== pageId) return; // user hovered something else
        if (d) {
          cache.set(pageId, d);
          setData(d);
        }
      })
      .catch(() => { /* ignore — show nothing */ })
      .finally(() => {
        if (inflightRef.current === pageId) setLoading(false);
      });
  }, [pageId]);

  if (typeof document === 'undefined' || !pageId || !anchor) return null;

  // Position the card to the right of the hovered item. If that would
  // overflow the viewport, flip to below. If both would overflow, fall
  // back to right-aligned but inset from the edge so it's still visible.
  const PREVIEW_W = 280;
  const PREVIEW_MAX_H = 220;
  const GAP = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor.right + GAP;
  let top = anchor.top;
  if (left + PREVIEW_W > vw - 8) {
    // Not enough room on the right — drop it below the item
    left = Math.min(anchor.left, vw - PREVIEW_W - 8);
    top = anchor.bottom + GAP;
  }
  // Don't run off the bottom — clamp upward
  if (top + PREVIEW_MAX_H > vh - 8) {
    top = Math.max(8, vh - PREVIEW_MAX_H - 8);
  }

  return createPortal(
    <div
      className="fixed z-[100] w-[280px] bg-surface border border-border rounded-lg shadow-xl overflow-hidden pointer-events-none"
      style={{ left, top, maxHeight: PREVIEW_MAX_H }}
      role="tooltip"
    >
      {loading && !data ? (
        <div className="p-3 text-xs text-muted">Loading…</div>
      ) : data ? (
        <>
          {data.firstImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.firstImage}
              alt=""
              className="w-full h-24 object-cover bg-bg"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <div className="p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-text mb-1.5">
              <span>{data.icon ?? '📄'}</span>
              <span className="truncate">{data.title}</span>
            </div>
            {data.snippet ? (
              <p className="text-xs text-muted whitespace-pre-line line-clamp-6 leading-relaxed">
                {data.snippet}
              </p>
            ) : (
              <p className="text-xs text-muted italic">Empty note</p>
            )}
          </div>
        </>
      ) : (
        <div className="p-3 text-xs text-muted">Preview unavailable</div>
      )}
    </div>,
    document.body
  );
}
