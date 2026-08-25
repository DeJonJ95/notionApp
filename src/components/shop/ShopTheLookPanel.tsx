'use client';

import { useState, useEffect } from 'react';
import { ShoppingBag, ExternalLink, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

type ShopItem = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  shopUrl: string | null;
  shopTitle: string | null;
};

type Props = {
  pageId: string;
};

export function ShopTheLookPanel({ pageId }: Props) {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(true);

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
    return () => { cancelled = true; };
  }, [pageId]);

  // Nothing to show if empty and not loading
  if (!loading && items.length === 0 && !error) return null;

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden my-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ShoppingBag size={16} className="text-accent" />
          <span className="text-sm font-medium">
            {items.length > 0 ? `Shop This Look (${items.length})` : 'Shop This Look'}
          </span>
        </div>
        {open ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
      </button>

      {open && (
        <div className="px-4 pb-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted py-3">
              <Loader2 size={14} className="animate-spin" />
              Loading items…
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 py-2">{error}</p>
          )}

          {items.length > 0 && (
            <ul className="space-y-2 pt-1">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text truncate">{item.name}</p>
                    {item.description && (
                      <p className="text-xs text-muted mt-0.5">{item.description}</p>
                    )}
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
              ))}
            </ul>
          )}

          {!loading && items.length === 0 && !error && (
            <p className="text-sm text-muted py-3 text-center">No items found.</p>
          )}
        </div>
      )}
    </div>
  );
}
