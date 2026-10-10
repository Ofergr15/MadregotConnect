'use client';

import { useEffect, useState } from 'react';
import { isComputer } from '@/lib/install/platform';

/**
 * Is this a computer (lib/install/platform isComputer)? `false` on the server and
 * on the first client render, then the real answer: every screen that asks
 * renders its phone version first, which is also the safe default.
 */
export function useIsComputer(): boolean {
  const [computer, setComputer] = useState(false);
  useEffect(() => { setComputer(isComputer()); }, []);
  return computer;
}
