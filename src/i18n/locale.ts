'use server';

import { cookies } from 'next/headers';

const LOCALE_COOKIE = 'NEXT_LOCALE';

export async function getLocaleFromCookie(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore.get(LOCALE_COOKIE)?.value || 'he';
}

export async function setLocale(locale: string) {
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}
