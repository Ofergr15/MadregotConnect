import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Upload a manual profile photo → avatars bucket → save on the athlete.
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    const athleteId = form.get('athleteId') as string | null;

    if (!file || !athleteId) {
      return NextResponse.json({ error: 'file and athleteId required' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'file must be an image' }, { status: 400 });
    }

    const supabase = createServerClient();
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());
    // Stable path per athlete (upsert) so re-uploads overwrite; cache-bust via ?v=.
    const path = `${athleteId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, buffer, { contentType: file.type, upsert: true });
    if (uploadError) {
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const avatarUrl = `${urlData.publicUrl}?v=${Date.now()}`;

    const { error: updateError } = await supabase
      .from('athletes')
      .update({ avatar_url: avatarUrl })
      .eq('id', athleteId);
    if (updateError) throw updateError;

    return NextResponse.json({ avatarUrl });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
