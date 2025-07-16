import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Kove',
  description: 'Kove — your private workspace for notes, databases, and budgeting.',
  manifest: '/manifest.json',
  // Tell iOS specifically to use this icon when the user picks "Add to
  // Home Screen". Without it iOS uses a generic screenshot, which looks
  // sloppy on the home grid. Same image is also referenced from
  // manifest.json's icons array for Android.
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Kove',
  },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  // Browser zoom disabled — the canvas has its own pinch-zoom and buttons
  // (browser zoom would only scale UI chrome, not reveal canvas content).
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
