/**
 * POST /api/photos/process
 * Body: { photoId: string }
 *
 * Processes ONE photo: download from Drive, convert to JPEG (handles HEIC/iPhone
 * photos that Rekognition can't read natively), detect faces, crop each, index in
 * Rekognition, search for matches, write detected_faces rows, generate a thumbnail,
 * mark processed_at.
 */
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
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

    const { data: photo, error: photoErr } = await supabase
      .from('run_photos')
      .select('id, drive_file_id, processed_at')
      .eq('id', photoId)
      .maybeSingle();

    if (photoErr || !photo) return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
    if (photo.processed_at) return NextResponse.json({ status: 'already_processed', facesDetected: 0 });

    // Download from Drive and normalize to JPEG.
    // Rekognition doesn't support HEIC. Some HEIC files also exceed sharp/libheif's
    // internal security limits (iref box references). If conversion fails, mark the
    // photo as processed with 0 faces so it doesn't block the queue indefinitely.
    const rawBuffer = await downloadFile(photo.drive_file_id);

    let imageBuffer: Buffer;
    let thumbUrl: string | null = null;
    try {
      imageBuffer = await sharp(rawBuffer).jpeg({ quality: 90 }).toBuffer();

      const thumbBuffer = await sharp(rawBuffer)
        .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      const thumbPath = `thumbs/${photo.id}.jpg`;
      const { error: thumbErr } = await supabase.storage
        .from('face-crops')
        .upload(thumbPath, thumbBuffer, { contentType: 'image/jpeg', upsert: true });
      if (!thumbErr) {
        thumbUrl = supabase.storage.from('face-crops').getPublicUrl(thumbPath).data.publicUrl;
      }
    } catch (convErr) {
      console.warn(`Cannot decode photo ${photo.id} (corrupt/unsupported HEIC):`, convErr);
      await supabase
        .from('run_photos')
        .update({ processed_at: new Date().toISOString(), faces_detected: 0 })
        .eq('id', photo.id);
      return NextResponse.json({ status: 'skipped', reason: 'decode_error' });
    }

    // Detect all faces in the JPEG
    const boxes = await detectFaces(imageBuffer);

    // Load enrolled reference faces for auto-tagging
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
      cluster_id: string;
    }> = [];

    for (const box of boxes) {
      try {
        const cropBuffer = await cropFace(imageBuffer, box.boundingBox);

        const cropPath = `${photo.id}/${crypto.randomUUID()}.jpg`;
        const { error: uploadErr } = await supabase.storage
          .from('face-crops')
          .upload(cropPath, cropBuffer, { contentType: 'image/jpeg', upsert: false });

        const cropUrl = uploadErr
          ? null
          : supabase.storage.from('face-crops').getPublicUrl(cropPath).data.publicUrl;

        const faceId = await indexFace(cropBuffer);

        // Search for matching faces. Two different thresholds:
        // - 80% for reference face auto-tagging (high confidence required)
        // - 65% for clustering (running photos score lower due to angles/blur)
        const refMatches = await searchByFaceId(faceId, 80, 10);
        const clusterMatches = await searchByFaceId(faceId, 65, 20);

        // Auto-tag if a reference face matches at 80%+
        let athleteId: string | null = null;
        let confidence: number | null = null;
        for (const match of refMatches) {
          const candidate = refFaceIdToAthlete.get(match.faceId);
          if (candidate) {
            athleteId = candidate;
            confidence = match.similarity;
            break;
          }
        }

        // Use the wider 65% search for clustering
        const matches = clusterMatches;
        const matchFaceIds = matches.map(m => m.faceId).filter(id => id !== faceId);
        let clusterId: string = crypto.randomUUID();
        if (matchFaceIds.length > 0) {
          const { data: clustered } = await supabase
            .from('detected_faces')
            .select('cluster_id')
            .in('rekognition_face_id', matchFaceIds)
            .not('cluster_id', 'is', null)
            .limit(1)
            .maybeSingle();
          if (clustered?.cluster_id) clusterId = clustered.cluster_id;
        }

        detectedRows.push({
          photo_id: photo.id,
          bounding_box: box.boundingBox,
          crop_url: cropUrl,
          rekognition_face_id: faceId,
          athlete_id: athleteId,
          confidence,
          source: 'auto',
          cluster_id: clusterId,
        });
      } catch (faceErr) {
        console.warn('Skipping face in photo', photo.id, faceErr);
      }
    }

    if (detectedRows.length > 0) {
      await supabase.from('detected_faces').insert(detectedRows);
    }

    await supabase
      .from('run_photos')
      .update({
        processed_at: new Date().toISOString(),
        faces_detected: detectedRows.length,
        ...(thumbUrl ? { thumbnail_url: thumbUrl } : {}),
      })
      .eq('id', photo.id);

    return NextResponse.json({ status: 'processed', facesDetected: detectedRows.length });
  } catch (error: unknown) {
    console.error('POST /api/photos/process error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
