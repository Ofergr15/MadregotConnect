import type { ThreadSeat } from '@/components/academy/ThreadTranscript';

/**
 * Who is talking, at a glance (Ofer, 2026-10-19, academy-dash.html): every seat has ONE
 * colour, everywhere in the academy's conversations — the ring around the avatar, the
 * name and its role word, and the bubble's tint and edge.
 *
 *   coach    always green
 *   trainee  always purple (the academy's colour)
 *   manager  always amber
 *
 * The seat comes from the author's relation to the thread (lib/academy/thread.ts seatFor),
 * never from a name: Ofer is the trainee in his own thread and the manager in everyone else's.
 */
export const SEAT_STYLE: Record<ThreadSeat, { ink: string; bg: string; word: string }> = {
  coach: { ink: '#16A34A', bg: '#E8F7EE', word: 'מאמן' },
  trainee: { ink: '#7C3AED', bg: '#F3EEFF', word: 'מתאמן' },
  manager: { ink: '#D97706', bg: '#FFF4E2', word: 'מנהל' },
};

/** The legend's order: the two people the thread is about, then the one who watches over it. */
export const SEAT_ORDER: ThreadSeat[] = ['coach', 'trainee', 'manager'];

/** Two initials for an avatar: "Shahar Glazner" → "SG", "שחר" → "ש". */
export function seatInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();
}
