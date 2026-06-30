import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#4338ff',
};

export const metadata: Metadata = {
  title: 'Madregot After 2KM',
  description: "Israel's leading running community. Redefining running culture since 2022.",
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Madregot',
  },
  openGraph: {
    title: 'Madregot After 2KM',
    description: "Israel's leading running community. Redefining running culture since 2022.",
    siteName: 'Madregot After 2KM',
  },
  icons: {
    icon: [
      { url: '/images/favicon.png', sizes: '256x256', type: 'image/png' },
    ],
    apple: '/images/favicon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
