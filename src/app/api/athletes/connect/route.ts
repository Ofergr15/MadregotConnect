import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/encryption';

export async function POST(req: NextRequest) {
  try {
    const { inviteToken, garminAuth, name, email, groupId } = await req.json();

    if (!inviteToken || !garminAuth) {
      return NextResponse.json(
        { error: 'inviteToken and garminAuth are required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const { data: athlete, error: findError } = await supabase
      .from('athletes')
      .select('id')
      .eq('invite_token', inviteToken)
      .single();

    if (findError || !athlete) {
      return NextResponse.json(
        { error: 'Invalid or expired invite link' },
        { status: 404 }
      );
    }

    const updateData: Record<string, any> = {
      garmin_auth: typeof garminAuth === 'string' ? garminAuth : encrypt(garminAuth),
      status: 'active',
      invite_token: null,
    };

    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (groupId) updateData.group_id = groupId;

    const { error: updateError } = await supabase
      .from('athletes')
      .update(updateData)
      .eq('id', athlete.id);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to save connection' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal error' },
      { status: 500 }
    );
  }
}
