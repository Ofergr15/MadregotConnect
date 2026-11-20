import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { assertU21ServerEnv } from '@/lib/u21/env-guard';
import { clientIp, createRateLimiter, isBotSubmit } from '@/lib/academy/intake';
import {
  U21_MAX_PER_EMAIL_PER_HOUR, isMissingDedupeColumn, isDedupeConflict, recentSubmits, serializeByKey, u21DedupeKey,
} from '@/lib/u21/register-guard';
import { ageBand, isAnswersObject, pickKnownAnswers, screenSafety, validateU21Intake, type U21Answers } from '@/lib/u21/intake';

export const dynamic = 'force-dynamic';

// Public endpoint. No mail, no push, no plan: it records the submit as
// pending_review. The (draft) red flags are stored for the admin only — the
// response is identical for flagged and unflagged submits.
const allowFromIp = createRateLimiter(10, 60_000);

const RECEIVED = { ok: true, status: 'pending_review' } as const;

export async function POST(request: Request) {
  try {
    // Before rate limit, auth or any DB access: refuse unless wired to the approved dev project.
    const guard = assertU21ServerEnv();
    if (guard.denied) return guard.denied;
    if (!allowFromIp(clientIp(request.headers))) {
      return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    // A filled honeypot gets the same "received" a person would, and nothing is stored.
    if (isBotSubmit(body)) return NextResponse.json(RECEIVED);

    if (!isAnswersObject(body.answers)) return NextResponse.json({ error: 'validation', errors: { answers: 'ערך לא תקין' } }, { status: 400 });
    const answers: U21Answers = body.answers;
    const v = validateU21Intake(body.track, answers);
    if (!v.ok || v.age === null) return NextResponse.json({ error: 'validation', errors: v.errors }, { status: 400 });

    const clean = pickKnownAnswers(answers, v.age);
    const safety = screenSafety(clean);
    const band = ageBand(v.age);
    const minor = band === '16-17';

    const supabase = createServerClient();
    const email = String(clean.email).toLowerCase();
    const track: string = body.track;
    const row = {
      track,
      first_name: String(clean.firstName),
      last_name: String(clean.lastName),
      email,
      phone: String(clean.phone),
      birth_date: String(clean.birthDate),
      age_band: band,
      framework: typeof clean.framework === 'string' ? clean.framework : null,
      guardian_name: minor ? String(clean.guardianName) : null,
      guardian_phone: minor ? String(clean.guardianPhone) : null,
      guardian_consent: minor ? clean.guardianConsent === true : false,
      flag_chest_pain: safety.flags.chest_pain,
      flag_fainting: safety.flags.fainting,
      flag_bone_pain: safety.flags.bone_pain,
      flag_acute_injury: safety.flags.acute_injury,
      red_flag: safety.flagged,
      intake: clean,
      status: 'pending_review',
    };
    // Same email + track on this instance: one at a time, so a double tap's second request
    // reads the first one's row instead of racing it (see lib/u21/register-guard).
    const error = await serializeByKey(`${email}|${track}`, async () => {
      // A double tap, a retry, a "did it go?" re-send: the same email + track inside the window is
      // the same registration. Past the per-email hourly cap: stored nothing. Both answer exactly
      // as for the first (nothing to tell apart, nothing to enumerate). Best effort: a failed
      // read falls through to the insert.
      const recent = await recentSubmits(supabase, email, track);
      if (recent && (recent.sameTrackRecent || recent.lastHour >= U21_MAX_PER_EMAIL_PER_HOUR)) return null;
      let { error } = await supabase.from('u21_registrations').insert({ ...row, dedupe_key: u21DedupeKey(email, track) });
      // Migration 183 not pasted yet: store without the key, as before.
      if (error && isMissingDedupeColumn(error)) ({ error } = await supabase.from('u21_registrations').insert(row));
      // A concurrent identical submit on another instance won the unique index: same registration.
      if (error && isDedupeConflict(error)) return null;
      return error;
    });
    if (error) {
      // Logged here only: a DB message names tables/columns/constraints and never leaves the server.
      console.error('u21 register insert failed', error);
      return NextResponse.json({ error: 'Could not save' }, { status: 500 });
    }
    return NextResponse.json(RECEIVED);
  } catch (error) {
    console.error('u21 register failed', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
