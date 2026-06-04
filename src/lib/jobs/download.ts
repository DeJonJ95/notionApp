// Trigger a file download without navigating the current page.
//
// The naive `<a href="/api/files/download?...">` navigates the window to the
// file. In the installed PWA (standalone display mode) there's no browser
// chrome, so a PDF/attachment response replaces the app with a viewer the user
// can't back out of — they have to force-quit. Fetching the bytes and saving
// them via a blob URL keeps the SPA on its current screen instead.
export async function downloadFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
