import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { clientIp, createRateLimiter, isBotSubmit } from '@/lib/academy/intake';
import { ageBand, isAnswersObject, pickKnownAnswers, screenSafety, validateU21Intake, type U21Answers } from '@/lib/u21/intake';

export const dynamic = 'force-dynamic';

// Public endpoint. No mail, no push, no plan: it records the submit as
// pending_review. The (draft) red flags are stored for the admin only — the
// response is identical for flagged and unflagged submits.
const allowFromIp = createRateLimiter(10, 60_000);

export async function POST(request: Request) {
  try {
    if (!allowFromIp(clientIp(request.headers))) {
      return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    // A filled honeypot gets the same "received" a person would, and nothing is stored.
    if (isBotSubmit(body)) return NextResponse.json({ ok: true, status: 'pending_review' });

    if (!isAnswersObject(body.answers)) return NextResponse.json({ error: 'validation', errors: { answers: 'ערך לא תקין' } }, { status: 400 });
    const answers: U21Answers = body.answers;
    const v = validateU21Intake(body.track, answers);
    if (!v.ok || v.age === null) return NextResponse.json({ error: 'validation', errors: v.errors }, { status: 400 });

    const clean = pickKnownAnswers(answers, v.age);
    const safety = screenSafety(clean);
    const band = ageBand(v.age);
    const minor = band === '16-17';

    const supabase = createServerClient();
    const { error } = await supabase.from('u21_registrations').insert({
      track: body.track,
      first_name: String(clean.firstName),
      last_name: String(clean.lastName),
      email: String(clean.email).toLowerCase(),
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
    });
    if (error) {
      // Logged here only: a DB message names tables/columns/constraints and never leaves the server.
      console.error('u21 register insert failed', error);
      return NextResponse.json({ error: 'Could not save' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, status: 'pending_review' });
  } catch (error) {
    console.error('u21 register failed', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
