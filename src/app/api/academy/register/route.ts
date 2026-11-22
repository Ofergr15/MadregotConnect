import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { notifyAdminNewAcademyRegistration, notifyAcademyFormReceived } from '@/lib/email';
import { isTestAccount } from '@/lib/athletes/test-accounts';
import { formNameProblem, normalizeDisplayName } from '@/lib/names/latin';
import { clientIp, createRateLimiter, isBotSubmit, looksLikeToken } from '@/lib/academy/intake';
import { invitePrefill, recordFormCandidate } from '@/lib/academy/intake-server';
import { academyManagerIds, notifyStaff } from '@/lib/notifications/staff';
import { academyApplicantCopy } from '@/lib/notifications/copy';
import { likelyClubMember } from '@/lib/academy/link-server';
import { mayRegister } from '@/lib/academy/registration';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { isImportedIntake, mergeIntake } from '@/lib/academy/sheet-import';
import { acceptImported } from '@/lib/academy/sheet-import-server';
import { importProfileColumns } from '@/lib/academy/import-form';

export const dynamic = 'force-dynamic';


// Every submit mails the admin and the typed address, so a script hammering this
// public endpoint is a spam cannon. Five a minute from one address is more than a
// person correcting a typo ever needs. Best effort per instance: see intake.ts.
//
// Keyed on the address AND the email (launch N32): a club event shares one Wi-Fi, and the
// sixth applicant there got "Too many attempts". Five a minute per person stands; one
// address as a whole is capped much higher, which still stops a script.
const allowSubmit = createRateLimiter(5, 60_000);
const allowFromIp = createRateLimiter(40, 60_000);

/**
 * A second submit of the same card inside this window (a double tap, a browser retry, a
 * "did it go?" re-send) saves the details but mails nobody again: the trainee already has
 * the "קיבלנו" mail and staff already have the heads-up. 2026-11-18, אופיר חיון: two of each.
 */
export const FORM_RESEND_WINDOW_MS = 10 * 60_000;

/** Did this card's "received" mail already go out inside the window? Best effort: a failed read sends. */
async function receivedRecently(supabase: any, candidateId: string, now = Date.now()): Promise<boolean> {
  try {
    const since = new Date(now - FORM_RESEND_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from('email_log').select('id')
      .eq('candidate_id', candidateId).eq('template', 'academy_form_received')
      .gte('created_at', since).limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Claim this card's "received" mails + staff push, atomically: a conditional UPDATE that only
 * one request can win. Postgres takes the row lock for the UPDATE; a second, concurrent UPDATE
 * of the same row waits for the first to commit, then re-checks its WHERE against the new row
 * version (READ COMMITTED re-evaluation), finds form_mail_claimed_at already inside the window,
 * and updates — and returns — nothing. So exactly one caller gets a row back and sends.
 *
 * Needs migration 178 (form_mail_claimed_at, NOT applied yet). Until then, and on any other
 * failed write, it falls back to the email_log read above (best effort: a failed read sends).
 */
export async function claimFormMail(supabase: any, candidateId: string, now = Date.now()): Promise<boolean> {
  try {
    const since = new Date(now - FORM_RESEND_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from('academy_candidates')
      .update({ form_mail_claimed_at: new Date(now).toISOString() })
      .eq('id', candidateId)
      .or(`form_mail_claimed_at.is.null,form_mail_claimed_at.lt.${since}`)
      .select('id');
    if (!error && Array.isArray(data)) return data.length > 0;
    if (error && !isMissingColumn(error)) console.error('Academy register: mail claim failed:', error.message);
  } catch (err) {
    console.error('Academy register: mail claim threw:', err);
  }
  return !(await receivedRecently(supabase, candidateId, now));
}

/**
 * GET /api/academy/register?i={invite token} — the prefill for a personal link.
 * Name, email and phone of that one card, or `{ prefill: null }` for anything else
 * (unknown, stale, malformed): the form then simply opens empty.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('i');
  try {
    const prefill = await invitePrefill(createServerClient() as any, token);
    return NextResponse.json({ prefill });
  } catch {
    return NextResponse.json({ prefill: null });
  }
}

/**
 * POST /api/academy/register — public academy sign-up.
 * Body: { name, email, phone?, intake?, inviteToken?, src?, website? }
 * Creates an unapproved academy applicant, puts them on the funnel board with the
 * form step done (see recordFormCandidate), emails the coach to review and the
 * applicant to say it arrived. Staff accept from the funnel card, which mails a
 * link to /join/{token}.
 *
 * `website` is the honeypot (intake.ts): filled means a bot, answered like a success.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const ip = clientIp(request.headers);
    const who = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!allowFromIp(ip) || !allowSubmit(`${ip}|${who}`)) {
      return NextResponse.json({ error: 'Too many attempts, try again in a minute' }, { status: 429 });
    }

    // The manager's switch (lib/academy/registration.ts). A coach's personal
    // invitation (the token from the funnel) gets through a closed door.
    if (!(await mayRegister(createServerClient(), body?.inviteToken))) {
      return NextResponse.json(
        { error: 'Academy registration is currently closed.', message: 'ההרשמה לאקדמיה סגורה כרגע.' },
        { status: 403 }
      );
    }
    if (isBotSubmit(body)) return NextResponse.json({ success: true });
    const { name, email, phone, intake, inviteToken, src } = body || {};
    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }
    // Hebrew or English (formNameProblem): the Strava connection at /join puts the
    // Latin name on the roster later. Only a name with no letters at all is refused.
    if (formNameProblem(name)) {
      return NextResponse.json({ error: 'Please write your name', code: 'no-letters' }, { status: 400 });
    }
    const fullName = normalizeDisplayName(name);

    const supabase = createServerClient();
    const normEmail = email.toLowerCase().trim();

    // The row this form is FOR: a personal link's card names it (2026-10-19 — a trainee who
    // corrected the pre-filled email used to get a second pending account), else the row with
    // this email (re-registration), else none and one is inserted.
    const ATHLETE_COLS = 'id, approved, invite_token, onboarding_status, academy_intake';
    type Existing = { id: string; approved?: boolean | null; invite_token?: string | null; onboarding_status?: string | null; academy_intake?: unknown };
    let existing: Existing | null = null;
    // A card the academy's file opened (sheet-import): its form writes the profile columns too,
    // and its confirmation is the approval (acceptImported below).
    let imported = false;
    if (looksLikeToken(inviteToken)) {
      let { data: card, error: cardError }: { data: unknown; error: any } = await supabase.from('academy_candidates').select('athlete_id, source, intake').eq('invite_token', inviteToken).maybeSingle();
      // Before migration 128 (no intake column): the card still names the row.
      if (cardError && isMissingColumn(cardError)) {
        ({ data: card } = await supabase.from('academy_candidates').select('athlete_id, source').eq('invite_token', inviteToken).maybeSingle());
      }
      const c = card as { athlete_id?: string | null; source?: string | null; intake?: unknown } | null;
      imported = c?.source === 'existing' && isImportedIntake(c?.intake);
      const cardAthlete = c?.athlete_id;
      if (cardAthlete) {
        const { data } = await supabase.from('athletes').select(ATHLETE_COLS).eq('coach_id', COACH_ID).eq('id', cardAthlete).maybeSingle();
        if (data) existing = data as Existing;
      }
    }
    if (!existing) {
      const { data } = await supabase
        .from('athletes')
        .select(ATHLETE_COLS)
        .eq('coach_id', COACH_ID)
        .eq('email', normEmail)
        .maybeSingle();
      existing = (data as Existing | null) ?? null;
    }

    // Only a row that is ITSELF a pending academy application may be rewritten from here.
    // This endpoint is public and unauthenticated, and the row below sets approved:false,
    // role 'academy_user' and status 'invited' — applied to anybody else's row it logged a
    // club member out to the waiting room and stripped a coach's staff role (`role` is what
    // requireStaff reads), for whoever typed that member's address into the form. An existing
    // member who really wants the academy is a real case, and it is the coach's to act on:
    // the row stays exactly as it is, the coach gets the same email marked as an existing
    // member, and the card is linked from the funnel and accept is what flags them. The answer is the same
    // success either way, so the form cannot be used to learn whose address is on the roster.
    const phoneValue = typeof phone === 'string' ? phone.trim() || null : null;
    const intakeObj = intake && typeof intake === 'object' ? (intake as Record<string, unknown>) : null;
    // An imported card is let in by its own confirmation — unless the accept refused (no coach
    // chosen in the file, say). The answer says which, so the screen never promises an install
    // mail that did not go out (sign-up E2E, 2026-10-28).
    let letIn = false;
    // The card was accepted before this submit: they are in, so "קיבלנו, the install link is
    // coming" would mislead. The details are saved; nobody is mailed; the page says so.
    let alreadyIn = false;
    const afterSave = async (athleteId: string | null, existingMember: boolean, likelyMember: string | null = null) => {
      const candidateId = await recordFormCandidate(supabase as any, {
        name: fullName, email: normEmail, phone: phoneValue, inviteToken, src, athleteId, intake: intakeObj,
      });
      // An existing trainee's details form (their card was opened as 'existing'): the manager
      // must read it as that, not as a new applicant (Ofer, 2026-10-19).
      let existingTrainee = false;
      if (candidateId) {
        const { data: card } = await supabase.from('academy_candidates').select('source, accepted_at').eq('id', candidateId).maybeSingle();
        const c = card as { source?: string | null; accepted_at?: string | null } | null;
        existingTrainee = c?.source === 'existing';
        // Accepted already (by staff, or by this form's own earlier confirmation): save only.
        // A form opened without its ?i= (from the move-in mail, say) is not `imported` here,
        // so this is checked for every card — that is the path the 11-18 duplicates took.
        if (c?.accepted_at) { alreadyIn = true; if (imported) letIn = true; return; }
      }
      // Chosen by staff from the academy's file: confirming the details lets them in — the
      // install mail and the coach's heads-up go from the accept; no "waiting for approval".
      if (imported && candidateId) {
        const r = await acceptImported(supabase, candidateId).catch((err: unknown) => {
          console.error('Academy register: import accept failed:', err);
          return { accepted: false };
        });
        if (r.accepted || (r as { reason?: string }).reason === 'already') { letIn = true; return; }
      }
      if (candidateId && !(await claimFormMail(supabase, candidateId))) return;
      // A QA test account (migration 201) gets its own receipt below but emails no admin.
      if (!(await isTestAccount(supabase, athleteId))) await notifyAdminNewAcademyRegistration({
        name: fullName, email: normEmail, phone, existingMember, candidateId,
        intake: intakeObj, likelyMember, existingTrainee,
      });
      await notifyAcademyFormReceived({ email: normEmail, name: fullName, candidateId, athleteId, existingTrainee });
      // The push is the way into the app: on an iPhone the email's button can only
      // open Safari, but a tapped notification opens the installed app on the card.
      await notifyStaff({
        kind: 'academy_applicant',
        url: `/dashboard/academy?tab=funnel${candidateId ? `&candidate=${encodeURIComponent(candidateId)}` : ''}`,
        tag: `academy-applicant-${normEmail}`,
        category: 'management',
        actorAthleteId: athleteId,
        extraRecipientIds: await academyManagerIds(),
        copy: (locale) => academyApplicantCopy(locale, { name: fullName, intake: intakeObj, likelyMember, existingTrainee }),
      });
    };

    if (existing && existing.onboarding_status !== 'academy_pending') {
      await afterSave(null, true);
      return NextResponse.json({ success: true, ...(imported ? { letIn } : {}), ...(alreadyIn ? { alreadyIn } : {}) });
    }

    // Accepted already (approved), not yet signed in: the form is sent again — from the
    // email's link, a reminder, a second tab. Idempotent: the details refresh, nothing else.
    // It used to reset the row to approved:false / invited, undoing the manager's accept.
    if (existing?.approved) {
      const details: Record<string, unknown> = { name: fullName, phone: phoneValue };
      if (intakeObj) details.academy_intake = mergeIntake(existing.academy_intake, intakeObj);
      if (imported) Object.assign(details, importProfileColumns(intakeObj));
      const { error: detailsError } = await supabase.from('athletes').update(details).eq('id', existing.id);
      if (detailsError) console.error('Academy register: details refresh failed:', detailsError.message);
      return NextResponse.json({ success: true, ...(imported ? { letIn } : {}) });
    }

    const token = existing?.invite_token || randomBytes(16).toString('hex');

    const row: Record<string, any> = {
      coach_id: COACH_ID,
      name: fullName,
      email: normEmail,
      phone: phone?.trim() || null,
      status: 'invited',
      is_academy: true,
      role: 'academy_user',
      approved: false,
      onboarding_status: 'academy_pending',
      invite_token: token,
      // Merged: what the academy's file put on the row (sheet_results) is the coach's, not the form's.
      academy_intake: intakeObj ? mergeIntake(existing?.academy_intake, intakeObj) : null,
      ...(imported ? importProfileColumns(intakeObj) : {}),
    };

    let error;
    let athleteId: string | null = existing?.id ?? null;
    if (existing) {
      ({ error } = await supabase.from('athletes').update(row).eq('id', existing.id));
    } else {
      let inserted;
      ({ data: inserted, error } = await supabase.from('athletes').insert(row).select('id').single());
      if (inserted) athleteId = inserted.id;
    }
    // If some columns don't exist yet (unmigrated), retry with the minimal set.
    if (error) {
      const minimal = { coach_id: COACH_ID, name: fullName, email: normEmail, status: 'invited', invite_token: token };
      if (existing) ({ error } = await supabase.from('athletes').update(minimal).eq('id', existing.id));
      else {
        let inserted;
        ({ data: inserted, error } = await supabase.from('athletes').insert(minimal).select('id').single());
        if (inserted) athleteId = inserted.id;
      }
      if (error) throw error;
    }

    await afterSave(athleteId, false, await likelyClubMember(supabase as any, { name: fullName, email: normEmail, phone: phoneValue, athleteId }));

    return NextResponse.json({ success: true, ...(imported ? { letIn } : {}), ...(alreadyIn ? { alreadyIn } : {}) });
  } catch (error: any) {
    console.error('Academy register error:', error);
    // Public route, and the form shows `error` to the applicant: the database's own
    // message stays in the log above.
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
