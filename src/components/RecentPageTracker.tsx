'use client';
import { useEffect } from 'react';
import { pushRecentPage } from '@/lib/recentPages';

/**
 * Mount inside a page-detail server component to record the visit
 * client-side. Has no UI; the sidebar reads the list via
 * useRecentPages(). Re-fires when any of the props change so renaming
 * a page or swapping its icon updates the recent-list entry too.
 */
export function RecentPageTracker({
  id,
  title,
  icon,
}: {
  id: string;
  title: string;
  icon: string | null;
}) {
  useEffect(() => {
    pushRecentPage({ id, title, icon });
  }, [id, title, icon]);
  return null;
}
