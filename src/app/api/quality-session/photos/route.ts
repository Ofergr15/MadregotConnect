import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { isStoryEditor } from '@/lib/quality-session/access';
import { sanitizeMediaList } from '@/lib/feed/media';
import { MAX_SESSION_PHOTOS, cleanPhotosLink, toSessionPhotos } from '@/lib/quality-session/photos';
import { cardFor, publishSessionPhotos, readFolderLedger } from '@/lib/quality-session/photos-server';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// /api/quality-session/photos — the day's "photos from the session" card (#106).
// Same gate as the quality-session screen it lives on: the super user and the
// "אינסטגרם" editors (lib/quality-session/access.ts).

async function gate(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return { denied: authError(auth) } as const;
  const supabase = createServerClient();
  if (!auth.user.athleteId || (!auth.user.isSuperUser && !(await isStoryEditor(supabase, auth.user.athleteId)))) {
    return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const;
  }
  return { auth, supabase } as const;
}

// GET ?date= -> { card: { id, link, media } | null, folder: string | null }
export async function GET(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  const [row, ledger] = await Promise.all([cardFor(g.supabase, date), readFolderLedger(g.supabase)]);
  const p = toSessionPhotos(row?.payload);
  return NextResponse.json({
    card: row && p ? { id: row.id, link: p.link, media: row.media || [] } : null,
    // The folder made the evening before (photos-server.ts), when there is one.
    folder: ledger[date]?.link || null,
  });
}

// POST { date, link, media?, notify? } -> { id, told }
//   Publishes the day's card, or updates it: one card per day, so a second POST
//   replaces the link and photos instead of adding a second card. Members who
//   marked "coming" are told on the first publish only, unless `notify` is false.
export async function POST(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  const { auth, supabase } = g;
  const body = await request.json().catch(() => ({}));
  const date = typeof body?.date === 'string' ? body.date : '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  const link = cleanPhotosLink(body?.link);
  if (!link) return NextResponse.json({ error: 'bad-link' }, { status: 400 });
  const raw = Array.isArray(body?.media) ? body.media : [];
  if (raw.length > MAX_SESSION_PHOTOS) return NextResponse.json({ error: 'too-many' }, { status: 400 });
  // Only photos this caller uploaded (/api/feed/media files them under their id).
  const media = sanitizeMediaList(raw, auth.user.athleteId!).map((m) => ({
    ...m,
    url: supabase.storage.from('feed-media').getPublicUrl(m.path).data.publicUrl,
  }));

  try {
    const out = await publishSessionPhotos(supabase, {
      date, link, media, byAthleteId: auth.user.athleteId!, notify: body?.notify !== false,
    });
    return NextResponse.json(out);
  } catch (err) {
    console.error('[quality-session/photos] POST failed:', err);
    return NextResponse.json({ error: 'Failed to publish' }, { status: 500 });
  }
}

// DELETE ?date= -> { ok } — takes the day's card down (soft, like a post).
export async function DELETE(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  const row = await cardFor(g.supabase, date);
  if (!row) return NextResponse.json({ ok: true });
  const { error } = await g.supabase.from('feed_items').update({ deleted_at: new Date().toISOString() }).eq('id', row.id);
  if (error) return NextResponse.json({ error: 'Failed to remove' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
