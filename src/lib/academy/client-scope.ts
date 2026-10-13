'use client';

/**
 * The staff shell's "coach view" narrowing, for every academy read under it (launch N19).
 *
 * A manager in their coach view saw only their own trainees on בית/אנשים (those reads
 * carried `?scope=coach`), but the whole academy in שיחות, שעונים, טסטים, the queue,
 * ביצוע and the book's roster — each of those components builds its own URL. AcademyShell
 * sets this once per render, before its children render, and those URLs go through
 * `scoped()`. Rendering only: the server still decides what a session may read, and the
 * parameter can only ever narrow a manager (lib/academy/pairing-server visibleTraineeIds).
 */
let coachScope = false;

export function setAcademyCoachScope(on: boolean): void {
  coachScope = on;
}

export function academyCoachScope(): boolean {
  return coachScope;
}

/** `url` with `scope=coach` added while the shell is in a coach-scoped view. */
export function scoped(url: string, on: boolean = coachScope): string {
  if (!on || /[?&]scope=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}scope=coach`;
}
