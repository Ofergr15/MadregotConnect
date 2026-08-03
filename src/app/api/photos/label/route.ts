/**
 * POST /api/photos/label
 * Body: { faceId: string, athleteId: string }
 * Staff only.
 *
 * Manually tags an unidentified detected face. If the athlete has no reference
 * face yet, this crop is promoted to a reference (origin='coach_label') and the
 * backfill runs so future photos auto-tag.
 *
 * DELETE /api/photos/label
 * Body: { faceId: string }
 * Staff only. Removes a wrong tag. If the face was also used as a reference face
 * it's deleted from the Rekognition collection too.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, isStaff } from '@/lib/auth/verify';
import { createServerClient } from '@/lib/supabase/server';
import { indexFace, deleteFace } from '@/lib/rekognition/client';
import { backfillAthlete } from '@/lib/photos/backfill';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const user = await verifyRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isStaff(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { faceId: detectedFaceId, athleteId } = (await req.json()) as {
      faceId?: string;
      athleteId?: string;
    };
    if (!detectedFaceId || !athleteId) {
      return NextResponse.json({ error: 'faceId and athleteId are required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Fetch the detected face record
    const { data: face, error: faceErr } = await supabase
      .from('detected_faces')
      .select('id, crop_url, rekognition_face_id, athlete_id')
      .eq('id', detectedFaceId)
      .maybeSingle();

    if (faceErr || !face) {
      return NextResponse.json({ error: 'Face not found' }, { status: 404 });
    }

    // Tag it
    await supabase
      .from('detected_faces')
      .update({ athlete_id: athleteId, source: 'manual', confidence: null })
      .eq('id', detectedFaceId);

    // Check if athlete already has a reference face
    const { data: existingRef } = await supabase
      .from('athlete_faces')
      .select('id')
      .eq('athlete_id', athleteId)
      .maybeSingle();

    let photosTagged = 0;

    if (!existingRef && face.crop_url && face.rekognition_face_id) {
      // Promote this crop to a reference face
      // Re-index with ExternalImageId = athleteId (crops are small JPEGs from Storage;
      // we need to re-fetch the buffer)
      let refFaceId = face.rekognition_face_id;
      try {
        const cropRes = await fetch(face.crop_url);
        const buffer = Buffer.from(await cropRes.arrayBuffer());
        refFaceId = await indexFace(buffer, athleteId);
      } catch {
        // Fall back to using the already-indexed faceId as the reference
      }

      await supabase.from('athlete_faces').insert({
        athlete_id: athleteId,
        rekognition_face_id: refFaceId,
        origin: 'coach_label',
        source_face_id: detectedFaceId,
      });

      photosTagged = await backfillAthlete(athleteId, refFaceId);
    }

    return NextResponse.json({ labeled: true, photosTagged });
  } catch (error: unknown) {
    console.error('POST /api/photos/label error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await verifyRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isStaff(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { faceId: detectedFaceId } = (await req.json()) as { faceId?: string };
    if (!detectedFaceId) {
      return NextResponse.json({ error: 'faceId is required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Fetch to check if this face is also a reference
    const { data: face } = await supabase
      .from('detected_faces')
      .select('rekognition_face_id')
      .eq('id', detectedFaceId)
      .maybeSingle();

    if (face?.rekognition_face_id) {
      // Remove from Rekognition collection if it was used as a reference
      const { data: ref } = await supabase
        .from('athlete_faces')
        .select('id, rekognition_face_id')
        .eq('source_face_id', detectedFaceId)
        .maybeSingle();
      if (ref) {
        try { await deleteFace(ref.rekognition_face_id); } catch { /* ignore */ }
        await supabase.from('athlete_faces').delete().eq('id', ref.id);
      }
    }

    // Clear the tag (keep the detected face row, just remove the athlete link)
    await supabase
      .from('detected_faces')
      .update({ athlete_id: null, confidence: null, source: 'auto' })
      .eq('id', detectedFaceId);

    return NextResponse.json({ untagged: true });
  } catch (error: unknown) {
    console.error('DELETE /api/photos/label error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
