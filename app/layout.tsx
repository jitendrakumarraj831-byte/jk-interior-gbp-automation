import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

/**
 * Inter, self-hosted at build time by next/font — no request leaves the
 * browser to a font CDN, and there is no layout shift on first paint.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'JK Interior — Google Business Profile Automation',
    template: '%s · JK Interior',
  },
  description:
    'Admin console for JK Interior: Google reviews, AI reply drafts with manual approval, Business Profile posts and performance.',
  applicationName: 'JK Interior GBP Automation',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      {
        url:
          'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="%234338ca"/><text x="16" y="21" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="white" text-anchor="middle">JK</text></svg>',
          ),
        type: 'image/svg+xml',
      },
    ],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
