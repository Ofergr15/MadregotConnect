import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { getStreamServerClient, CHANNEL_TYPE } from '@/lib/stream/server';
import {
  academyChannelId,
  buildInbox,
  snapshotFromMessages,
  type ThreadSnapshot,
} from '@/lib/academy/thread';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/threads/inbox — "what is waiting for me", ranked.
 *
 * STAFF ONLY, and scoped the same way `/api/academy/members` is: a manager sees
 * every pair because that is the job, and a coach sees only the trainees assigned
 * to them. Enforced here and not in the component, for the same reason as there —
 * this payload names every trainee, so a coach filtering client-side would still
 * have been handed the whole academy.
 *
 * The ORDER is not computed here. It comes from `buildInbox`, which is pure and
 * tested, because a row in the wrong place is a person who does not get answered.
 * This route's whole job is to assemble honest snapshots and hand them over.
 */

/**
 * How far back to read each thread.
 *
 * Only the newest message per side is needed, so this is a window and not a
 * history: `snapshotFromMessages` documents why a truncated window still
 * classifies correctly. Twenty keeps the payload small on a club of twenty
 * threads without ever missing the message that decides who spoke last.
 */
const MESSAGE_WINDOW = 20;

/** Stream caps `queryChannels` at 30 per call. The club is 20, but pages anyway. */
const CHANNEL_PAGE = 30;

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const isManager = caller.isSuperUser || caller.role === 'admin';

    const supabase = createServerClient();
    const { data: rows, error } = await supabase
      .from('athletes')
      .select('id, name, is_academy, academy_coach_id')
      .eq('coach_id', COACH_ID);
    if (error) {
      // The pairing column arrives with migration 077. Without it there is no
      // mentor→trainee link to scope on, so there is no inbox — which is a real
      // empty state and not an error the manager can do anything about.
      // Shaped like a real empty inbox, not a stub with nulls in it: the component
      // reads `counts` for its header, so a `counts: null` here would trade a
      // missing column for a crash.
      return NextResponse.json({ ...buildInbox([]), scope: 'academy', unmigrated: true });
    }

    const roster = (rows || [])
      .filter(a => a.is_academy)
      .filter(a => isManager || (a.academy_coach_id && a.academy_coach_id === caller.athleteId));

    if (roster.length === 0) {
      return NextResponse.json({ ...buildInbox([]), scope: isManager ? 'academy' : 'coach' });
    }

    // Everyone starts as a thread nobody has used. That is the truthful default: a
    // trainee whose channel does not exist yet has had nothing said to them, which
    // this screen exists to surface — so a missing channel must show up as `silent`
    // and not vanish from the list.
    const byId = new Map<string, ThreadSnapshot>(
      roster.map(a => [a.id, snapshotFromMessages(a.id, a.name || a.id, [], 0)]),
    );
    const channelToAthlete = new Map(roster.map(a => [academyChannelId(a.id), a.id]));

    let streamError: string | null = null;
    try {
      const stream = getStreamServerClient();
      const ids = [...channelToAthlete.keys()];
      // Queried AS THE CALLER, which is what makes the unread counts theirs: the
      // manager's unread and the coach's unread on the same thread are different
      // numbers, and a shared one would be wrong for both.
      const asUser = caller.athleteId ?? undefined;

      for (let i = 0; i < ids.length; i += CHANNEL_PAGE) {
        const page = ids.slice(i, i + CHANNEL_PAGE);
        const channels = await stream.queryChannels(
          { type: CHANNEL_TYPE, id: { $in: page } },
          [{ last_message_at: -1 }],
          { limit: CHANNEL_PAGE, message_limit: MESSAGE_WINDOW, state: true, ...(asUser ? { user_id: asUser } : {}) },
        );

        for (const ch of channels) {
          const athleteId = ch.id ? channelToAthlete.get(ch.id) : undefined;
          if (!athleteId) continue;
          const base = byId.get(athleteId);
          if (!base) continue;

          let unread = 0;
          try {
            unread = ch.countUnread();
          } catch {
            // An unread count is a nice-to-have; who is owed a reply is not. Never
            // let this drop a row, because `unread` is the weakest band anyway.
            unread = 0;
          }

          byId.set(athleteId, snapshotFromMessages(athleteId, base.name, ch.state.messages ?? [], unread));
        }
      }
    } catch (err: unknown) {
      // A Stream outage must not blank the screen. Every trainee is already seeded
      // as an unused thread, so the list still names the whole roster in a
      // defensible order — it just cannot tell you who wrote last. Reported so the
      // UI can say that rather than quietly implying nobody has ever written.
      streamError = String(err);
      console.error('GET /api/academy/threads/inbox — Stream unavailable:', err);
    }

    return NextResponse.json({
      ...buildInbox([...byId.values()]),
      scope: isManager ? 'academy' : 'coach',
      ...(streamError ? { degraded: true } : {}),
    });
  } catch (err: unknown) {
    console.error('GET /api/academy/threads/inbox error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
