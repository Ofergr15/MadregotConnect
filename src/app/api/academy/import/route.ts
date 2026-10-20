import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAcademyManager } from '@/lib/academy/pairing-server';
import { cleanRows } from '@/lib/academy/sheet-import';
import {
  commitImport, inviteImported, loadCoachesAndBands, loadImportBoard, previewImport, remindStuck, setCardEmail,
} from '@/lib/academy/sheet-import-server';

export const dynamic = 'force-dynamic';

/**
 * The academy's file → the app (mockups/roles-1019/academy-import.html). Manager only.
 *
 *   GET                                    the coaches, the bands, and every imported card with its stage
 *   POST { action: 'preview', rows }       who each row already is — nothing written
 *   POST { action: 'commit', rows, coachMap, links, skip }   one card per row, NOT invited, nothing sent
 *   POST { action: 'invite', cardIds }     the move-in invitation for each chosen card
 *   POST { action: 'remind' }              the details form again, for the stuck (48h+)
 *   PATCH { cardId, email }                the address a row was missing
 *
 * The rows are parsed from the file in the manager's browser (lib/xlsx/read + sheet-import);
 * the file itself never reaches this route, and cleanRows keeps only the fields the app uses.
 */
export async function GET(request: Request) {
  try {
    const { denied } = await requireAcademyManager(request);
    if (denied) return denied;
    const supabase = createServerClient();
    const [{ coaches, bands }, rows] = await Promise.all([loadCoachesAndBands(supabase), loadImportBoard(supabase)]);
    return NextResponse.json({ coaches, bands, rows });
  } catch (err) {
    console.error('GET /api/academy/import error:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { denied, caller } = await requireAcademyManager(request);
    if (denied) return denied;
    const b = await request.json().catch(() => ({})) as Record<string, unknown>;
    const supabase = createServerClient();
    const action = String(b.action || '');
    if (action === 'preview') {
      const rows = cleanRows(b.rows);
      if (!rows.length) return NextResponse.json({ error: 'no rows' }, { status: 400 });
      const { coaches, bands } = await loadCoachesAndBands(supabase);
      return NextResponse.json({ ...(await previewImport(supabase, rows)), coaches, bands });
    }
    if (action === 'commit') {
      const rows = cleanRows(b.rows);
      if (!rows.length) return NextResponse.json({ error: 'no rows' }, { status: 400 });
      const asMap = (v: unknown) => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
      const coachMap = Object.fromEntries(Object.entries(asMap(b.coachMap)).map(([k, v]) => [k.trim(), typeof v === 'string' ? v : null]));
      const links = Object.fromEntries(Object.entries(asMap(b.links)).filter(([, v]) => typeof v === 'string') as Array<[string, string]>);
      const skip = Array.isArray(b.skip) ? b.skip.filter((x): x is string => typeof x === 'string') : [];
      return NextResponse.json(await commitImport(supabase, caller, { rows, coachMap, links, skip }));
    }
    if (action === 'invite') {
      const ids = Array.isArray(b.cardIds) ? [...new Set(b.cardIds.filter((x): x is string => typeof x === 'string'))].slice(0, 100) : [];
      if (!ids.length) return NextResponse.json({ error: 'cardIds is required' }, { status: 400 });
      return NextResponse.json({ results: await inviteImported(supabase, caller, ids) });
    }
    if (action === 'remind') return NextResponse.json({ reminded: await remindStuck(supabase) });
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('POST /api/academy/import error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { denied } = await requireAcademyManager(request);
    if (denied) return denied;
    const b = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof b.cardId !== 'string' || typeof b.email !== 'string') return NextResponse.json({ error: 'cardId and email are required' }, { status: 400 });
    return await setCardEmail(createServerClient(), b.cardId, b.email);
  } catch (err) {
    console.error('PATCH /api/academy/import error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
