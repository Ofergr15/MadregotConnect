import { StreamChat } from 'stream-chat';
import type { SupabaseClient } from '@supabase/supabase-js';

let _client: StreamChat | null = null;

export function getStreamServerClient(): StreamChat {
  if (!_client) {
    const apiKey = process.env.STREAM_API_KEY;
    const apiSecret = process.env.STREAM_API_SECRET;
    if (!apiKey || !apiSecret) throw new Error('STREAM_API_KEY / STREAM_API_SECRET not configured');
    _client = StreamChat.getInstance(apiKey, apiSecret);
  }
  return _client;
}

export { CHANNEL_TYPE, AI_USER_ID, channelId } from './constants';
import { AI_USER_ID } from './constants';

/** Absolute avatar URL — Stream clients load this cross-origin. */
export function aiCoachAvatarUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/aicoach.png`;
}

export function humanCoachAvatarUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/coach-avatar.png`;
}

export type ResolvedCoachStreamUser = {
  athleteId: string | null;
  streamId: string;
  name: string;
  email: string;
  image: string;
};

function roleToHebrew(role: string | null | undefined): string {
  switch (role) {
    case 'admin':
      return 'מנהל';
    case 'coach':
    case 'academy_coach':
      return 'מאמן';
    case 'core_runner':
      return 'רץ ליבה';
    case 'runner':
      return 'רץ';
    case 'viewer':
      return 'צופה';
    default:
      return '';
  }
}

/** Ensure the aicoach bot user exists in Stream. Call once on channel creation. */
export async function ensureAiUser(client: StreamChat) {
  await client.upsertUser({
    id: AI_USER_ID,
    name: 'מאמן AI',
    role: 'admin',
    image: aiCoachAvatarUrl(),
  });
}

/**
 * Sync Stream user profiles (name + avatar) for the given athlete ids so
 * message avatars show club photos instead of blank initials.
 */
export async function upsertStreamUsersFromAthletes(
  client: StreamChat,
  supabase: SupabaseClient,
  athleteIds: string[],
) {
  const ids = [...new Set(athleteIds.filter(Boolean))];
  if (ids.length === 0) return;

  const { data: rows } = await supabase
    .from('athletes')
    .select('id, name, email, role, avatar_url')
    .in('id', ids);

  if (!rows?.length) return;

  await client.upsertUsers(
    rows.map((row) => {
      const roleLabel = roleToHebrew(row.role);
      const baseName = row.name || row.email || row.id;
      return {
        id: row.id,
        name: roleLabel ? `${baseName} · ${roleLabel}` : baseName,
        role: 'user' as const,
        ...(row.avatar_url ? { image: row.avatar_url } : {}),
      };
    }),
  );
}

/**
 * athletes.coach_id references coaches.id, while Stream normally uses athletes.id.
 * Resolve across the two identity spaces by email and eagerly provision the coach.
 */
export async function resolveCoachStreamUser(
  client: StreamChat,
  supabase: SupabaseClient,
  runnerAthleteId: string,
): Promise<ResolvedCoachStreamUser | null> {
  const { data: runner } = await supabase
    .from('athletes')
    .select('coach_id')
    .eq('id', runnerAthleteId)
    .maybeSingle();
  if (!runner?.coach_id) return null;

  const { data: coach } = await supabase
    .from('coaches')
    .select('id, email, name')
    .eq('id', runner.coach_id)
    .maybeSingle();
  if (!coach?.email) return null;

  const { data: coachAthlete } = await supabase
    .from('athletes')
    .select('id, name, email')
    .ilike('email', coach.email)
    .maybeSingle();

  const streamId = coachAthlete?.id || coach.email.toLowerCase();
  const name = coachAthlete?.name || coach.name || coach.email;
  const image = humanCoachAvatarUrl();
  await client.upsertUser({
    id: streamId,
    name: `${name} · מאמן`,
    role: 'user',
    image,
  });

  return {
    athleteId: coachAthlete?.id || null,
    streamId,
    name,
    email: coach.email,
    image,
  };
}
