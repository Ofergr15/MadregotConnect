'use client';

import { useEffect, useState } from 'react';

/**
 * True once `loading` has stayed true for `ms` without a break. Pair with
 * <LoadError> so a screen whose data never arrives offers "נסה שוב" instead of an
 * endless skeleton. Resets the moment loading stops, or when `resetKey` changes
 * (bump it on retry).
 */
export function useLoadTimeout(loading: boolean, ms = 15_000, resetKey: unknown = 0): boolean {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false);
    if (!loading) return;
    const t = setTimeout(() => setTimedOut(true), ms);
    return () => clearTimeout(t);
  }, [loading, ms, resetKey]);
  return loading && timedOut;
}
