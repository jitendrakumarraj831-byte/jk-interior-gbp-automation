import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'JK Interior — Google Business Profile Automation',
    template: '%s · JK Interior GBP',
  },
  description:
    'Admin console for JK Interior: Google reviews, AI reply drafts with manual approval, Business Profile posts and performance.',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      {
        url:
          'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="%234f46e5"/><text x="16" y="21" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="white" text-anchor="middle">JK</text></svg>',
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
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
