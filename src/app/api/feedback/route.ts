import { NextResponse } from 'next/server';
import { DEFAULT_PRIORITY, parsePriority } from '@/lib/feedback/queue';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { notifyAthlete } from '@/lib/push';
import { problemReportCopy } from '@/lib/notifications/copy';
import { notifyStaff } from '@/lib/notifications/staff';
import { shouldNotifyReporter, type ResolutionStatus } from '@/lib/feedback-resolution';
import { notifyReportResolved } from '@/lib/feedback-notify';

// App feedback ("ביקורת"): athletes file it from /dashboard/review, staff
// triage it from the admin settings page. Submitting is self-only, reading and
// triaging are staff-only — the whole route used to be unauthenticated, so a
// plain GET returned every athlete's feedback (name, email, attached photos)
// and a DELETE/PATCH with an id was enough to wipe or rewrite any of it.
export async function POST(request: Request) {
  try {
    const { message, category, image, context, priority } = await request.json();

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
      // The reporter's own read of how urgent it is; anything else is filed as normal.
      priority: parsePriority(priority) ?? DEFAULT_PRIORITY,
      image_url: image || null,
    };

    // `context` (migration 093) is the auto-collected diagnostics — page, app
    // version, device. Migrations here are applied by hand, so asking for a
    // column that doesn't exist yet must not cost us the report itself: on
    // 42703 (undefined_column) the insert is retried without it. Losing the
    // diagnostics is a downgrade; losing a bug report is a bug.
    let { data: inserted, error } = await supabase.from('feedback').insert({ ...row, context: context ?? null }).select('id').single();
    if (error && (error as { code?: string }).code === '42703') {
      ({ data: inserted, error } = await supabase.from('feedback').insert(row).select('id').single());
    }

    if (error) throw error;

    // The shareable number (migration 120), read back on its own so a missing
    // column costs the reporter the "#84" line and nothing else — the report is
    // already saved by now.
    let ticketNo: number | null = null;
    if (inserted?.id) {
      const { data: numbered } = await supabase.from('feedback').select('ticket_no').eq('id', inserted.id).maybeSingle();
      ticketNo = (numbered as { ticket_no?: number | null } | null)?.ticket_no ?? null;
    }

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

    return NextResponse.json({ success: true, ticket_no: ticketNo });
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
      const mine = (columns: string) => supabase
        .from('feedback')
        .select(columns)
        .eq('athlete_id', caller.athleteId)
        .order('created_at', { ascending: false })
        .limit(20);

      // `fixed_in_version` and `verified_at` are migration 116: the reporter's own
      // list is where they confirm a fix, and it can't ask without knowing which
      // version claims to carry it. Retried narrow on 42703 so the list keeps
      // working — without the confirm button, which is the honest degrade — until
      // the migration is applied. `context` is NOT selected: it is a diagnostics
      // blob the reporter has already seen once and the list doesn't render.
      // `ticket_no` is migration 120, tried first and dropped on its own 42703 so
      // an unapplied 120 doesn't also cost the confirm button 116 brings.
      let { data, error } = await mine('id, ticket_no, message, category, status, created_at, fixed_in_version, verified_at');
      if (error && (error as { code?: string }).code === '42703') {
        ({ data, error } = await mine('id, message, category, status, created_at, fixed_in_version, verified_at'));
      }
      if (error && (error as { code?: string }).code === '42703') {
        ({ data, error } = await mine('id, message, category, status, created_at'));
      }
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

    const body = await request.json();

    // ── The work queue, reordered ──
    // One drag renumbers the whole queue (see lib/feedback/queue.ts), so it
    // arrives as one request rather than a PATCH per row: a dozen racing writes
    // could land half an order if the phone dropped off mid-way.
    if (Array.isArray(body.order)) {
      const supabase = createServerClient();
      const valid = (body.order as { id?: unknown; sort_order?: unknown; priority?: unknown }[])
        .filter(u => typeof u.id === 'string' && Number.isInteger(u.sort_order)
          && parsePriority(u.priority) !== null)
        .slice(0, 200);
      const results = await Promise.all(valid.map(u => supabase
        .from('feedback')
        .update({ sort_order: u.sort_order, priority: u.priority })
        .eq('id', u.id as string)));
      const failed = results.find(r => r.error);
      if (failed?.error) throw failed.error;
      return NextResponse.json({ success: true, updated: valid.length });
    }

    const { id, status, priority, admin_notes, sort_order } = body;

    if (!id) {
      return NextResponse.json({ error: 'Feedback ID is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const updateData: any = {};
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) {
      if (parsePriority(priority) === null) return NextResponse.json({ error: 'bad priority' }, { status: 400 });
      updateData.priority = priority;
    }
    if (admin_notes !== undefined) updateData.admin_notes = admin_notes;
    if (sort_order !== undefined) updateData.sort_order = sort_order;

    // ── Migration 116: what fixed it, who decided it, and what it duplicates ──
    // Split out because these columns may not exist yet, and a 42703 on the whole
    // UPDATE would lose the status change too — which is the part of the request
    // that has always worked and must keep working. Applied as a second write.
    const lifecycle: any = {};
    for (const key of ['fixed_in_version', 'fix_branch', 'fix_commit', 'triage_note'] as const) {
      if (body[key] !== undefined) lifecycle[key] = body[key] || null;
    }
    // Explicit null clears a mistaken merge; an id sets it. Never the row itself:
    // a report that duplicates itself belongs to no view (see lifecycle.ts).
    if (body.duplicate_of !== undefined) {
      lifecycle.duplicate_of = body.duplicate_of && body.duplicate_of !== id ? body.duplicate_of : null;
    }
    // A boolean from the client, a timestamp in the row — the client's clock is
    // not evidence of when anything happened.
    if (body.archived !== undefined) {
      lifecycle.archived_at = body.archived ? new Date().toISOString() : null;
    }
    // Who decided, stamped by the server whenever a decision is being recorded.
    // `admin_notes` alone is a note, not a decision, so it doesn't stamp.
    if (status !== undefined || body.triage_note !== undefined) {
      const { caller } = await resolveVerifiedCaller(request);
      lifecycle.triaged_by = caller?.email || 'staff';
      lifecycle.triaged_at = new Date().toISOString();
    }

    // Read the row BEFORE writing, to learn what the status was. That's the only
    // way to tell "just marked done" from "was already done and the note
    // changed" — see shouldNotifyReporter for why the difference matters.
    const { data: before } = await supabase
      .from('feedback')
      .select('athlete_id, status, message, ticket_no')
      .eq('id', id)
      .maybeSingle<{ athlete_id: string | null; status: ResolutionStatus; message: string | null; ticket_no: number | null }>();

    const { error } = await supabase
      .from('feedback')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;

    // Second write, and its failure is reported rather than thrown: the triage the
    // coach just performed is already saved, and a missing migration must not read
    // back as "nothing happened".
    let lifecycleSaved = true;
    if (Object.keys(lifecycle).length > 0) {
      const { error: lifecycleError } = await supabase.from('feedback').update(lifecycle).eq('id', id);
      if (lifecycleError) {
        lifecycleSaved = false;
        console.error('Feedback lifecycle update failed (migration 116 applied?):', lifecycleError.message);
      }
    }

    // ── Migration 117: "not a bug" is counted against the detector, in the open ──
    // A detector that was wrong three times out of four has to LOOK wrong on the
    // board, because the damage a noisy detector does is not the alerts — it is
    // that the accurate ones stop being believed too. So a denial of a finding is
    // recorded on the detector rather than only on the row, and the whole block
    // is best-effort: rejecting a finding must never fail because of bookkeeping.
    if (status === 'denied') {
      const { data: finding } = await supabase
        .from('feedback').select('source, detector').eq('id', id).maybeSingle<{
          source: string | null; detector: string | null;
        }>();
      if (finding?.source === 'detector' && finding.detector) {
        const { data: state } = await supabase
          .from('bug_detectors').select('false_positive_count').eq('key', finding.detector)
          .maybeSingle<{ false_positive_count: number | null }>();
        await supabase.from('bug_detectors').upsert(
          {
            key: finding.detector,
            false_positive_count: (state?.false_positive_count || 0) + 1,
          },
          { onConflict: 'key' },
        );
      }
    }

    // Close the loop: the reporter did unpaid work for us, and the only thing
    // that makes anyone report a second bug is finding out the first one led
    // somewhere. Awaited rather than fired-and-forgotten — on a serverless
    // function the response ends the invocation, so a dangling promise here is a
    // notification that sometimes doesn't get sent. Caught, though: the triage
    // save already succeeded, and a push failure must not report it as a 500 and
    // send the coach back to re-click a button that already worked.
    if (before && shouldNotifyReporter(before.status, status, before.athlete_id)) {
      try {
        // The send itself lives in lib/feedback-notify.ts, which the cron pass
        // also calls — so the two paths share one ledger and one piece of copy.
        // This one stays here, immediate, because a coach who just marked
        // something done should see it land now rather than within five minutes;
        // the cron is the safety net for every OTHER way a report gets closed,
        // which in practice is nearly all of them (9a818a94).
        await notifyReportResolved(supabase, {
          id,
          athlete_id: before.athlete_id,
          message: before.message,
          ticket_no: before.ticket_no,
          // Straight off this request, not re-read: the version the coach typed in
          // the same save is the one that fixed it.
          fixed_in_version: lifecycleSaved ? (body.fixed_in_version ?? null) : null,
        });
      } catch (pushError) {
        console.error('Feedback resolved notify failed:', pushError);
      }
    }

    return NextResponse.json({ success: true, lifecycleSaved });
  } catch (error: any) {
    console.error('Feedback update error:', error);
    return NextResponse.json({ error: error.message || 'Failed to update' }, { status: 500 });
  }
}

/**
 * The reporter confirming their own report is actually fixed.
 *
 * `status = 'done'` is staff's opinion, and it is the one the whole panel was
 * built on — which is why a report could read as closed while the person who
 * filed it was still watching the bug happen on a stale service worker. This is
 * the other half: `verified_at` is set by the REPORTER and by nobody else.
 *
 * Not a widening of the route's surface. `resolveVerifiedCaller` gives the
 * session's athlete id, the UPDATE is filtered on `athlete_id` as well as `id`, so
 * the only row a caller can ever touch is one they filed — an id from the body
 * that belongs to somebody else matches nothing and changes nothing.
 */
export async function PUT(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.athleteId) return NextResponse.json({ error: 'no-athlete' }, { status: 403 });

    const { id, verified } = await request.json();
    if (!id) return NextResponse.json({ error: 'Feedback ID is required' }, { status: 400 });

    const supabase = createServerClient();
    const { error } = await supabase
      .from('feedback')
      .update({ verified_at: verified === false ? null : new Date().toISOString() })
      .eq('id', id)
      .eq('athlete_id', caller.athleteId);

    // Migration 116 not applied yet. A 400 here would surface on the reporter's
    // screen as their confirmation being rejected, which is the worst possible
    // place to be honest about our own schema — so it reports the column, and the
    // button is hidden anyway until the list comes back carrying `verified_at`.
    if (error && (error as { code?: string }).code === '42703') {
      return NextResponse.json({ error: 'not-available' }, { status: 503 });
    }
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Feedback verify error:', error);
    return NextResponse.json({ error: error.message || 'Failed to verify' }, { status: 500 });
  }
}
