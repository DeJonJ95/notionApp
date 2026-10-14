'use client';
import { useCallback, useState } from 'react';

function errorOf(d: unknown): string | null {
  return d && typeof d === 'object' && 'error' in d && typeof d.error === 'string' ? d.error : null;
}

/** POST JSON to an ApplyKit route; throws an Error carrying the server's message. */
export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let d: unknown;
  try {
    d = await r.json();
  } catch {
    throw new Error(r.status === 504 ? 'The server timed out. Try again shortly.' : 'Unexpected server response');
  }
  if (!r.ok) throw new Error(errorOf(d) ?? 'Request failed');
  return d as T;
}

export const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export const fileUrl = (key: string | null | undefined) =>
  key ? `/api/files/download?key=${encodeURIComponent(key)}` : null;

// Filesystem-safe slug for downloaded filenames.
export const slug = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'resume';

/** Copy to the clipboard and flag success for 1.5s. A blocked clipboard fails quietly; the text stays selectable. */
export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  }, []);
  return [copied, copy];
}
