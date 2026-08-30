/**
 * POST /api/run-chat/token
 *
 * Mints a Stream Chat token for the authenticated user.
 * Identity comes from the verified JWT — callers cannot request tokens for other users.
 * Also returns the apiKey so the client doesn't need NEXT_PUBLIC_STREAM_API_KEY.
 */
import { NextResponse } from 'next/server';
import { requireSession, authError } from '@/lib/auth-session';
import { createServerClient } from '@/lib/supabase/server';
import {
  getStreamServerClient,
  ensureAiUser,
  aiCoachAvatarUrl,
  humanCoachAvatarUrl,
} from '@/lib/stream/server';

export const dynamic = 'force-dynamic';

function roleToHebrew(role: string): string {
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
      return role || '';
  }
}

export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const { user } = auth;

  try {
    const stream = getStreamServerClient();
    await ensureAiUser(stream);

    const roleLabel = roleToHebrew(user.role);
    const baseName = user.name || user.email;
    const displayName = roleLabel ? `${baseName} · ${roleLabel}` : baseName;
    const userId = user.athleteId ?? user.email;

    let image: string | undefined;
    if (user.athleteId) {
      const supabase = createServerClient();
      const { data: athlete } = await supabase
        .from('athletes')
        .select('avatar_url')
        .eq('id', user.athleteId)
        .maybeSingle();
      image = athlete?.avatar_url || undefined;
    }
    if (user.isStaff) image = humanCoachAvatarUrl();

    await stream.upsertUser({
      id: userId,
      name: displayName,
      role: 'user',
      ...(image ? { image } : {}),
    });

    const token = stream.createToken(userId);

    return NextResponse.json({
      apiKey: process.env.STREAM_API_KEY!,
      userId,
      token,
      userName: baseName,
      roleLabel,
      isStaff: user.isStaff,
      imageUrl: image ?? null,
      aiAvatarUrl: aiCoachAvatarUrl(),
    });
  } catch (err: unknown) {
    console.error('POST /api/run-chat/token error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
