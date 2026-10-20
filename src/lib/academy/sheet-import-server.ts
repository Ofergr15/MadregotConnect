import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import type { VerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { notifyAcademyExistingForm } from '@/lib/email';
import { holdsAcademyCoachRole } from './coaches';
import { readRosterForMatching, clubMembers } from './link-server';
import { clubMatchFor, normalizeEmail } from './link';
import { createMoveInInvite } from './move-in-invite';
import { parseBulk } from './manage';
import { runBulk } from './manage-server';
import { inviteUrl } from './intake';
import { EU_SHOE_SIZES } from '@/lib/shoe-catalog';
import {
  coachForNick, importIntake, importStage, isImportedIntake, isStuck,
  type ImportRow, type ImportStage, type SheetResults,
} from './sheet-import';

type Db = ReturnType<typeof createServerClient>;

/**
 * The import's server half (lib/academy/sheet-import.ts is the pure half): who the file's
 * rows already are in the app, the cards it opens, the invitations, and where each person is.
 * Manager only — the routes check that before calling in.
 */

export interface ImportCoach { id: string; name: string }
export interface ImportBand { id: string; name: string; n: number | null }

export async function loadCoachesAndBands(supabase: Db): Promise<{ coaches: ImportCoach[]; bands: ImportBand[] }> {
  const [{ data: people }, { data: bandRows }] = await Promise.all([
    supabase.from('athletes').select('id, name, role, extra_roles').eq('coach_id', COACH_ID),
    supabase.from('academy_bands').select('id, name'),
  ]);
  const coaches = ((people || []) as Array<{ id: string; name: string; role: string | null; extra_roles: string[] | null }>)
    .filter((p) => holdsAcademyCoachRole(p as never))
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const bands = ((bandRows || []) as Array<{ id: string; name: string }>).map((b) => {
    const m = /(\d{1,2})/.exec(b.name);
    return { id: b.id, name: b.name, n: m ? Number(m[1]) : null };
  });
  return { coaches, bands };
}

export type PreviewKind = 'no_email' | 'in_app' | 'club_member' | 'has_card';

export interface PreviewNeed {
  key: string;
  kind: PreviewKind;
  /** The account it would link to (in_app / club_member). */
  athleteId?: string;
  athleteName?: string;
  /** The account is an approved club member (so it can be moved in), not a pending form. */
  member?: boolean;
  why?: string;
}

/**
 * Who each row already is: an account with the same email (in the app), a club member by
 * phone or name in either script (אבי ברק ↔ Avi Barak), a card already on the funnel —
 * or nobody, which is "ready". Nothing is written.
 */
export async function previewImport(supabase: Db, rows: ImportRow[]): Promise<{ needs: PreviewNeed[]; ready: string[] }> {
  const roster = await readRosterForMatching(supabase as never);
  const members = clubMembers(roster);
  const { data: cards } = await supabase.from('academy_candidates').select('id, email, archived_at');
  const cardEmails = new Set(((cards || []) as Array<{ email: string | null; archived_at: string | null }>)
    .filter((c) => !c.archived_at).map((c) => normalizeEmail(c.email)).filter(Boolean) as string[]);
  const byEmail = new Map(roster.map((r) => [normalizeEmail(r.email), r] as const).filter(([e]) => e));

  const needs: PreviewNeed[] = [];
  const ready: string[] = [];
  for (const r of rows) {
    const email = normalizeEmail(r.email);
    const inApp = email ? byEmail.get(email) : undefined;
    if (inApp) {
      needs.push({ key: r.key, kind: 'in_app', athleteId: inApp.id, athleteName: inApp.name, member: inApp.approved && inApp.status !== 'removed', why: 'אותה כתובת מייל' });
      continue;
    }
    // Only a sure match: the phone, or the same name in either script. "שם כמעט זהה" is a hint
    // for a person searching, not a reason to fold one trainee into another's account.
    const found = clubMatchFor({ id: r.key, name: r.name, email: r.email, phone: r.phone }, members);
    const match = found && (found.reason !== 'name' || found.text === 'אותו שם' || found.text === 'אותו שם, בעברית ובאנגלית') ? found : null;
    if (match) {
      needs.push({ key: r.key, kind: 'club_member', athleteId: match.athlete.id, athleteName: match.athlete.name, member: true, why: match.text });
      continue;
    }
    if (email && cardEmails.has(email)) { needs.push({ key: r.key, kind: 'has_card', why: 'כבר יש לו כרטיס במשפך' }); continue; }
    if (!email) { needs.push({ key: r.key, kind: 'no_email' }); continue; }
    ready.push(r.key);
  }
  return { needs, ready };
}

export interface CommitInput {
  rows: ImportRow[];
  /** nickname → coach id (null: no coach yet). */
  coachMap: Record<string, string | null>;
  /** row key → the account to link the card to (an existing club member). */
  links: Record<string, string>;
  /** row keys not to import. */
  skip: string[];
}

/** Opens one card per row, source 'import', NOT invited. No email, no push, nothing to anyone. */
export async function commitImport(supabase: Db, caller: VerifiedCaller, input: CommitInput): Promise<{ created: number; linked: number; skipped: number }> {
  const { coaches, bands } = await loadCoachesAndBands(supabase);
  const coachIdsOk = new Set(coaches.map((c) => c.id));
  const skip = new Set(input.skip);
  let created = 0, linked = 0, skipped = 0;
  for (const r of input.rows) {
    if (skip.has(r.key)) { skipped++; continue; }
    const mapped = r.coachNick ? input.coachMap[r.coachNick.trim()] ?? coachForNick(r.coachNick, coaches) : null;
    const coachIds = mapped && coachIdsOk.has(mapped) ? [mapped] : [];
    const bandId = r.requestedBand != null ? bands.find((b) => b.n === r.requestedBand)?.id ?? null : null;
    const intake = importIntake(r, { coachIds, bandId });
    (intake._import as Record<string, unknown>).importedBy = { athleteId: caller.athleteId, email: caller.email };
    const linkTo = input.links[r.key] ?? null;
    const row: Record<string, unknown> = {
      name: r.name, email: r.email, phone: r.phone, source: 'import', intake,
      ...(linkTo ? { athlete_id: linkTo } : {}),
    };
    const { error } = await supabase.from('academy_candidates').insert(row);
    if (error) {
      // The athlete already has a card (the partial unique index): import without the link.
      if (linkTo && String((error as { code?: string }).code) === '23505') {
        delete row.athlete_id;
        const again = await supabase.from('academy_candidates').insert(row);
        if (again.error) { console.error('academy import: card insert failed:', again.error.message); skipped++; continue; }
        created++;
        continue;
      }
      console.error('academy import: card insert failed:', error.message);
      skipped++;
      continue;
    }
    if (linkTo) linked++; else created++;
  }
  return { created, linked, skipped };
}

export interface BoardRow {
  cardId: string;
  athleteId: string | null;
  name: string;
  email: string | null;
  hasPhone: boolean;
  coachIds: string[];
  coachNames: string[];
  requestedBand: number | null;
  marked: boolean;
  linked: boolean;
  stage: ImportStage;
  stuck: boolean;
  invitedAt: string | null;
  hasResults: boolean;
  /** Staff-only: the call notes from the file. */
  staffNote: string | null;
}

/** Every card the file opened, and where each person is: not invited → invited → confirmed → in the app. */
export async function loadImportBoard(supabase: Db, now = Date.now()): Promise<BoardRow[]> {
  const sel = await supabase.from('academy_candidates')
    .select('id, name, email, phone, source, athlete_id, invited_at, accepted_at, archived_at, intake')
    .in('source', ['import', 'existing']);
  if (sel.error) return [];
  const cards = ((sel.data || []) as Array<Record<string, any>>).filter((c) => !c.archived_at && isImportedIntake(c.intake));
  const athleteIds = cards.map((c) => c.athlete_id).filter(Boolean) as string[];
  const [{ data: ath }, { data: events }, { coaches }] = await Promise.all([
    athleteIds.length
      ? supabase.from('athletes').select('id, first_seen_at, is_academy').in('id', athleteIds)
      : Promise.resolve({ data: [] as unknown[] }),
    cards.length
      ? supabase.from('academy_candidate_events').select('candidate_id, stage').in('candidate_id', cards.map((c) => c.id)).eq('stage', 'form')
      : Promise.resolve({ data: [] as unknown[] }),
    loadCoachesAndBands(supabase),
  ]);
  const athleteBy = new Map(((ath || []) as Array<{ id: string; first_seen_at: string | null }>).map((a) => [a.id, a]));
  const formDone = new Set(((events || []) as Array<{ candidate_id: string }>).map((e) => e.candidate_id));
  const coachName = new Map(coaches.map((c) => [c.id, c.name]));
  const rows: BoardRow[] = cards.map((c) => {
    const imp = (c.intake?._import ?? {}) as Record<string, any>;
    const coachIds = Array.isArray(imp.coachIds) ? imp.coachIds as string[] : [];
    const linked = c.source === 'import' && !!c.athlete_id;
    const athlete = c.athlete_id ? athleteBy.get(c.athlete_id) ?? null : null;
    const stage = importStage({ invited_at: c.invited_at ?? null, accepted_at: c.accepted_at ?? null }, linked ? null : athlete, formDone.has(c.id));
    return {
      cardId: c.id, athleteId: c.athlete_id ?? null, name: c.name, email: c.email ?? null, hasPhone: !!c.phone,
      coachIds, coachNames: coachIds.map((id) => coachName.get(id) ?? '').filter(Boolean),
      requestedBand: typeof imp.requestedBand === 'number' ? imp.requestedBand : null,
      marked: imp.marked === true, linked,
      stage, stuck: isStuck(stage, c.invited_at ?? null, now), invitedAt: c.invited_at ?? null,
      hasResults: !!c.intake?.sheet_results, staffNote: typeof imp.staffNote === 'string' ? imp.staffNote : null,
    };
  });
  const order: Record<ImportStage, number> = { invited: 0, not_invited: 1, confirmed: 2, in_app: 3 };
  rows.sort((a, b) => Number(b.stuck) - Number(a.stuck) || order[a.stage] - order[b.stage] || a.name.localeCompare(b.name));
  return rows;
}

/**
 * What the file says about the person, as athlete columns — only values the columns accept
 * (the CHECKs of migrations 057/061/155), so an odd cell never fails the whole invitation.
 */
export function athleteExtrasFromIntake(intake: Record<string, any>): Record<string, unknown> {
  const p = (intake?.imported ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof p.height === 'number' && p.height >= 100 && p.height <= 250) out.height_cm = Math.round(p.height);
  if (typeof p.weight === 'number' && p.weight >= 25 && p.weight <= 250) out.weight_kg = p.weight;
  if (typeof p.shirtSize === 'string' && ['XS', 'S', 'M', 'L', 'XL', 'XXL'].includes(p.shirtSize)) out.shirt_size = p.shirtSize;
  if (typeof p.shoeSize === 'string' && EU_SHOE_SIZES.includes(p.shoeSize)) out.shoe_size = p.shoeSize;
  // The coach's baseline reads athletes.academy_intake.sheet_results (lib/academy/coach-baseline).
  if (intake?.sheet_results) out.academy_intake = { sheet_results: intake.sheet_results as SheetResults };
  return out;
}

export interface InviteOutcome { cardId: string; ok: boolean; error?: string; emailed?: boolean; moved?: boolean }

/**
 * The chosen cards, invited. Somebody new gets the move-in invitation (createMoveInInvite) on
 * the card the import opened, with the coach preset and the file's details on the row; a club
 * member the import linked is moved in as one (the members tab's "מהמועדון", runBulk).
 */
export async function inviteImported(supabase: Db, caller: VerifiedCaller, cardIds: string[]): Promise<InviteOutcome[]> {
  const out: InviteOutcome[] = [];
  for (const id of cardIds) {
    const { data: c } = await supabase.from('academy_candidates')
      .select('id, name, email, phone, source, athlete_id, invited_at, intake').eq('id', id).maybeSingle();
    const card = c as Record<string, any> | null;
    if (!card || !isImportedIntake(card.intake)) { out.push({ cardId: id, ok: false, error: 'not_found' }); continue; }
    if (card.invited_at) { out.push({ cardId: id, ok: false, error: 'already_invited' }); continue; }
    const imp = card.intake._import as Record<string, any>;
    const coachIds = Array.isArray(imp.coachIds) ? imp.coachIds as string[] : [];
    const intake = { ...card.intake, _import: { ...imp, invitedBy: { athleteId: caller.athleteId, email: caller.email } } };

    if (card.athlete_id) {
      const parsed = parseBulk({ athleteIds: [card.athlete_id], action: 'add', existing: true, coachIds, notify: true });
      if (typeof parsed === 'string') { out.push({ cardId: id, ok: false, error: parsed }); continue; }
      const res = await runBulk(parsed, caller);
      const json = await res.json().catch(() => ({})) as { results?: Array<{ ok: boolean; error?: string }> };
      const r = json.results?.[0];
      if (!res.ok || !r?.ok) { out.push({ cardId: id, ok: false, error: r?.error || 'move_failed' }); continue; }
      const now = new Date().toISOString();
      await supabase.from('academy_candidates').update({ source: 'existing', invited_at: now, accepted_at: now, updated_at: now, intake }).eq('id', id);
      if (intake.sheet_results) {
        const { data: a } = await supabase.from('athletes').select('academy_intake').eq('id', card.athlete_id).maybeSingle();
        const cur = ((a as { academy_intake?: Record<string, unknown> | null } | null)?.academy_intake) ?? {};
        if (!cur.sheet_results) await supabase.from('athletes').update({ academy_intake: { ...cur, sheet_results: intake.sheet_results } }).eq('id', card.athlete_id);
      }
      out.push({ cardId: id, ok: true, moved: true });
      continue;
    }

    if (!card.email) { out.push({ cardId: id, ok: false, error: 'no_email' }); continue; }
    // The staff block first, so the auto-accept knows who chose them (register → acceptImported).
    const stamp = await supabase.from('academy_candidates').update({ intake }).eq('id', id);
    if (stamp.error && !isMissingColumn(stamp.error)) console.error('academy import: intake stamp failed:', stamp.error.message);
    const result = await createMoveInInvite(caller, {
      name: card.name, email: card.email, phone: card.phone || '', coachIds, cardId: id,
      athleteExtras: athleteExtrasFromIntake(card.intake),
    });
    if (result.status !== 200) {
      // Undo the stamp's "chosen" so the row stays plainly "not invited".
      await supabase.from('academy_candidates').update({ intake: card.intake }).eq('id', id);
      out.push({ cardId: id, ok: false, error: String(result.body.error || 'invite_failed') });
      continue;
    }
    out.push({ cardId: id, ok: true, emailed: result.body.emailed === true });
  }
  return out;
}

/** "תזכורת לכולם": the details form again, for whoever was invited 48+ hours ago and has not filled it. */
export async function remindStuck(supabase: Db): Promise<number> {
  const board = await loadImportBoard(supabase);
  let sent = 0;
  for (const r of board.filter((x) => x.stuck && x.email)) {
    const { data } = await supabase.from('academy_candidates').select('invite_token, athlete_id').eq('id', r.cardId).maybeSingle();
    const token = (data as { invite_token?: string | null } | null)?.invite_token;
    if (!token) continue;
    const res = await notifyAcademyExistingForm({ email: r.email!, name: r.name, url: inviteUrl(token), candidateId: r.cardId, athleteId: (data as { athlete_id?: string | null }).athlete_id ?? null })
      .catch(() => null);
    if (res?.ok) sent++;
  }
  return sent;
}

export async function setCardEmail(supabase: Db, cardId: string, raw: string): Promise<Response> {
  const email = normalizeEmail(raw);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'email' }, { status: 400 });
  const { data } = await supabase.from('academy_candidates').select('id, intake, invited_at').eq('id', cardId).maybeSingle();
  const card = data as { id: string; intake: unknown; invited_at: string | null } | null;
  if (!card || !isImportedIntake(card.intake)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (card.invited_at) return NextResponse.json({ error: 'already_invited' }, { status: 409 });
  const { error } = await supabase.from('academy_candidates').update({ email, updated_at: new Date().toISOString() }).eq('id', cardId);
  if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  return NextResponse.json({ ok: true, email });
}

/**
 * The trainee confirmed the details the file had: they were chosen by staff (the import's
 * "מי מוזמן"), so this IS the approval — the same accept the funnel's button runs
 * (admit-server acceptAction: approved, the install mail, the coach's "טופס התאמה" heads-up),
 * on behalf of the manager who sent the invitation. Only for a card the import opened and a
 * manager invited, and only once.
 */
export async function acceptImported(supabase: Db, cardId: string): Promise<{ accepted: boolean; reason?: string }> {
  const { data } = await supabase.from('academy_candidates').select('id, source, intake, accepted_at, athlete_id').eq('id', cardId).maybeSingle();
  const card = data as { source: string | null; intake: Record<string, any> | null; accepted_at: string | null; athlete_id: string | null } | null;
  if (!card || card.source !== 'existing' || !isImportedIntake(card.intake)) return { accepted: false, reason: 'not_imported' };
  if (card.accepted_at) return { accepted: false, reason: 'already' };
  const by = (card.intake!._import as Record<string, any>).invitedBy as { athleteId?: string | null; email?: string | null } | undefined;
  if (!by?.athleteId) return { accepted: false, reason: 'no_inviter' };
  const { acceptAction } = await import('./admit-server');
  const caller: VerifiedCaller = {
    email: by.email || '', isSuperUser: false, canApprove: false, isStaff: true, athleteId: by.athleteId,
    role: 'academy_manager', roles: ['academy_manager'], isCoreRunner: false,
  };
  const res = await acceptAction(cardId, caller, {});
  return res.ok ? { accepted: true } : { accepted: false, reason: `accept_${res.status}` };
}
