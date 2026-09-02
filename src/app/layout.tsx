import type { Metadata, Viewport } from 'next';
import { Inter, Heebo } from 'next/font/google';
import { SerwistProvider } from '@serwist/turbopack/react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Providers } from './providers';
import { AppSplash } from '@/components/AppSplash';
import { MaintenanceGate } from '@/components/MaintenanceGate';
import { ImpersonationBar } from '@/components/ImpersonationBar';
// UpdatePrompt intentionally unmounted for now — the "new version available"
// bubble was popping too often. Re-enable by restoring this import and the
// <UpdatePrompt /> line below; until then, users refresh manually after deploys.
// import { UpdatePrompt } from '@/components/UpdatePrompt';
import { DevIdentitySwitcher } from '@/components/DevIdentitySwitcher';
import { DevServiceWorkerCleanup } from '@/components/DevServiceWorkerCleanup';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo' });

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom left enabled (no maximumScale/userScalable) — disabling it is a
  // WCAG 1.4.4 failure and blocks low-vision users.
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
        <SerwistProvider
          swUrl="/serwist/sw.js"
          disable={process.env.NODE_ENV === 'development'}
        >
          <NextIntlClientProvider locale={locale} messages={messages} key={locale}>
            <Providers>{children}</Providers>
          </NextIntlClientProvider>
        </SerwistProvider>
        {process.env.NODE_ENV === 'development' && <DevServiceWorkerCleanup />}
        <AppSplash />
        <MaintenanceGate />
        <ImpersonationBar />
        {/* <UpdatePrompt /> — disabled, see note on the import above */}
        <DevIdentitySwitcher />
        <SpeedInsights />
      </body>
    </html>
  );
}
