import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const { athleteId, athleteName, athleteEmail, groupName, message } = await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { error } = await supabase.from('feedback').insert({
      athlete_id: athleteId || null,
      athlete_name: athleteName || 'Anonymous',
      athlete_email: athleteEmail || null,
      group_name: groupName || null,
      message: message.trim(),
    });

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Feedback submit error:', error);
    return NextResponse.json({ error: error.message || 'Failed to submit' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return NextResponse.json({ feedback: data || [] });
  } catch (error: any) {
    console.error('Feedback fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
