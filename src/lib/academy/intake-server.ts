import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { isInviteFresh, looksLikeToken, sourceFromParam } from './intake';

/**
 * The public form's side of the funnel: whoever submits it gets a card, and that
 * card has `form` stamped.
 *
 * Before this the form wrote an athlete row and mailed the admin, and the funnel
 * never heard of it — the coach retyped every applicant by hand, and an applicant
 * who was invited from a card landed on the board a second time.
 *
 * Which card, in order:
 *   1. the invite token's card, if the link is still fresh (door A)
 *   2. a card with this email (door B, or door A with an expired link)
 *   3. a card already linked to the athlete row the form just wrote
 *   4. a new card, source 'instagram' or 'form' from `src`
 *
 * Never throws and never fails the submit: the applicant's form is the thing that
 * had to be saved, and a card that failed to appear is one the coach can still add.
 */
export async function recordFormCandidate(
  supabase: SupabaseClient,
  p: {
    name: string;
    email: string;
    phone: string | null;
    inviteToken?: unknown;
    src?: unknown;
    /** The pending academy row the form wrote; null for an existing member, whose
     *  row the form must not touch and whose link is the coach's call. */
    athleteId: string | null;
  },
): Promise<string | null> {
  try {
    type Card = { id: string; email: string | null; phone: string | null; athlete_id: string | null; archived_at: string | null };
    const cols = 'id, email, phone, athlete_id, archived_at';
    let card: Card | null = null;

    if (looksLikeToken(p.inviteToken)) {
      const { data, error } = await supabase
        .from('academy_candidates')
        .select(`${cols}, invited_at`)
        .eq('invite_token', p.inviteToken)
        .maybeSingle();
      if (error && isMissingTable(error)) return null;
      if (data && isInviteFresh((data as any).invited_at)) card = data as Card;
    }

    if (!card) {
      const { data, error } = await supabase
        .from('academy_candidates')
        .select(cols)
        // eq, not ilike: `_` is an ilike wildcard and is common in addresses. Every
        // writer of this column lowercases it.
        .eq('email', p.email)
        .order('archived_at', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true })
        .limit(1);
      if (error && isMissingTable(error)) return null;
      card = (data?.[0] as Card) ?? null;
    }

    if (!card && p.athleteId) {
      const { data } = await supabase
        .from('academy_candidates')
        .select(cols)
        .eq('athlete_id', p.athleteId)
        .maybeSingle();
      card = (data as Card) ?? null;
    }

    if (!card) {
      const { data, error } = await supabase
        .from('academy_candidates')
        .insert({
          name: p.name,
          email: p.email,
          phone: p.phone,
          source: sourceFromParam(p.src),
          athlete_id: p.athleteId,
        })
        .select(cols)
        .single();
      if (error) {
        if (!isMissingTable(error)) console.error('academy form: card insert failed:', error.message);
        return null;
      }
      card = data as Card;
    } else {
      // Fill what the card lacks, never overwrite what staff typed. A person who came
      // back after being archived is back on the board: that is what submitting means.
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (!card.email) patch.email = p.email;
      if (!card.phone && p.phone) patch.phone = p.phone;
      if (card.archived_at) { patch.archived_at = null; patch.archived_reason = null; }
      const { error } = await supabase.from('academy_candidates').update(patch).eq('id', card.id);
      if (error) console.error('academy form: card update failed:', error.message);
      if (!card.athlete_id && p.athleteId) {
        // Separate write: the partial unique index refuses it when this athlete already
        // has another card, and that refusal must not also lose the phone above.
        const { error: linkError } = await supabase
          .from('academy_candidates')
          .update({ athlete_id: p.athleteId })
          .eq('id', card.id);
        if (linkError && String((linkError as any).code) !== '23505') {
          console.error('academy form: card link failed:', linkError.message);
        }
      }
    }

    // ignoreDuplicates: a second submit keeps the first date, which is when the form
    // was really filled; a coach's own correction of that date is not overwritten.
    await supabase
      .from('academy_candidate_events')
      .upsert(
        { candidate_id: card.id, stage: 'form', recorded_by: 'academy-form', note: 'הטופס מולא באתר' },
        { onConflict: 'candidate_id,stage', ignoreDuplicates: true },
      );

    return card.id;
  } catch (err) {
    console.error('academy form: candidate step threw:', err);
    return null;
  }
}

/**
 * The prefill a personal link opens with. Only what staff already hold and the
 * invitee already knows about themselves: name, email, phone. Nothing from the
 * coach's side of the card, and nothing at all for a stale or unknown token.
 */
export async function invitePrefill(
  supabase: SupabaseClient,
  token: unknown,
): Promise<{ name: string; email: string; phone: string } | null> {
  if (!looksLikeToken(token)) return null;
  const { data, error } = await supabase
    .from('academy_candidates')
    .select('name, email, phone, invited_at, archived_at')
    .eq('invite_token', token)
    .maybeSingle();
  if (error) {
    if (!isMissingTable(error) && !isMissingColumn(error)) console.error('invite prefill failed:', error.message);
    return null;
  }
  if (!data || !isInviteFresh(data.invited_at)) return null;
  return { name: data.name || '', email: data.email || '', phone: data.phone || '' };
}
