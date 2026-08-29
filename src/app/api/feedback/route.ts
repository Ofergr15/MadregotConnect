import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

// App feedback ("ביקורת"): athletes file it from /dashboard/review, staff
// triage it from the admin settings page. Submitting is self-only, reading and
// triaging are staff-only — the whole route used to be unauthenticated, so a
// plain GET returned every athlete's feedback (name, email, attached photos)
// and a DELETE/PATCH with an id was enough to wipe or rewrite any of it.
export async function POST(request: Request) {
  try {
    const { message, category, image } = await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
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

    const { error } = await supabase.from('feedback').insert({
      athlete_id: caller.athleteId,
      athlete_name: athleteName || 'Anonymous',
      athlete_email: athleteEmail,
      group_name: groupName,
      message: message.trim(),
      category: category || 'general',
      image_url: image || null,
    });

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Feedback submit error:', error);
    return NextResponse.json({ error: error.message || 'Failed to submit' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const denied = await requireStaff(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    return NextResponse.json({ feedback: data || [] });
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

    const { error } = await supabase
      .from('feedback')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Feedback update error:', error);
    return NextResponse.json({ error: error.message || 'Failed to update' }, { status: 500 });
  }
}
