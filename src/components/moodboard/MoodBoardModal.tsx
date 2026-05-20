'use client';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Download, Plus, Loader2, AlertCircle, Sparkles, Check } from 'lucide-react';
import type { MoodBoardPhoto } from '@/app/api/moodboard/search/route';

type Props = {
  onClose: () => void;
  // Insert one or more saved-to-R2 image URLs into the host (e.g. TipTap editor).
  onInsert?: (images: { url: string; alt: string }[]) => void;
};

type Status = 'idle' | 'loading' | 'error';

function providerLabel(id: string): string {
  if (id === 'unsplash') return 'Unsplash';
  if (id === 'pexels') return 'Pexels';
  if (id === 'openverse') return 'OpenVerse';
  if (id === 'europeana') return 'Europeana';
  if (id === 'tumblr') return 'Tumblr';
  if (id === 'google') return 'Google';
  if (id === 'met') return 'The Met Museum';
  return id;
}

export function MoodBoardModal({ onClose, onInsert }: Props) {
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState('');
  const [photos, setPhotos] = useState<MoodBoardPhoto[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Photos currently being saved (download to phone OR insert to note),
  // keyed by `${photoId}:${action}` so two actions on the same photo don't collide.
  const [working, setWorking] = useState<Set<string>>(new Set());
  // Pagination state — we stick to one provider until it runs out of
  // relevant content for this query, then hop to a new one. This stops
  // results from drifting off-topic after a few Load Mores.
  const [currentProvider, setCurrentProvider] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [exhausted, setExhausted] = useState<Set<string>>(new Set());
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The "smooth transition": before the first successful search, the search
  // input is centered with a hero label above it. Once results land,
  // `hasSearched` flips to true and the layout collapses to a compact header.
  const hasSearched = photos.length > 0 || currentPage > 0;

  // Show Load More until every available provider has been exhausted for
  // this query. Each provider exhausts independently as we page through it.
  const allProvidersExhausted =
    availableProviders.length > 0 && availableProviders.every((p) => exhausted.has(p));
  const canLoadMore = !allProvidersExhausted && currentProvider != null;

  useEffect(() => { setMounted(true); setTimeout(() => inputRef.current?.focus(), 80); }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  // Single fetch helper. Caller decides the params; this just executes
  // and updates the result-side state (photos + provider + exhausted).
  async function fetchPage(opts: {
    q: string;
    page: number;
    provider?: string;     // sticky provider for Load More
    exclude?: string[];    // providers to skip on fallthrough
    append: boolean;       // append to grid (Load More) vs replace (new search)
  }): Promise<{ provider: string | null; exhausted: boolean } | null> {
    setStatus('loading');
    setError('');
    try {
      const url = new URL('/api/moodboard/search', window.location.origin);
      url.searchParams.set('q', opts.q.trim());
      url.searchParams.set('page', String(opts.page));
      if (opts.provider) url.searchParams.set('provider', opts.provider);
      if (opts.exclude?.length) url.searchParams.set('exclude', opts.exclude.join(','));
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Search failed');
      setPhotos((prev) => (opts.append ? [...prev, ...data.results] : data.results));
      if (data.availableProviders) setAvailableProviders(data.availableProviders);
      setStatus('idle');
      return { provider: data.provider ?? null, exhausted: !!data.exhausted };
    } catch (e: any) {
      setError(e.message);
      setStatus('error');
      return null;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    // Reset everything — new query = fresh round-robin pick, fresh exhausted set
    setSelected(new Set());
    setExhausted(new Set());
    setCurrentProvider(null);
    setCurrentPage(0);
    setPhotos([]);
    const result = await fetchPage({ q: query, page: 1, append: false });
    if (!result?.provider) return;
    setCurrentProvider(result.provider);
    setCurrentPage(1);
    if (result.exhausted) setExhausted(new Set([result.provider]));
  }

  async function loadMore() {
    if (!currentProvider) return;
    const currentExhausted = exhausted.has(currentProvider);

    if (!currentExhausted) {
      // Stay on the current provider — fetch its next page directly.
      const nextPage = currentPage + 1;
      const result = await fetchPage({
        q: query,
        page: nextPage,
        provider: currentProvider,
        append: true,
      });
      if (!result?.provider) return;
      // The server might have fallen through to another provider if the
      // requested page came back too thin. Detect and switch state.
      if (result.provider !== currentProvider) {
        setExhausted((prev) => new Set([...prev, currentProvider]));
        setCurrentProvider(result.provider);
        setCurrentPage(1);
      } else {
        setCurrentPage(nextPage);
      }
      if (result.exhausted) {
        setExhausted((prev) => new Set([...prev, result.provider!]));
      }
    } else {
      // Current provider is done. Ask the server for a fresh one,
      // excluding everything we've already burned.
      const excludeList = [...exhausted, currentProvider];
      const result = await fetchPage({
        q: query,
        page: 1,
        exclude: excludeList,
        append: true,
      });
      if (!result?.provider) {
        // No provider could satisfy — mark every available one exhausted
        // so the Load More button hides and we don't loop.
        setExhausted(new Set(availableProviders));
        return;
      }
      setCurrentProvider(result.provider);
      setCurrentPage(1);
      if (result.exhausted) {
        setExhausted((prev) => new Set([...prev, result.provider!]));
      }
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const markWorking = (photoId: string, action: 'phone' | 'note', on: boolean) =>
    setWorking((prev) => {
      const k = `${photoId}:${action}`;
      const next = new Set(prev);
      on ? next.add(k) : next.delete(k);
      return next;
    });
  const isWorking = (photoId: string, action: 'phone' | 'note') =>
    working.has(`${photoId}:${action}`);

  // Save to phone: fetch the bytes client-side so we can use <a download>.
  // Unsplash's CDN sets permissive CORS for image responses, so this just works.
  async function saveToPhone(photo: MoodBoardPhoto) {
    markWorking(photo.id, 'phone', true);
    try {
      const res = await fetch(photo.regular);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `unsplash-${photo.id}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after the click — Chrome/Safari finish reading the blob synchronously.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Fall back to opening the image in a new tab (mobile long-press to save)
      window.open(photo.regular, '_blank');
    } finally {
      markWorking(photo.id, 'phone', false);
    }
  }

  // Insert into note: copy bytes to our R2 first, then hand the public URL up.
  async function insertSelected() {
    if (selected.size === 0 || !onInsert) return;
    const picked = photos.filter((p) => selected.has(p.id));
    const saved: { url: string; alt: string }[] = [];
    // Process serially so one slow upload doesn't fan out N concurrent fetches.
    for (const p of picked) {
      markWorking(p.id, 'note', true);
      try {
        const res = await fetch('/api/moodboard/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            photoId: p.id,
            sourceUrl: p.regular,
            downloadEndpoint: p.downloadEndpoint,
            alt: p.alt,
          }),
        });
        if (!res.ok) throw new Error('Save failed');
        const data = await res.json();
        saved.push({ url: data.url, alt: data.alt ?? '' });
      } catch {
        // Skip this image; keep going so the user gets whatever did work.
      } finally {
        markWorking(p.id, 'note', false);
      }
    }
    if (saved.length > 0) onInsert(saved);
    onClose();
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[6vh] bg-black/50 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-5xl mx-4 overflow-hidden flex flex-col max-h-[88vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent" />
            <h2 className="font-semibold text-sm">Create mood board</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg text-muted hover:text-text transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search section — animates from hero to compact when results land */}
        <div
          className={`px-5 border-b border-border transition-all duration-500 ease-out ${
            hasSearched ? 'py-3' : 'py-12'
          }`}
        >
          <div
            className={`mx-auto transition-all duration-500 ease-out ${
              hasSearched ? 'max-w-xl' : 'max-w-md'
            }`}
          >
            <p
              className={`text-center text-muted text-sm mb-3 transition-all duration-500 overflow-hidden ${
                hasSearched ? 'h-0 mb-0 opacity-0' : 'h-auto opacity-100'
              }`}
            >
              What aesthetic are you going for?
            </p>
            <form onSubmit={handleSubmit} className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="mid-century modern, brutalism, japanese minimalism…"
                className="w-full pl-10 pr-24 py-2.5 rounded-lg border border-border bg-bg text-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              <button
                type="submit"
                disabled={!query.trim() || status === 'loading'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {status === 'loading' && currentPage <= 1 ? 'Searching…' : 'Search'}
              </button>
            </form>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-5 mt-3 flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Results grid — 5 columns on md+, fewer on small screens */}
        <div className={`flex-1 overflow-y-auto px-3 py-3 transition-opacity duration-500 ${hasSearched ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          {photos.length === 0 && status === 'idle' && !error && (
            <p className="text-center text-muted text-sm py-12">
              Type something above and hit Search.
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {photos.map((p) => {
              const isSelected = selected.has(p.id);
              return (
                <div
                  key={p.id}
                  className={`relative group rounded-lg overflow-hidden border-2 transition-all duration-200 ${
                    isSelected ? 'border-accent shadow-lg shadow-accent/20' : 'border-transparent'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSelected(p.id)}
                    className="block w-full aspect-square bg-bg"
                    aria-label={isSelected ? 'Deselect image' : 'Select image'}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.thumb}
                      alt={p.alt || 'mood-board image'}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </button>

                  {/* Selected checkmark */}
                  {isSelected && (
                    <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center shadow-md pointer-events-none">
                      <Check size={14} />
                    </div>
                  )}

                  {/* Action overlay — visible on hover or always on touch */}
                  <div className="absolute inset-x-0 bottom-0 p-1.5 flex items-end justify-between gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity bg-gradient-to-t from-black/70 to-transparent pt-6">
                    <a
                      href={p.attribution.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] text-white/90 hover:text-white truncate"
                      title={`${p.attribution.name} — ${providerLabel(p.provider)}`}
                    >
                      {p.attribution.name}
                    </a>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); saveToPhone(p); }}
                      disabled={isWorking(p.id, 'phone')}
                      className="p-1.5 rounded bg-white/90 hover:bg-white text-text disabled:opacity-50 transition-colors"
                      title="Save to your device"
                    >
                      {isWorking(p.id, 'phone') ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Download size={12} />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Load more — visible until every provider has been exhausted */}
          {photos.length > 0 && canLoadMore && (
            <div className="flex justify-center py-4">
              <button
                onClick={loadMore}
                disabled={status === 'loading'}
                className="flex items-center gap-2 px-4 py-1.5 rounded-lg border border-border text-sm text-text hover:bg-bg disabled:opacity-50 transition-colors"
              >
                {status === 'loading' ? <Loader2 size={13} className="animate-spin" /> : null}
                {currentProvider && exhausted.has(currentProvider) ? 'Load more from another source' : 'Load more'}
              </button>
            </div>
          )}
        </div>

        {/* Footer — only visible once we have results */}
        {hasSearched && (
          <div className="border-t border-border px-5 py-3 flex items-center justify-between gap-3 shrink-0">
            <p className="text-xs text-muted">
              {selected.size > 0
                ? `${selected.size} selected`
                : 'Click an image to select it'}
              {currentProvider && (
                <span className="ml-2 opacity-70">· via {providerLabel(currentProvider)}</span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg border border-border transition-colors"
              >
                Cancel
              </button>
              {onInsert && (
                <button
                  onClick={insertSelected}
                  disabled={selected.size === 0 || working.size > 0}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity font-medium"
                >
                  {working.size > 0 ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Plus size={13} />
                  )}
                  Add to note
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
