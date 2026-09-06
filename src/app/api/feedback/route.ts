import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { notifyAthlete } from '@/lib/push';
import { problemReportCopy, reviewResolvedCopy } from '@/lib/notifications/copy';
import { notifyStaff } from '@/lib/notifications/staff';
import { shouldNotifyReporter, type ResolutionStatus } from '@/lib/feedback-resolution';

// App feedback ("ביקורת"): athletes file it from /dashboard/review, staff
// triage it from the admin settings page. Submitting is self-only, reading and
// triaging are staff-only — the whole route used to be unauthenticated, so a
// plain GET returned every athlete's feedback (name, email, attached photos)
// and a DELETE/PATCH with an id was enough to wipe or rewrite any of it.
export async function POST(request: Request) {
  try {
    const { message, category, image, context } = await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // `image` is a base64 data URL stored in a TEXT column, so there has to be a
    // ceiling somewhere, and a Postgres error is a terrible place to find it.
    // The client downscales to ~1280px/JPEG before sending (see compressImage),
    // which lands well under this; anything above it is a client that didn't.
    if (typeof image === 'string' && image.length > 2_000_000) {
      return NextResponse.json({ error: 'image-too-large' }, { status: 413 });
    }

    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const supabase = createServerClient();

    // Who filed it comes from the session, not the body. The old route stamped
    // athlete_id/name/email straight from the POST, so anyone could file
    // feedback in another athlete's name. A staff account with no `athletes`
    // row still gets attributed by its login email.
    let athleteName = caller.email;
    let athleteEmail: string | null = caller.email || null;
    let groupName: string | null = null;
    if (caller.athleteId) {
      const { data: me } = await supabase
        .from('athletes')
        .select('name, email, groups(name)')
        .eq('id', caller.athleteId)
        .maybeSingle<{ name: string | null; email: string | null; groups: { name: string | null } | null }>();
      if (me) {
        athleteName = me.name || athleteName;
        athleteEmail = me.email || athleteEmail;
        groupName = me.groups?.name || null;
      }
    }

    const row = {
      athlete_id: caller.athleteId,
      athlete_name: athleteName || 'Anonymous',
      athlete_email: athleteEmail,
      group_name: groupName,
      message: message.trim(),
      category: category || 'general',
      image_url: image || null,
    };

    // `context` (migration 093) is the auto-collected diagnostics — page, app
    // version, device. Migrations here are applied by hand, so asking for a
    // column that doesn't exist yet must not cost us the report itself: on
    // 42703 (undefined_column) the insert is retried without it. Losing the
    // diagnostics is a downgrade; losing a bug report is a bug.
    let { error } = await supabase.from('feedback').insert({ ...row, context: context ?? null });
    if (error && (error as { code?: string }).code === '42703') {
      ({ error } = await supabase.from('feedback').insert(row));
    }

    if (error) throw error;

    // Tell the staff. Nothing surfaced a report until somebody thought to open
    // the review screen, which for a "something is broken" channel is exactly
    // backwards — the whole point is that the club shouldn't have to chase us.
    // After the insert and outside its error path: a notification failure must
    // never turn a saved report into a 500 the reporter reads as "not sent".
    await notifyStaff({
      kind: 'problem_report',
      url: '/dashboard/review',
      // Per-reporter rather than per-report: a second report from the same
      // person before anyone has looked replaces the first notification instead
      // of adding to the pile.
      tag: `problem-report-${caller.athleteId || athleteEmail || 'anon'}`,
      category: 'management',
      actorAthleteId: caller.athleteId || null,
      copy: (locale) => problemReportCopy(locale, { athleteName: athleteName, preview: row.message }),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Feedback submit error:', error);
    return NextResponse.json({ error: error.message || 'Failed to submit' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    // `?mine=1` — the reporter's own reports and their status, which is what
    // turns this from a suggestion box into a channel: a report you can't see
    // the fate of is indistinguishable from one nobody read. Scoped to the
    // SESSION's athlete id (never an id from the query string), and it returns a
    // narrow column list on purpose: `admin_notes` is staff triage shorthand and
    // is not for the reporter.
    if (new URL(request.url).searchParams.get('mine') === '1') {
      const { denied, caller } = await resolveVerifiedCaller(request);
      if (denied) return denied;
      if (!caller.athleteId) return NextResponse.json({ feedback: [] });

      const supabase = createServerClient();
      const { data, error } = await supabase
        .from('feedback')
        .select('id, message, category, status, created_at')
        .eq('athlete_id', caller.athleteId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return NextResponse.json({ feedback: data || [] });
    }

    const denied = await requireStaff(request);
    if (denied) return denied;

    const supabase = createServerClient();

    // `?count=1` — just the totals, for the "N reports, M new" link on the
    // review screen. It exists so that badge doesn't have to download the whole
    // list to render a number; `head: true` sends no rows at all. (It was added
    // when the list still inlined every screenshot and so ran to megabytes — the
    // list is small now, but a count is still the right request for a count.)
    if (new URL(request.url).searchParams.get('count') === '1') {
      const [total, fresh] = await Promise.all([
        supabase.from('feedback').select('id', { count: 'exact', head: true }),
        supabase.from('feedback').select('id', { count: 'exact', head: true }).or('status.is.null,status.eq.new'),
      ]);
      if (total.error) throw total.error;
      return NextResponse.json({ total: total.count ?? 0, new: fresh.count ?? 0 });
    }

    // `?image=<id>` — one report's screenshot, fetched only when a staff member
    // actually opens that report. See the list below for why it isn't inlined.
    const imageId = new URL(request.url).searchParams.get('image');
    if (imageId) {
      const { data, error } = await supabase
        .from('feedback')
        .select('image_url')
        .eq('id', imageId)
        .maybeSingle();
      if (error) throw error;
      return NextResponse.json({ image_url: data?.image_url ?? null });
    }

    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    // The screenshots do not travel with the list. They are stored as base64 in
    // the row, and measured on the real table they were 366 KB of a 370 KB
    // response — 98% — with one report alone at 284 KB. The list renders no
    // images at all; only the detail sheet does, one report at a time. So the
    // list says whether there is one and the sheet fetches it via `?image=`.
    const feedback = (data || []).map(({ image_url, ...row }) => ({
      ...row,
      has_image: !!image_url,
    }));
    return NextResponse.json({ feedback });
  } catch (error: any) {
    console.error('Feedback fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const denied = await requireStaff(request);
    if (denied) return denied;

    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Feedback ID is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { error } = await supabase
      .from('feedback')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Feedback delete error:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const denied = await requireStaff(request);
    if (denied) return denied;

    const { id, status, priority, admin_notes, sort_order } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Feedback ID is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const updateData: any = {};
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (admin_notes !== undefined) updateData.admin_notes = admin_notes;
    if (sort_order !== undefined) updateData.sort_order = sort_order;

    // Read the row BEFORE writing, to learn what the status was. That's the only
    // way to tell "just marked done" from "was already done and the note
    // changed" — see shouldNotifyReporter for why the difference matters.
    const { data: before } = await supabase
      .from('feedback')
      .select('athlete_id, status, message')
      .eq('id', id)
      .maybeSingle<{ athlete_id: string | null; status: ResolutionStatus; message: string | null }>();

    const { error } = await supabase
      .from('feedback')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;

    // Close the loop: the reporter did unpaid work for us, and the only thing
    // that makes anyone report a second bug is finding out the first one led
    // somewhere. Awaited rather than fired-and-forgotten — on a serverless
    // function the response ends the invocation, so a dangling promise here is a
    // notification that sometimes doesn't get sent. Caught, though: the triage
    // save already succeeded, and a push failure must not report it as a 500 and
    // send the coach back to re-click a button that already worked.
    if (before && shouldNotifyReporter(before.status, status, before.athlete_id)) {
      try {
        await notifyAthlete({
          athleteId: before.athlete_id!,
          // Deliberately absent from KIND_CATEGORY (src/lib/notifications/prefs.ts)
          // and sent with no `category`, so no preference toggle can mute it —
          // same treatment as `approval`. It's a direct answer to a message this
          // person sent us, not a stream of chatter they might want quieter.
          kind: 'review_resolved',
          actorAthleteId: null,
          url: '/dashboard/review',
          // One tag per report, so a re-resolved report replaces its own old
          // notification on the lock screen instead of stacking.
          tag: `review-resolved-${id}`,
          copy: (locale) => reviewResolvedCopy(locale, { preview: before.message }),
        });
      } catch (pushError) {
        console.error('Feedback resolved notify failed:', pushError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Feedback update error:', error);
    return NextResponse.json({ error: error.message || 'Failed to update' }, { status: 500 });
  }
}
