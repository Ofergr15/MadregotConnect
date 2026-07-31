import type { Metadata, Viewport } from 'next';
import { Inter, Heebo } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { AppSplash } from '@/components/AppSplash';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo' });

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
  // Next's appleWebApp only emits the (now-deprecated) apple- prefixed tag;
  // add the standard one so Chrome/Android stops warning.
  other: {
    'mobile-web-app-capable': 'yes',
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
    apple: [{ url: '/images/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === 'he' ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir}>
      <body className={`${heebo.variable} ${inter.variable} font-sans`}>
        <NextIntlClientProvider locale={locale} messages={messages} key={locale}>
          {children}
        </NextIntlClientProvider>
        <AppSplash />
      </body>
    </html>
  );
}
