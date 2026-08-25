'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Check, AlertCircle, Loader2, ArrowLeft, ImageOff, ShoppingBag, ExternalLink } from 'lucide-react';

type Page = {
  id: string;
  title: string;
  icon: string;
  workspaceName: string;
  updatedAt: string;
};

type ShopItem = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  shopUrl: string | null;
  shopTitle: string | null;
};

type Props = {
  initialUrl: string;
  initialTitle: string;
  /** Pre-resolved image URL (set when the POST share-target already
   *  uploaded the shared file to R2). Skips og:image resolution. */
  initialImageUrl?: string;
};

// Mobile-first picker shown when the user shares to Kove from another
// app. Mirrors the desktop extension's picker UX (image preview +
// searchable note list) but built as React + Tailwind to fit the app's
// styling, since this lives inside the notes app itself rather than
// being injected into a third-party page.
export function ShareReceiver({ initialUrl, initialTitle, initialImageUrl = '' }: Props) {
  const router = useRouter();

  // ── Image-resolution state ─────────────────────────────────────
  // If the share-target already uploaded the file to R2 we get a ready
  // image URL and skip resolution entirely.
  const [imageUrl, setImageUrl] = useState<string>(initialImageUrl);
  const [resolving, setResolving] = useState(!initialImageUrl);
  const [resolveError, setResolveError] = useState('');
  const [overrideUrl, setOverrideUrl] = useState(initialImageUrl || initialUrl); // editable fallback

  // ── Note picker state ──────────────────────────────────────────
  const [pages, setPages] = useState<Page[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  const [pagesError, setPagesError] = useState('');
  const [query, setQuery] = useState('');

  // ── Save state ─────────────────────────────────────────────────
  const [savingPageId, setSavingPageId] = useState<string | null>(null);
  const [savedPage, setSavedPage] = useState<Page | null>(null);
  const [savedImage, setSavedImage] = useState<{ url: string; blockId: string | null } | null>(null);
  const [saveError, setSaveError] = useState('');

  // ── Shop-the-look state ────────────────────────────────────────
  const [shopLoading, setShopLoading] = useState(false);
  const [shopItems, setShopItems] = useState<ShopItem[]>([]);
  const [shopError, setShopError] = useState('');
  const [shopDone, setShopDone] = useState(false);

  // Resolve the shared URL into an actual image URL via the server.
  useEffect(() => {
    // Already have a resolved image (uploaded file via POST share-target).
    if (initialImageUrl) {
      setResolving(false);
      return;
    }
    if (!initialUrl) {
      setResolving(false);
      setResolveError('No image or URL was shared. Paste an image URL below or go back.');
      return;
    }
    setResolving(true);
    setResolveError('');
    fetch(`/api/clipper/extract-image?url=${encodeURIComponent(initialUrl)}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error ?? `Couldn't resolve the image (${r.status})`);
        }
        return r.json();
      })
      .then((data) => {
        setImageUrl(data.imageUrl);
      })
      .catch((e) => {
        setResolveError(e.message);
      })
      .finally(() => setResolving(false));
  }, [initialUrl, initialImageUrl]);

  // Load the user's recent notes for the picker. Uses session auth
  // automatically since we're hitting our own origin with cookies.
  useEffect(() => {
    fetch('/api/clipper/pages')
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load notes (${r.status})`);
        return r.json();
      })
      .then((data) => setPages(data.pages || []))
      .catch((e) => setPagesError(e.message))
      .finally(() => setPagesLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p) => p.title.toLowerCase().includes(q));
  }, [pages, query]);

  async function saveTo(page: Page) {
    if (!imageUrl) return;
    setSavingPageId(page.id);
    setSaveError('');
    try {
      const res = await fetch('/api/clipper/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId: page.id,
          sourceUrl: imageUrl,
          alt: initialTitle,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? `Save failed (${res.status})`);
      }
      // Keep the stored copy, not the shared source URL. Most CDNs block
      // hotlinked server-side fetches, so analyzing sourceUrl fails.
      setSavedImage({ url: data.publicUrl ?? imageUrl, blockId: data.blockId ?? null });
      setSavedPage(page);
    } catch (e: any) {
      setSaveError(e.message);
      setSavingPageId(null);
    }
  }

  function tryOverride() {
    setImageUrl('');
    setResolveError('');
    setResolving(true);
    // Re-run the resolver against the (possibly edited) override URL.
    fetch(`/api/clipper/extract-image?url=${encodeURIComponent(overrideUrl)}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error ?? `Couldn't resolve the image (${r.status})`);
        }
        return r.json();
      })
      .then((data) => setImageUrl(data.imageUrl))
      .catch((e) => setResolveError(e.message))
      .finally(() => setResolving(false));
  }

  async function shopThisLook() {
    if (!savedPage || !savedImage) return;
    setShopLoading(true);
    setShopError('');
    try {
      const res = await fetch('/api/clipper/shop-the-look', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId: savedPage.id,
          imageUrl: savedImage.url,
          blockId: savedImage.blockId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? `Analysis failed (${res.status})`);
      }
      setShopItems(data.items ?? []);
      setShopDone(true);
    } catch (e: any) {
      setShopError(e.message);
    } finally {
      setShopLoading(false);
    }
  }

  // ── Success view ───────────────────────────────────────────────
  if (savedPage) {
    return (
      <div className="max-w-md mx-auto px-4 py-8 space-y-5">
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-6 text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-green-500/15 flex items-center justify-center">
            <Check size={22} className="text-green-600" />
          </div>
          <div>
            <p className="font-semibold text-text">Saved to &quot;{savedPage.title}&quot;</p>
            <p className="text-xs text-muted mt-1">The image is on the note&apos;s canvas.</p>
          </div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => router.push(`/page/${savedPage.id}`)}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90"
            >
              Open note
            </button>
            <button
              onClick={() => {
                setSavedPage(null);
                setSavedImage(null);
                setSavingPageId(null);
                setShopItems([]);
                setShopDone(false);
                setShopError('');
              }}
              className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-bg"
            >
              Save another
            </button>
          </div>
        </div>

        {/* Shop This Look action */}
        {!shopDone && (
          <button
            onClick={shopThisLook}
            disabled={shopLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-border bg-surface hover:bg-bg text-sm font-medium disabled:opacity-50"
          >
            {shopLoading ? (
              <>
                <Loader2 size={16} className="animate-spin text-accent" />
                <span className="text-muted">Analyzing image for items…</span>
              </>
            ) : (
              <>
                <ShoppingBag size={16} className="text-accent" />
                <span>Shop This Look</span>
              </>
            )}
          </button>
        )}

        {shopError && (
          <div className="m-3 flex items-start gap-2 text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            {shopError}
          </div>
        )}

        {/* Shop results */}
        {shopItems.length > 0 && (
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <ShoppingBag size={16} className="text-accent" />
              <span className="text-sm font-medium">Items found</span>
            </div>
            <ul className="divide-y divide-border">
              {shopItems.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-text">{item.name}</p>
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
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {shopDone && shopItems.length === 0 && (
          <p className="text-xs text-muted text-center">
            No identifiable products found. The image may be too abstract or not a product photo.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded hover:bg-bg text-muted"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold">Save to a note</h1>
      </div>

      {/* Image preview */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="aspect-square bg-bg flex items-center justify-center relative">
          {resolving ? (
            <div className="text-muted text-sm flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Resolving image…
            </div>
          ) : imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={initialTitle}
              className="w-full h-full object-contain bg-bg"
              onError={() => setResolveError('Image failed to load. Try a different URL below.')}
            />
          ) : (
            <div className="text-muted text-sm flex items-center gap-2">
              <ImageOff size={14} /> No image
            </div>
          )}
        </div>
        {/* Override / edit URL row — only shown when resolve failed or user wants to swap */}
        {(resolveError || !imageUrl) && (
          <div className="p-3 border-t border-border space-y-2">
            {resolveError && (
              <div className="flex items-start gap-2 text-xs text-red-500">
                <AlertCircle size={12} className="mt-0.5" />
                <span>{resolveError}</span>
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={overrideUrl}
                onChange={(e) => setOverrideUrl(e.target.value)}
                placeholder="Paste an image or page URL"
                className="flex-1 px-2 py-1.5 rounded border border-border bg-bg text-xs focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              <button
                onClick={tryOverride}
                disabled={!overrideUrl.trim() || resolving}
                className="px-3 py-1.5 rounded bg-accent text-white text-xs font-medium disabled:opacity-50"
              >
                Try
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Note picker */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="p-3 border-b border-border relative">
          <Search
            size={14}
            className="absolute left-5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recent notes…"
            className="w-full pl-7 pr-2 py-1.5 rounded border border-border bg-bg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>

        {saveError && (
          <div className="m-3 flex items-start gap-2 text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            {saveError}
          </div>
        )}

        {pagesLoading ? (
          <p className="text-sm text-muted text-center py-6">Loading notes…</p>
        ) : pagesError ? (
          <p className="text-sm text-red-500 text-center py-6">{pagesError}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">No notes match.</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto py-1">
            {filtered.map((p) => {
              const saving = savingPageId === p.id;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => saveTo(p)}
                    disabled={!imageUrl || saving || savingPageId !== null}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-bg disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    <span className="w-5 text-center shrink-0">{p.icon}</span>
                    <span className="flex-1 truncate">{p.title}</span>
                    {p.workspaceName && (
                      <span className="text-xs text-muted shrink-0">{p.workspaceName}</span>
                    )}
                    {saving && <Loader2 size={14} className="animate-spin text-muted shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted text-center">
        Recent 30 notes shown · {initialUrl && <span className="block sm:inline">Source: {new URL(initialUrl).hostname}</span>}
      </p>
    </div>
  );
}
