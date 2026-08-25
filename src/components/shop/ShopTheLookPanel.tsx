'use client';

import { useState, useEffect, useMemo } from 'react';
import { ShoppingBag, ExternalLink, ChevronDown, ChevronUp, Loader2, AlertCircle } from 'lucide-react';

type ShopItem = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  shopUrl: string | null;
  shopTitle: string | null;
  imageUrl: string;
};

type PageImage = {
  src: string;
  blockId: string;
};

type Props = {
  pageId: string;
  images?: PageImage[];
};

export function ShopTheLookPanel({ pageId, images = [] }: Props) {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(true);
  // Which image is currently being analyzed, by src. One at a time —
  // the vision call is slow and the free tier is rate-limited.
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState('');
  // Gemini returns 503 under load. That is worth another click, so keep the
  // failed image around and label the button as a retry instead of a fresh run.
  const [retryable, setRetryable] = useState(false);
  // Images analyzed this session that legitimately came back empty, so we
  // can say "nothing found" instead of silently re-offering the button.
  const [emptyResults, setEmptyResults] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/clipper/shop-the-look?pageId=${encodeURIComponent(pageId)}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error ?? `Failed to load items (${r.status})`);
        }
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setItems(data.items ?? []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  // Group stored items by the image they were detected in.
  const itemsByImage = useMemo(() => {
    const map = new Map<string, ShopItem[]>();
    for (const item of items) {
      const list = map.get(item.imageUrl) ?? [];
      list.push(item);
      map.set(item.imageUrl, list);
    }
    return map;
  }, [items]);

  async function analyze(image: PageImage) {
    setAnalyzing(image.src);
    setAnalyzeError('');
    setRetryable(false);
    try {
      const res = await fetch('/api/clipper/shop-the-look', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, imageUrl: image.src, blockId: image.blockId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRetryable(Boolean(data.retryable) || res.status === 503);
        throw new Error(data.error ?? `Analysis failed (${res.status})`);
      }
      const found: ShopItem[] = data.items ?? [];
      if (found.length === 0) {
        setEmptyResults((prev) => [...prev, image.src]);
      } else {
        setItems((prev) => [...prev, ...found]);
      }
    } catch (e: any) {
      setAnalyzeError(e.message);
    } finally {
      setAnalyzing(null);
    }
  }

  // Nothing stored and no image to offer.
  if (!loading && items.length === 0 && images.length === 0 && !error) return null;

  const totalItems = items.length;
  const onPage = new Set(images.map((i) => i.src));
  const orphans = items.filter((i) => !onPage.has(i.imageUrl));

  function renderItem(item: ShopItem) {
    return (
      <li key={item.id} className="flex items-start justify-between gap-3 py-1">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text truncate">{item.name}</p>
          {item.description && <p className="text-xs text-muted mt-0.5">{item.description}</p>}
        </div>
        {item.shopUrl ? (
          <a
            href={item.shopUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 flex items-center gap-1 text-xs text-accent hover:underline"
          >
            <ExternalLink size={12} />
            Shop
          </a>
        ) : (
          <span className="shrink-0 text-xs text-muted">No link</span>
        )}
      </li>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden my-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ShoppingBag size={16} className="text-accent" />
          <span className="text-sm font-medium">
            {totalItems > 0 ? `Shop This Look (${totalItems})` : 'Shop This Look'}
          </span>
        </div>
        {open ? (
          <ChevronUp size={16} className="text-muted" />
        ) : (
          <ChevronDown size={16} className="text-muted" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted py-3">
              <Loader2 size={14} className="animate-spin" />
              Loading items…
            </div>
          )}

          {error && <p className="text-xs text-red-500 py-2">{error}</p>}

          {analyzeError && (
            <div
              className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 my-2 border ${
                retryable
                  ? 'text-muted bg-bg border-border'
                  : 'text-red-500 bg-red-500/10 border-red-500/20'
              }`}
            >
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              {analyzeError}
            </div>
          )}

          {!loading && images.length === 0 && totalItems === 0 && !error && (
            <p className="text-sm text-muted py-3 text-center">
              No images on this note yet. Clip one to shop it.
            </p>
          )}

          {/* One section per image on the page */}
          {!loading &&
            images.map((image) => {
              const found = itemsByImage.get(image.src) ?? [];
              const isAnalyzing = analyzing === image.src;
              const cameBackEmpty = emptyResults.includes(image.src);

              return (
                <div key={image.src} className="py-3 border-b border-border last:border-0">
                  <div className="flex items-start gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.src}
                      alt=""
                      className="w-16 h-16 rounded-lg object-cover border border-border shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      {found.length > 0 ? (
                        <p className="text-xs text-muted mb-2">
                          {found.length} item{found.length === 1 ? '' : 's'} found
                        </p>
                      ) : cameBackEmpty ? (
                        <p className="text-xs text-muted mb-2">
                          No identifiable products in this image.
                        </p>
                      ) : (
                        <button
                          onClick={() => analyze(image)}
                          disabled={analyzing !== null}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg hover:bg-surface text-xs font-medium disabled:opacity-50"
                        >
                          {isAnalyzing ? (
                            <>
                              <Loader2 size={12} className="animate-spin text-accent" />
                              <span className="text-muted">Analyzing image…</span>
                            </>
                          ) : (
                            <>
                              <ShoppingBag size={12} className="text-accent" />
                              <span>{retryable ? 'Try again' : 'Shop This Look'}</span>
                            </>
                          )}
                        </button>
                      )}

                      {found.length > 0 && <ul className="space-y-2">{found.map(renderItem)}</ul>}
                    </div>
                  </div>
                </div>
              );
            })}

          {/* Stored items whose image is no longer on the page */}
          {!loading && orphans.length > 0 && (
            <div className="pt-3">
              <p className="text-xs text-muted mb-2">From removed images</p>
              <ul className="space-y-2">{orphans.map(renderItem)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
