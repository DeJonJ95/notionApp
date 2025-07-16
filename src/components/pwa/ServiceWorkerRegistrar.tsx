'use client';
import { useEffect } from 'react';

/**
 * Registers /sw.js on mount. Required for iOS Safari to treat the PWA
 * as installable and reliably honor the manifest's share_target field.
 * iOS technically honors share_target without an SW in some cases, but
 * an installed PWA without a controlling service worker is treated as
 * a "bookmark-quality" shortcut and share_target registration is flaky.
 *
 * No UI; lives at the root so it runs exactly once per session.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    // Defer registration past first paint so it doesn't compete with
    // the rest of the bundle for main-thread cycles on cold start.
    const id = setTimeout(() => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          // SW registration failure is non-fatal: the app still works
          // online, just won't be installable/share-target-ready.
          console.warn('Service worker registration failed:', err);
        });
    }, 0);
    return () => clearTimeout(id);
  }, []);
  return null;
}
