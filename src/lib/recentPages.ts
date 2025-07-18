'use client';

// Tracks the user's most-recently-visited pages in localStorage so the
// sidebar can surface them above Favorites. Per-browser, per-device —
// not synced server-side. That's fine for the "I was just on this 30
// seconds ago" use case; sync would add network round trips and
// auth complexity for marginal benefit.

import { useEffect, useState } from 'react';

const KEY = 'kove:recent-pages';
const MAX = 10;                       // how many to remember; sidebar shows the top 3
const EVENT_NAME = 'kove:recent-pages-updated';

export type RecentPage = {
  id: string;
  title: string;
  icon: string | null;
};

export function getRecentPages(): RecentPage[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((p) => p && typeof p.id === 'string') : [];
  } catch {
    return [];
  }
}

export function pushRecentPage(page: RecentPage) {
  try {
    const current = getRecentPages();
    // Move-to-front + dedupe by id, then trim
    const next = [page, ...current.filter((p) => p.id !== page.id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
    // Notify same-tab subscribers — the `storage` event only fires
    // cross-tab, but we want the sidebar to update immediately when
    // the user navigates inside the current tab.
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {
    /* private mode / SSR — ignore */
  }
}

export function forgetRecentPage(id: string) {
  try {
    const next = getRecentPages().filter((p) => p.id !== id);
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {
    /* */
  }
}

/** Live list of recent pages — re-renders when the list changes
 *  in this tab or any other tab. */
export function useRecentPages(): RecentPage[] {
  const [pages, setPages] = useState<RecentPage[]>([]);
  useEffect(() => {
    const update = () => setPages(getRecentPages());
    update();
    window.addEventListener(EVENT_NAME, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(EVENT_NAME, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return pages;
}
