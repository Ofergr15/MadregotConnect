'use client';

import { notFound } from 'next/navigation';
import { israelToday } from '@/lib/utils';
import { buildDispatchReport, slotKey, type DeliveryRow, type DispatchAthlete } from '@/lib/academy/dispatch';
import { DispatchList } from '@/components/academy/WatchDispatch';

// ── Login-free preview of "did the week reach the watches?" ──────────────────
//
// The fixture goes through the REAL `buildDispatchReport`, so the order and every
// verdict below are the shipped ones. That is the only way a preview of a ranked
// list is worth auditing — a row in the wrong place here is a bug and not a
// fixture typo, and the states this screen must never confuse (`blind` vs
// `no_run`) are decided by the same code that decides them in production.
//
// Deterministic on purpose, like every other preview in this directory: fixtures
// built from `Date.now()` at module scope are evaluated once on the server and
// again in the browser, and the resulting hydration mismatch makes React throw out
// the whole tree — which cost a debugging session on `/preview/academy-thread`.
// Here the dates are counted back from the Israel calendar day, and the only
// clock-shaped values are the two ISO timestamps, both anchored the same way.
//
// Development only. In production the route does not exist.

const DAY = 24 * 3_600_000;

/** A date `daysAgo` before the Israel calendar day, as `YYYY-MM-DD`. */
function day(daysAgo: number): string {
  return israelToday(new Date(Date.parse(israelToday()) - daysAgo * DAY));
}

/** An Israel wall-clock time on that day. `+03:00` is IDT — see academy-thread. */
function at(daysAgo: number, hhmm: string): string {
  return new Date(`${day(daysAgo)}T${hhmm}:00+03:00`).toISOString();
}

// Every state the screen can render, one athlete each, deliberately given in the
// WRONG order so the sort is doing visible work.
const ATHLETES: DispatchAthlete[] = [
  { id: 'ran', name: 'Dor Alon', connection: 'ok' },
  { id: 'blind', name: 'Tal Regev', connection: 'failed' },
  { id: 'freestyle', name: 'Noa Ben Ari', connection: 'ok' },
  { id: 'failed', name: 'Uri Gal', connection: 'ok' },
  { id: 'quiet', name: 'Yuval Shapira', connection: 'ok' },
  { id: 'pending', name: 'Avi Barak', connection: 'ok' },
  { id: 'ahead', name: 'Tamar Gold', connection: 'ok' },
  { id: 'stale', name: 'Ronen Levi', connection: 'stale' },
  { id: 'garmin_down', name: 'Maya Kfir', connection: 'ok' },
];

const SENT = at(4, '21:04');

const DELIVERIES: DeliveryRow[] = [
  // Proven on a device: a run came back carrying the workout's id.
  { athlete_id: 'ran', workout_date: day(2), status: 'success', created_at: SENT, device_confirmed_at: at(2, '06:20') },
  // The credential is dead, so their runs are not reaching us. `no_run` here would
  // accuse someone who may have run it perfectly — this must read `blind`.
  { athlete_id: 'blind', workout_date: day(2), status: 'success', created_at: SENT },
  // Ran that day, but started the run themselves: the structure never reached them.
  { athlete_id: 'freestyle', workout_date: day(2), status: 'success', created_at: SENT },
  // Garmin's own words, verbatim — the sentence that tells the coach to ask for a
  // reconnect rather than to re-push.
  { athlete_id: 'failed', workout_date: day(2), status: 'failed', created_at: SENT, error_message: 'No Garmin auth token' },
  // The OTHER kind of failure, and the reason the row now states a verdict instead of only
  // quoting Garmin. Same red chip, same "לא נשלח", opposite action: this one is fixed by
  // pressing the button again, and the athlete is told nothing because there is nothing they
  // could do. Both sentences have to be on this screen or only one of them is ever reviewed.
  { athlete_id: 'garmin_down', workout_date: day(2), status: 'failed', created_at: SENT, error_message: 'Request failed with status code 503' },
  // Nothing came back, and we CAN see this athlete's runs. The honest empty case.
  { athlete_id: 'quiet', workout_date: day(2), status: 'success', created_at: SENT },
  // Garmin issued an id and the batch was never verified on the account.
  { athlete_id: 'pending', workout_date: day(2), status: 'pending', created_at: SENT, garmin_workout_id: '881' },
  // Tomorrow's session. There is no return trip to report yet, and the screen must
  // not imply one — this is the gap the mockup's "confirmed on watch" column hid.
  { athlete_id: 'ahead', workout_date: day(-1), status: 'success', created_at: SENT },
  // A fortnight with nothing synced is the same blindness as a refused credential.
  { athlete_id: 'stale', workout_date: day(2), status: 'success', created_at: SENT },
  // Two rows for one slot: the failure came first and the re-push succeeded. The
  // slot must read as delivered, or the coach re-pushes what is already there.
  { athlete_id: 'freestyle', workout_date: day(3), status: 'failed', created_at: at(5, '20:10'), error_message: 'timeout' },
  { athlete_id: 'freestyle', workout_date: day(3), status: 'success', created_at: at(5, '20:41'), device_confirmed_at: at(3, '06:02') },
];

// Only the days a run was actually recorded — the one input separating "ran it
// freestyle" from "did not run".
const ACTIVITY_DAYS = new Set([
  slotKey('ran', day(2)),
  slotKey('freestyle', day(2)),
  slotKey('freestyle', day(3)),
  // Recorded for the blind athlete too, and deliberately: in production we would
  // never see it. It is here to prove `blind` wins over the activity lookup rather
  // than quietly reporting `ran_freestyle` off a feed we cannot actually read.
  slotKey('blind', day(2)),
]);

export default function AcademyDispatchPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  const report = buildDispatchReport({
    athletes: ATHLETES,
    deliveries: DELIVERIES,
    activityDays: ACTIVITY_DAYS,
    // A slot the plan asked for and nobody ever pushed.
    expected: new Map([['quiet', [day(5)]]]),
    today: israelToday(),
  });

  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-md space-y-4">
        <div>
          <h1 className="text-xl font-bold text-ink-900">שליחה לשעונים</h1>
          <p className="text-xs text-ink-400">תצוגה מקדימה · נתוני דמה</p>
        </div>
        <DispatchList report={report} />
      </div>
    </div>
  );
}
