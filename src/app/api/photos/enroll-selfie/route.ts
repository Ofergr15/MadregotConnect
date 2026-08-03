/**
 * POST /api/photos/enroll-selfie
 * Content-Type: multipart/form-data; field: "file"
 *
 * Enrolls the authenticated athlete's selfie as a reference face.
 * - Validates exactly one face in the image (clear error if 0 or 2+).
 * - Stores the selfie in the reference-faces bucket (private).
 * - Indexes in Rekognition with ExternalImageId = athleteId.
 * - Replaces any existing selfie (deletes old Rekognition face + storage object).
 * - Runs the backfill and returns how many photos were newly tagged.
 *
 * Identity comes from the JWT — the athlete cannot enroll as someone else.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/auth/verify';
import { createServerClient } from '@/lib/supabase/server';
import { detectFaces, indexFace, deleteFace } from '@/lib/rekognition/client';
import { backfillAthlete } from '@/lib/photos/backfill';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const user = await verifyRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'file field is required' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate face count — must be exactly one
    const faces = await detectFaces(buffer);
    if (faces.length === 0) {
      return NextResponse.json(
        { error: 'No face detected in your photo. Please use a clear front-facing selfie.' },
        { status: 422 }
      );
    }
    if (faces.length > 1) {
      return NextResponse.json(
        { error: `${faces.length} faces detected. Please use a photo with only your face.` },
        { status: 422 }
      );
    }

    const supabase = createServerClient();

    // Delete any existing selfie for this athlete
    const { data: existing } = await supabase
      .from('athlete_faces')
      .select('id, rekognition_face_id')
      .eq('athlete_id', user.athleteId)
      .eq('origin', 'selfie')
      .maybeSingle();

    if (existing) {
      // Remove old face from Rekognition collection
      try { await deleteFace(existing.rekognition_face_id); } catch { /* ignore */ }
      // Remove old storage object
      const { data: oldUrl } = await supabase
        .from('athlete_faces')
        .select('source_face_id')
        .eq('id', existing.id)
        .maybeSingle();
      // Delete storage — path follows athletes/{athleteId}/selfie.*
      await supabase.storage
        .from('reference-faces')
        .remove([`athletes/${user.athleteId}`]);
      // Delete DB row
      await supabase.from('athlete_faces').delete().eq('id', existing.id);
      void oldUrl; // suppress unused var
    }

    // Store selfie in reference-faces bucket (private)
    const ext = (file as File).type === 'image/png' ? 'png' : 'jpg';
    const storagePath = `athletes/${user.athleteId}/selfie.${ext}`;
    await supabase.storage
      .from('reference-faces')
      .upload(storagePath, buffer, {
        contentType: (file as File).type || 'image/jpeg',
        upsert: true,
      });

    // Index in Rekognition as a reference face with ExternalImageId = athleteId
    const faceId = await indexFace(buffer, user.athleteId);

    // Save to athlete_faces
    await supabase.from('athlete_faces').insert({
      athlete_id: user.athleteId,
      rekognition_face_id: faceId,
      origin: 'selfie',
      source_face_id: null,
    });

    // Backfill — find every already-imported photo this athlete appears in
    const tagged = await backfillAthlete(user.athleteId, faceId);

    return NextResponse.json({ enrolled: true, photosFound: tagged });
  } catch (error: unknown) {
    console.error('POST /api/photos/enroll-selfie error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
