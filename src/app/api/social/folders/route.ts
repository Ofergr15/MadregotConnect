import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { createFolderNow, socialWeek, updateDayFolder } from '@/lib/quality-session/photos-server';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// /api/social/folders — the Social screen (admin): the photo folders of the week.
//   GET  -> { configured, upcoming: [...], made: [...] }
//   POST { date, name, notifyEditors?, autoFeed? } -> { folder }
//   PATCH { date, name?, autoFeed?, skipped? } -> { folder }   (תחילת שבוע: rename, feed card, no folder)
// The super user and admins: the screen makes folders in the club's Drive.

async function gate(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return { denied: authError(auth) } as const;
  if (!auth.user.isSuperUser && auth.user.role !== 'admin') {
    return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const;
  }
  return { auth } as const;
}

export async function GET(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  try {
    return NextResponse.json(await socialWeek(createServerClient()));
  } catch (err) {
    console.error('[social/folders] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  const body = await request.json().catch(() => ({}));
  const date = typeof body?.date === 'string' ? body.date : '';
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!DATE.test(date) || !name) return NextResponse.json({ error: 'date and name are required' }, { status: 400 });
  try {
    const folder = await createFolderNow(createServerClient(), {
      date, name,
      notifyEditors: body?.notifyEditors !== false,
      autoFeed: body?.autoFeed !== false,
      byAthleteId: g.auth.user.athleteId,
    });
    if (!folder) return NextResponse.json({ error: 'drive-not-configured' }, { status: 503 });
    return NextResponse.json({ folder });
  } catch (err) {
    console.error('[social/folders] POST failed:', err);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  const body = await request.json().catch(() => null);
  const date = typeof body?.date === 'string' ? body.date : '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date is required' }, { status: 400 });
  try {
    const folder = await updateDayFolder(createServerClient(), date, {
      name: typeof body?.name === 'string' ? body.name.slice(0, 120) : undefined,
      autoFeed: typeof body?.autoFeed === 'boolean' ? body.autoFeed : undefined,
      skipped: typeof body?.skipped === 'boolean' ? body.skipped : undefined,
    });
    return NextResponse.json({ folder });
  } catch (err) {
    console.error('[social/folders] PATCH failed:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

