/**
 * Retroactive backfill — the engine behind "upload a selfie and find all my old photos".
 *
 * When a new reference face is enrolled (via selfie upload or coach-label):
 *   1. Call SearchFaces(newReferenceFaceId) — one API call that returns every
 *      matching FaceId already indexed in the collection.
 *   2. Bulk-UPDATE the detected_faces rows for those FaceIds, but ONLY for rows
 *      where athlete_id IS NULL. (Never overwrite a confirmed tag.)
 *
 * This is cheap: O(1) Rekognition call regardless of how many photos have been
 * imported. The alternative — re-run SearchFacesByImage over every stored crop —
 * would be thousands of calls.
 *
 * Returns the number of photos that were newly tagged.
 */

import { searchByFaceId } from '@/lib/rekognition/client';
import { createServerClient } from '@/lib/supabase/server';

export async function backfillAthlete(
  athleteId: string,
  referenceFaceId: string,
  threshold = 80
): Promise<number> {
  // 1. Find every face in the collection that matches this reference
  const matches = await searchByFaceId(referenceFaceId, threshold, 4096);
  if (matches.length === 0) return 0;

  const matchedFaceIds = matches.map(m => m.faceId);

  const supabase = createServerClient();

  // 2. Resolve detected_faces rows for those rekognition_face_ids
  const { data: faces, error } = await supabase
    .from('detected_faces')
    .select('id, athlete_id, rekognition_face_id')
    .in('rekognition_face_id', matchedFaceIds)
    .is('athlete_id', null); // only unidentified faces

  if (error || !faces?.length) return 0;

  // 3. Bulk update with confidence from matches
  const faceIdToSimilarity = new Map(matches.map(m => [m.faceId, m.similarity]));

  const updates = faces.map(face => ({
    id: face.id,
    athlete_id: athleteId,
    confidence: faceIdToSimilarity.get(face.rekognition_face_id) ?? null,
    source: 'auto',
  }));

  await supabase
    .from('detected_faces')
    .upsert(updates, { onConflict: 'id' });

  return faces.length;
}
