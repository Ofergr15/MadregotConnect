'use client';

import { CrashScreen } from '@/components/CrashScreen';

/**
 * The last boundary: catches a throw in the ROOT LAYOUT itself, where nothing
 * else in the app is mounted — no locale provider, no fonts, no `<body>`. So this
 * file has to supply its own `<html>`/`<body>`, and `CrashScreen` is deliberately
 * built out of plain elements with hardcoded copy for exactly this case.
 *
 * `dir="rtl"` is hardcoded rather than read from the locale cookie: reading it
 * means calling into the i18n layer, which is one of the things that can be what
 * broke. Hebrew is the default locale, so this is right for almost everyone and
 * merely mirrored for the rest.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <CrashScreen error={error} retry={retry} scope="global" />
      </body>
    </html>
  );
}
