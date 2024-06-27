'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Clock, FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface SearchResult {
  id: string;
  title: string;
  icon: string;
  workspaceName: string;
  databaseId: string | null;
  matchType: 'title' | 'content' | 'recent';
}

interface SearchModalProps {
  onClose: () => void;
}

export function SearchModal({ onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    inputRef.current?.focus();
    // Load recent pages on open
    fetchResults('');
  }, []);

  const fetchResults = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results ?? []);
      setSelected(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchResults(query), 150);
    return () => clearTimeout(timer);
  }, [query, fetchResults]);

  const navigate = useCallback(
    (result: SearchResult) => {
      router.push(`/page/${result.id}`);
      onClose();
    },
    [router, onClose]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selected]) navigate(results[selected]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const isEmpty = query.trim() === '' && results.length === 0 && !loading;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={17} className="text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages…"
            className="flex-1 bg-transparent text-text outline-none placeholder:text-muted text-sm"
          />
          {loading && (
            <span className="text-xs text-muted animate-pulse shrink-0">Searching…</span>
          )}
          <button
            onClick={onClose}
            className="text-muted hover:text-text transition-colors shrink-0"
            aria-label="Close search"
          >
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {results.length > 0 ? (
            <>
              {!query && (
                <div className="px-4 pt-3 pb-1 flex items-center gap-1.5 text-xs text-muted uppercase tracking-wide font-medium">
                  <Clock size={11} /> Recent
                </div>
              )}
              {results.map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => navigate(r)}
                  onMouseEnter={() => setSelected(i)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === selected ? 'bg-surface' : 'hover:bg-surface/60'
                  }`}
                >
                  <span className="text-xl shrink-0 leading-none">{r.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text font-medium truncate">{r.title}</div>
                    <div className="text-xs text-muted truncate">{r.workspaceName}</div>
                  </div>
                  {r.matchType === 'content' && (
                    <span className="text-xs text-muted shrink-0 flex items-center gap-1">
                      <FileText size={11} /> content
                    </span>
                  )}
                </button>
              ))}
            </>
          ) : query.trim() && !loading ? (
            <div className="px-4 py-10 text-center text-sm text-muted">
              No results for <span className="text-text font-medium">"{query}"</span>
            </div>
          ) : isEmpty ? (
            <div className="px-4 py-10 text-center text-sm text-muted">
              Type to search pages
            </div>
          ) : null}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border flex gap-4 text-xs text-muted">
          <span><kbd className="font-mono bg-surface border border-border rounded px-1">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono bg-surface border border-border rounded px-1">↵</kbd> open</span>
          <span><kbd className="font-mono bg-surface border border-border rounded px-1">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
