import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Madregot After 2KM Running Club',
  description: "Israel's leading running community. Redefining running culture since 2022.",
  openGraph: {
    title: 'Madregot After 2KM Running Club',
    description: "Israel's leading running community. Redefining running culture since 2022.",
    siteName: 'Madregot After 2KM',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
