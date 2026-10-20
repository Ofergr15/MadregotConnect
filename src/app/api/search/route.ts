import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { isCoreRunner } from '@/lib/core-runner';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { containsPattern, quoteFilterValue } from '@/lib/db/like';
import { nameMatches } from '@/lib/search/match';
import { STORE_OPEN } from '@/lib/nav-items';
import { listPhotoFolders, signedImageUrl, THUMB, type PhotoFolder } from '@/lib/photos/drive-browse';
import { mirroredUrls } from '@/lib/photos/mirror';
import { israelToday } from '@/lib/utils';
import { EMPTY_RUNS, searchRuns } from '@/lib/search/runs';

export const dynamic = 'force-dynamic';

const MIN_QUERY_LENGTH = 2;
const RESULT_LIMIT = 8;

// GET /api/search?q=<query>
// Roadmap #17 — In-App Global Search. Members, events, plus the actual
// content inside Store and Benefits (product/perk names) — not just the
// section names, which the client-side "sections" category already covers.
//
// The old note here said feed posts were excluded because they "require a real
// Supabase JWT the way member/event/store/perk data doesn't". That was the bug,
// not the design: the members category is a name-prefix lookup over the whole
// active roster, which made this the easiest way to enumerate the club without
// an account. It's session-gated now, so adding feed posts is no longer a
// different auth model — just more categories.
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const supabase = createServerClient();
    // `?start=1`: what the screen shows before anything is typed (mockup search-mockup.html,
    // Ofer 2026-10-19) — the caller's pack, the next races, the newest photo albums.
    if (searchParams.get('start')) return NextResponse.json(await startOf(supabase, caller.athleteId));
    if (q.length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ members: [], events: [], products: [], perks: [], albums: [], runs: EMPTY_RUNS });
    }

    // `pattern` for the single-column helpers, `filterPattern` for the `.or()`
    // strings — see src/lib/db/like.ts for why they differ. Typing a comma used
    // to 400 the whole request; typing `_` used to match any character.
    const pattern = containsPattern(q);
    const filterPattern = quoteFilterValue(pattern);

    // Mirrors GET /api/perks's tier gate exactly — a core_runner-tier perk must
    // stay invisible to everyone else, including via search. Same fix, too: the
    // tier is the CALLER's own, not that of whatever id they sent. Reads the
    // גרעין FLAG (migration 091), so it agrees with /api/perks for a coach who is
    // also a core runner; if you change one of these gates, change both.
    // isCoreRunner(caller) rather than caller.isCoreRunner: the predicate also
    // reads the legacy `role = 'core_runner'`, so the entitlement survives any
    // caller shape that carries the role but not the flag.
    const seesCoreTier = isCoreRunner(caller) || caller.isStaff || caller.isSuperUser;

    let perksQuery = supabase
      .from('club_perks')
      .select('id, sponsor_name, title_he, title_en, image_url')
      .eq('active', true)
      .or(`title_he.ilike.${filterPattern},title_en.ilike.${filterPattern},sponsor_name.ilike.${filterPattern}`)
      .limit(RESULT_LIMIT);
    if (!seesCoreTier) perksQuery = perksQuery.eq('tier', 'all');

    const [membersRes, eventsRes, productsRes, perksRes] = await Promise.all([
      // The whole active roster (a few dozen rows), matched here: names are stored in
      // Latin letters, and a name typed in Hebrew has to meet them (lib/search/match.ts).
      supabase
        .from('athletes')
        .select('id, name, avatar_url, group_id')
        .eq('status', 'active')
        .order('name')
        .limit(1000),
      supabase
        .from('events')
        .select('id, name, kind, date, location')
        .or(`name.ilike.${filterPattern},location.ilike.${filterPattern}`)
        .order('date', { ascending: false })
        .limit(RESULT_LIMIT),
      // Products only while the store is offered (STORE_OPEN): hidden since 2026-10-19.
      !STORE_OPEN ? Promise.resolve({ data: [], error: null }) : supabase
        .from('store_products')
        .select('id, name_he, name_en, price, image_url')
        .eq('active', true)
        .or(`name_he.ilike.${filterPattern},name_en.ilike.${filterPattern}`)
        .limit(RESULT_LIMIT),
      perksQuery,
    ]);

    const matched = (membersRes.error ? [] : membersRes.data || [])
      .filter((a: { name: string | null }) => nameMatches(a.name, q))
      .slice(0, RESULT_LIMIT) as Array<{ id: string; name: string; avatar_url: string | null; group_id?: string | null }>;
    // What you can do with the person (mockup search-proposal, "אלון"): their pack and their
    // last run, for the top match's quick links.
    const [lastRuns, groupNames, runs] = await Promise.all([
      matched.length ? supabase.from('athlete_activities').select('id, athlete_id, start_time').in('athlete_id', matched.slice(0, 3).map((m) => m.id))
        .order('start_time', { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
      matched.length ? supabase.from('groups').select('id, name') : Promise.resolve({ data: [] }),
      searchRuns(supabase, q, caller),
    ]);
    const lastRunOf = new Map<string, string>();
    for (const r of (lastRuns.data || []) as Array<{ id: string; athlete_id: string }>) if (!lastRunOf.has(r.athlete_id)) lastRunOf.set(r.athlete_id, r.id);
    const groupName = new Map(((groupNames.data || []) as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]));
    const members = matched.map((a) => ({
      id: a.id,
      name: a.name,
      avatarUrl: a.avatar_url || null,
      pack: a.group_id ? groupName.get(a.group_id) ?? null : null,
      lastRunId: lastRunOf.get(a.id) ?? null,
    }));

    // events (migration 055) may not be applied in every environment —
    // degrade to no event results rather than failing the whole search.
    const events = (eventsRes.error ? [] : eventsRes.data || []).map(
      (e: { id: string; name: string; kind: string; date: string; location: string }) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        date: e.date,
        location: e.location,
      }),
    );

    // store_products/club_perks (migrations 064/066) may not be applied in
    // every environment — degrade to no results rather than failing search.
    const products = (productsRes.error ? [] : productsRes.data || []).map(
      (p: { id: string; name_he: string; name_en: string; price: number; image_url: string | null }) => ({
        id: p.id,
        nameHe: p.name_he,
        nameEn: p.name_en,
        price: p.price,
        imageUrl: p.image_url,
      }),
    );

    const perks = (perksRes.error ? [] : perksRes.data || []).map(
      (p: { id: string; sponsor_name: string; title_he: string; title_en: string; image_url: string | null }) => ({
        id: p.id,
        sponsorName: p.sponsor_name,
        titleHe: p.title_he,
        titleEn: p.title_en,
        imageUrl: p.image_url,
      }),
    );

    const albums = (await foldersInTime())
      .filter((f) => `${f.title ?? ''} ${f.name}`.toLowerCase().includes(q.toLowerCase()))
      .slice(0, RESULT_LIMIT);
    return NextResponse.json({ members, events, products, perks, albums: await albumRows(albums), runs });
  } catch (error) {
    console.error('Search failed:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

type Db = ReturnType<typeof createServerClient>;

/**
 * The photo folders, or none if Drive is slow: the listing is cached for ten minutes
 * (lib/photos/drive-browse.ts) but a cold one takes ~12s, and search must not wait on it.
 */
async function foldersInTime(ms = 2500): Promise<PhotoFolder[]> {
  const list = listPhotoFolders().catch(() => null);
  const late = new Promise<null>((r) => setTimeout(() => r(null), ms));
  return (await Promise.race([list, late])) ?? [];
}

async function albumRows(folders: PhotoFolder[]) {
  const m = await mirroredUrls(folders.map((f) => f.covers[0]).filter(Boolean)).catch(() => null);
  return folders.map((f) => ({
    id: f.id,
    title: f.title || f.name,
    date: f.date,
    count: f.count,
    cover: f.covers[0] ? m?.thumb[f.covers[0]] ?? signedImageUrl(f.covers[0], THUMB) : null,
  }));
}

/** Before typing: the caller's pack, the next three races, the three newest albums. */
async function startOf(supabase: Db, athleteId: string | null | undefined) {
  const today = israelToday();
  const { data: me } = athleteId
    ? await supabase.from('athletes').select('group_id').eq('id', athleteId).maybeSingle()
    : { data: null };
  const groupId = (me as { group_id?: string | null } | null)?.group_id ?? null;
  const [packRes, groupRes, racesRes, folders] = await Promise.all([
    groupId
      ? supabase.from('athletes').select('id, name, avatar_url').eq('group_id', groupId).eq('status', 'active').neq('id', athleteId as string).order('name').limit(30)
      : Promise.resolve({ data: [], error: null }),
    groupId ? supabase.from('groups').select('name').eq('id', groupId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('events').select('id, name, kind, date, location').eq('kind', 'race').gte('date', today).order('date').limit(3),
    foldersInTime(),
  ]);
  return {
    pack: ((packRes.error ? [] : packRes.data) || []).map((a: { id: string; name: string; avatar_url: string | null }) => ({ id: a.id, name: a.name, avatarUrl: a.avatar_url })),
    packName: (groupRes.data as { name?: string } | null)?.name ?? null,
    races: ((racesRes.error ? [] : racesRes.data) || []) as Array<{ id: string; name: string; kind: string; date: string; location: string }>,
    // The pinned folder leads the photos home; here it is the newest that matter.
    albums: await albumRows(folders.filter((f) => !f.pinned).slice(0, 3)),
    today,
  };
}


