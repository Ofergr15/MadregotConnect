/**
 * POST /api/photos/process
 * Body: { photoId: string }
 *
 * Processes ONE photo: download from Drive, detect faces, crop each, index in
 * Rekognition, search for matches against enrolled reference faces, write
 * detected_faces rows, mark processed_at.
 *
 * One photo per request — ~50 photos × ~5 faces would exceed Vercel's 300s
 * ceiling in a single call. The client loops over the photoIds from /import.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, isStaff } from '@/lib/auth/verify';
import { createServerClient } from '@/lib/supabase/server';
import { downloadFile } from '@/lib/google-drive/client';
import { detectFaces, indexFace, searchByFaceId } from '@/lib/rekognition/client';
import { cropFace } from '@/lib/photos/crop';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const user = await verifyRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isStaff(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { photoId } = (await req.json()) as { photoId?: string };
    if (!photoId) return NextResponse.json({ error: 'photoId is required' }, { status: 400 });

    const supabase = createServerClient();

    // Fetch the photo record
    const { data: photo, error: photoErr } = await supabase
      .from('run_photos')
      .select('id, drive_file_id, processed_at')
      .eq('id', photoId)
      .maybeSingle();

    if (photoErr || !photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
    }
    if (photo.processed_at) {
      return NextResponse.json({ status: 'already_processed', facesDetected: 0 });
    }

    // Download original from Drive
    const imageBuffer = await downloadFile(photo.drive_file_id);

    // Detect all faces
    const boxes = await detectFaces(imageBuffer);

    // Load enrolled reference faces so we can auto-tag on match
    const { data: refFaces } = await supabase
      .from('athlete_faces')
      .select('athlete_id, rekognition_face_id');
    const refFaceIdToAthlete = new Map(
      (refFaces ?? []).map(f => [f.rekognition_face_id, f.athlete_id])
    );

    const detectedRows: Array<{
      photo_id: string;
      bounding_box: object;
      crop_url: string | null;
      rekognition_face_id: string;
      athlete_id: string | null;
      confidence: number | null;
      source: string;
    }> = [];

    for (const box of boxes) {
      try {
        // Crop this face
        const cropBuffer = await cropFace(imageBuffer, box.boundingBox);

        // Upload crop to Supabase Storage (face-crops bucket, public)
        const cropPath = `${photo.id}/${crypto.randomUUID()}.jpg`;
        const { error: uploadErr } = await supabase.storage
          .from('face-crops')
          .upload(cropPath, cropBuffer, { contentType: 'image/jpeg', upsert: false });

        const cropUrl = uploadErr
          ? null
          : supabase.storage.from('face-crops').getPublicUrl(cropPath).data.publicUrl;

        // Index in Rekognition (no ExternalImageId — this is a detected, not reference, face)
        const faceId = await indexFace(cropBuffer);

        // Search for a matching reference face
        let athleteId: string | null = null;
        let confidence: number | null = null;
        const matches = await searchByFaceId(faceId, 80, 10);
        for (const match of matches) {
          const candidate = refFaceIdToAthlete.get(match.faceId);
          if (candidate) {
            athleteId = candidate;
            confidence = match.similarity;
            break; // take best match
          }
        }

        detectedRows.push({
          photo_id: photo.id,
          bounding_box: box.boundingBox,
          crop_url: cropUrl,
          rekognition_face_id: faceId,
          athlete_id: athleteId,
          confidence,
          source: athleteId ? 'auto' : 'auto',
        });
      } catch (faceErr) {
        console.warn('Skipping face in photo', photo.id, faceErr);
      }
    }

    // Insert detected faces and mark photo processed
    if (detectedRows.length > 0) {
      await supabase.from('detected_faces').insert(detectedRows);
    }

    await supabase
      .from('run_photos')
      .update({ processed_at: new Date().toISOString(), faces_detected: detectedRows.length })
      .eq('id', photo.id);

    return NextResponse.json({ status: 'processed', facesDetected: detectedRows.length });
  } catch (error: unknown) {
    console.error('POST /api/photos/process error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
