// The guided tour's state machine — pure, so the steps' rules are tested without a DOM
// (Ofer, 2026-10-21, mockups/coach-intro/v2.html). A tour is an opening sheet, numbered
// steps and a closing sheet. Two kinds of step:
//
//   - "see": the spotlight and a bubble; the bubble's "הבא" moves on.
//   - "do":  the spotlight pulses on a real control and the bubble has no "הבא" — the
//            tour moves on ONLY when that control itself is tapped (TARGET_TAPPED with the
//            step's own target). A tap anywhere else, or a NEXT, is ignored.
//
// Skipping is always one tap away, from any phase.

export type StepKind = 'see' | 'do';

export interface TourStep {
  id: string;
  kind: StepKind;
  /** The `data-tour` value of the element the step lights up; "a|b" = the first of them on screen. */
  target: string;
  title: string;
  body: string;
  /** "see" steps: the bubble's button (default "הבא"). */
  next?: string;
}

export interface TourSheet {
  emoji: string;
  title: string;
  body: string;
  /** Short lines under the text (the opening's three promises, the closing's three things to remember). */
  points: string[];
  note?: string;
  cta: string;
  /** The quiet line under the button ("אחר כך…", "לחזור לסיור…"). */
  secondary: string;
}

export interface TourDef {
  id: string;
  /** "סיור מאמן" — the progress bar's name. */
  name: string;
  opening: TourSheet;
  closing: TourSheet;
  steps: TourStep[];
}

export type TourPhase = 'idle' | 'opening' | 'step' | 'closing' | 'done';
export type TourEnd = 'done' | 'later' | 'skipped';

export interface TourState {
  tour: string | null;
  phase: TourPhase;
  index: number;
  /** How it ended, once it has. */
  ended: TourEnd | null;
}

export type TourAction =
  | { type: 'OFFER'; tour: string }
  | { type: 'START'; tour: string }
  | { type: 'BEGIN' }
  | { type: 'LATER' }
  | { type: 'NEXT' }
  | { type: 'TARGET_TAPPED'; target: string }
  | { type: 'SKIP' }
  | { type: 'FINISH' };

export const IDLE: TourState = { tour: null, phase: 'idle', index: 0, ended: null };

export function tourReducer(state: TourState, action: TourAction, def: TourDef | null): TourState {
  switch (action.type) {
    case 'OFFER':
      return { tour: action.tour, phase: 'opening', index: 0, ended: null };
    case 'START':
      // A replay from "עוד": straight into step 1, no "now or later?" question.
      return { tour: action.tour, phase: 'step', index: 0, ended: null };
    case 'BEGIN':
      return state.phase === 'opening' ? { ...state, phase: 'step', index: 0 } : state;
    case 'LATER':
      return state.phase === 'opening' ? { ...state, phase: 'done', ended: 'later' } : state;
    case 'SKIP':
      return state.phase === 'idle' || state.phase === 'done' ? state : { ...state, phase: 'done', ended: 'skipped' };
    case 'FINISH':
      return state.phase === 'closing' ? { ...state, phase: 'done', ended: 'done' } : state;
    case 'NEXT':
    case 'TARGET_TAPPED': {
      if (state.phase !== 'step' || !def) return state;
      const step = def.steps[state.index];
      if (!step) return state;
      if (action.type === 'NEXT' && step.kind !== 'see') return state;
      if (action.type === 'TARGET_TAPPED' && (step.kind !== 'do' || !targetsOf(step).includes(action.target))) return state;
      const last = state.index >= def.steps.length - 1;
      return last ? { ...state, phase: 'closing' } : { ...state, index: state.index + 1 };
    }
  }
}

/** The step being shown, or null outside the steps. */
export function currentStep(state: TourState, def: TourDef | null): TourStep | null {
  return state.phase === 'step' && def ? def.steps[state.index] ?? null : null;
}

/** Whether a stored "seen" state means the tour should not be offered again. */
export function wasOffered(stored: string | null | undefined): boolean {
  return stored === 'done' || stored === 'later' || stored === 'skipped';
}

/** A step's target names, in the order they are looked for. */
export function targetsOf(step: TourStep): string[] {
  return step.target.split('|').map((t) => t.trim()).filter(Boolean);
}
