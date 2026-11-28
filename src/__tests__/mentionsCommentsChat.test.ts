import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mentionPlainText, mentionPreview, mentionedRoomMembers, mentionToken } from '@/lib/feed/mentions';
import { authorAlsoTagged, buildMentionNotification } from '@/lib/feed/notify';
import { feedInteractionCopy, groupChatMessageCopy, mentionCopy } from '@/lib/notifications/copy';

// Task 156: @mentions in feed comments and group chat. A tagged teammate is pushed
// once, under kind 'mention' (the teammates category, so their prefs decide), the
// preview reads @Name instead of the raw token, and a member who blocked the author
// is not told they were tagged.

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const CAROL = '33333333-3333-3333-3333-333333333333';
const OUTSIDER = '44444444-4444-4444-4444-444444444444';

describe('mention plain text', () => {
  it('renders tokens as @Name for push previews', () => {
    const body = `great pace ${mentionToken('Bob', BOB)} and ${mentionToken('כרמל', CAROL)}!`;
    expect(mentionPlainText(body)).toBe('great pace @Bob and @כרמל!');
    expect(mentionPreview(body, 12)).toBe('great pace @…');
  });

  it('the mention, comment and chat previews never carry a uuid', () => {
    const body = `${mentionToken('Bob', BOB)} see you tomorrow`;
    expect(buildMentionNotification({ body, actorAthleteId: ALICE, actorName: 'A', kind: 'comment' })?.body)
      .toBe('@Bob see you tomorrow');
    expect(feedInteractionCopy('he', { name: 'A', kind: 'comment', commentBody: body }).body).not.toContain(BOB);
    expect(groupChatMessageCopy('en', { name: 'A', group: 'G1', text: body }).body).toBe('@Bob see you tomorrow');
  });

  it('chat mention copy names the group', () => {
    expect(mentionCopy('en', { name: 'Alice', kind: 'chat', group: 'קבוצה 2' }).title).toContain('קבוצה 2');
    expect(mentionCopy('he', { name: 'Alice', kind: 'chat', group: 'קבוצה 2' }).title).toContain('בצ׳אט');
  });
});

describe('authorAlsoTagged (feed comments)', () => {
  it('the item author tagged in a comment gets the mention only', () => {
    expect(authorAlsoTagged(`${mentionToken('Bob', BOB)} nice`, ALICE, BOB)).toBe(true);
    expect(authorAlsoTagged(`${mentionToken('Carol', CAROL)} nice`, ALICE, BOB)).toBe(false);
    expect(authorAlsoTagged('nice', ALICE, null)).toBe(false);
    // Tagging yourself on your own item is no mention at all.
    expect(authorAlsoTagged(`${mentionToken('Bob', BOB)}`, BOB, BOB)).toBe(false);
  });
});

describe('mentionedRoomMembers', () => {
  it('only room members, unique, never the author', () => {
    const text = `${mentionToken('Bob', BOB)} ${mentionToken('Bob', BOB)} ${mentionToken('Alice', ALICE)} ${mentionToken('X', OUTSIDER)}`;
    expect(mentionedRoomMembers(text, ALICE, [ALICE, BOB, CAROL])).toEqual([BOB]);
  });
});

// ---- the group chat route ---------------------------------------------------

const h = vi.hoisted(() => ({
  pushes: [] as Array<{ athleteId: string; kind: string; tag: string; category: string; title: string; body: string }>,
  blocks: [] as Array<{ blocker_athlete_id: string; blocked_athlete_id: string }>,
}));

vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: ALICE, isStaff: false, isSuperUser: false } }),
}));
vi.mock('@/lib/group-chat/server', () => ({
  groupChannelId: (g: string) => `g-${g}`,
  groupChatMembers: async () => [ALICE, BOB, CAROL],
  ensureGroupChannel: async () => ({ channel: { sendMessage: async (m: { id?: string }) => ({ message: { id: m.id ?? 'm1' } }) } }),
}));
vi.mock('@/lib/stream/server', () => ({ getStreamServerClient: () => ({}), CHANNEL_TYPE: 'messaging' }));
vi.mock('@/lib/push', () => ({
  notifyAthlete: async (o: { athleteId: string; kind: string; tag: string; category: string; copy: (l: 'he' | 'en') => { title: string; body: string } }) => {
    const c = o.copy('en');
    h.pushes.push({ athleteId: o.athleteId, kind: o.kind, tag: o.tag, category: o.category, title: c.title, body: c.body });
    return { subscriptions: 1, delivered: 1 };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const f: { eq: Record<string, unknown>; in: Record<string, unknown[]> } = { eq: {}, in: {} };
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => { f.eq[c] = v; return b; },
        in: (c: string, v: unknown[]) => { f.in[c] = v; return b; },
        maybeSingle: async () => ({ data: table === 'athletes' ? { name: 'Alice' } : { name: 'Group 2' }, error: null }),
        then(resolve: (v: unknown) => unknown) {
          const data = table === 'athlete_blocks'
            ? h.blocks.filter((r) => r.blocked_athlete_id === f.eq.blocked_athlete_id && (f.in.blocker_athlete_id ?? []).includes(r.blocker_athlete_id))
            : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return b;
    },
  }),
}));

async function send(text: string) {
  const { POST } = await import('@/app/api/group-chat/messages/route');
  return POST(new Request('http://x/api/group-chat/messages', { method: 'POST', body: JSON.stringify({ groupId: 'grp', text }) }));
}

describe('POST /api/group-chat/messages — mentions', () => {
  beforeEach(() => { h.pushes = []; h.blocks = []; });

  it('a tagged member gets ONE mention push; the rest get the plain message push', async () => {
    const res = await send(`${mentionToken('Bob', BOB)} bring the gels`);
    expect(res.status).toBe(200);
    const bob = h.pushes.filter((p) => p.athleteId === BOB);
    expect(bob).toHaveLength(1);
    expect(bob[0]).toMatchObject({ kind: 'mention', category: 'teammates', body: '@Bob bring the gels' });
    expect(bob[0].tag).toBe('group-chat-grp-mention-' + BOB);
    const carol = h.pushes.filter((p) => p.athleteId === CAROL);
    expect(carol).toHaveLength(1);
    expect(carol[0].kind).toBe('group_chat_message');
    expect(carol[0].body).toBe('@Bob bring the gels');
    expect(h.pushes.some((p) => p.athleteId === ALICE)).toBe(false);
  });

  it('a tagged member who blocked the author is not pushed at all', async () => {
    h.blocks = [{ blocker_athlete_id: BOB, blocked_athlete_id: ALICE }];
    await send(`${mentionToken('Bob', BOB)} hi`);
    expect(h.pushes.filter((p) => p.athleteId === BOB)).toHaveLength(0);
    expect(h.pushes.filter((p) => p.athleteId === CAROL)).toHaveLength(1);
  });

  it('a token naming someone outside the room pushes nobody extra', async () => {
    await send(`${mentionToken('X', OUTSIDER)} hi`);
    expect(h.pushes.map((p) => p.athleteId).sort()).toEqual([BOB, CAROL].sort());
    expect(h.pushes.every((p) => p.kind === 'group_chat_message')).toBe(true);
  });
});
