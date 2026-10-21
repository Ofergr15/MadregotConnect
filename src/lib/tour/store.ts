'use client';

import { useSyncExternalStore } from 'react';
import { IDLE, tourReducer, type TourAction, type TourState } from './engine';
import { TOURS } from './coach-tour';
import { startPractice, stopPractice } from './practice';

// One tour at a time, app-wide: the overlay (TourOverlay, mounted in providers) draws it,
// and the screens it walks through read it — the day planner opens on the text box and
// fakes its send while practice is on. Kept outside React so a route change (home → the
// trainee's week) does not lose the step.

let state: TourState = IDLE;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function getTour(): TourState { return state; }

export function dispatchTour(action: TourAction): void {
  const tourId = action.type === 'OFFER' || action.type === 'START' ? action.tour : state.tour;
  const next = tourReducer(state, action, tourId ? TOURS[tourId] ?? null : null);
  if (next === state) return;
  state = next;
  // The practice guard is on for as long as the coach is inside the steps or the closing sheet.
  if (state.phase === 'step' || state.phase === 'closing') startPractice();
  else stopPractice();
  emit();
}

export function subscribeTour(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useTour(): TourState {
  return useSyncExternalStore(subscribeTour, getTour, () => IDLE);
}

/** True while a tour's practice run is on — the planner reads it. */
export function useTourPractice(): boolean {
  const s = useTour();
  return s.phase === 'step' || s.phase === 'closing';
}

/** Reset — tests only. */
export function __resetTour(): void { state = IDLE; stopPractice(); emit(); }

export const TOUR_FILL_EVENT = 'mc:tour-fill-sample';
export const TOUR_REPLAY_EVENT = 'mc:tour-replay';
