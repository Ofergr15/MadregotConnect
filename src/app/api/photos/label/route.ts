/**
 * POST /api/photos/label — tag a cluster (all faces of the same person at once).
 * Body: { clusterId: string, athleteId?: string, personName?: string }
 *   - athleteId: link to a registered athlete (promotes to reference + backfill)
 *   - personName: label for a non-registered person; can be linked to athlete later
 *
 * DELETE /api/photos/label — untag a cluster.
 * Body: { clusterId: string }
 *
 * Staff only.
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

    const { clusterId, athleteId, personName } = (await req.json()) as {
      clusterId?: string;
      athleteId?: string;
      personName?: string;
    };

    if (!clusterId) return NextResponse.json({ error: 'clusterId is required' }, { status: 400 });
    if (!athleteId && !personName) {
      return NextResponse.json({ error: 'athleteId or personName is required' }, { status: 400 });
    }

    const supabase = createServerClient();

    if (personName && !athleteId) {
      // Just a name — label the whole cluster, no Rekognition promotion needed
      await supabase
        .from('detected_faces')
        .update({ person_name: personName, athlete_id: null, source: 'manual' })
        .eq('cluster_id', clusterId);
      return NextResponse.json({ labeled: true, photosTagged: 0 });
    }

    // Tagging to an athlete — apply to whole cluster
    await supabase
      .from('detected_faces')
      .update({ athlete_id: athleteId, person_name: null, source: 'manual', confidence: null })
      .eq('cluster_id', clusterId);

    // Check if athlete already has a reference face
    const { data: existingRef } = await supabase
      .from('athlete_faces')
      .select('id')
      .eq('athlete_id', athleteId)
      .maybeSingle();

    let photosTagged = 0;

    if (!existingRef) {
      // Pick one representative face from the cluster to promote as reference
      const { data: rep } = await supabase
        .from('detected_faces')
        .select('id, crop_url, rekognition_face_id')
        .eq('cluster_id', clusterId)
        .not('crop_url', 'is', null)
        .limit(1)
        .maybeSingle();

      if (rep?.rekognition_face_id) {
        let refFaceId = rep.rekognition_face_id;
        try {
          const cropRes = await fetch(rep.crop_url!);
          const buffer = Buffer.from(await cropRes.arrayBuffer());
          refFaceId = await indexFace(buffer, athleteId);
        } catch { /* fall back to existing faceId */ }

        await supabase.from('athlete_faces').insert({
          athlete_id: athleteId,
          rekognition_face_id: refFaceId,
          origin: 'coach_label',
          source_face_id: rep.id,
        });

        photosTagged = await backfillAthlete(athleteId!, refFaceId);
      }
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

    const { clusterId } = (await req.json()) as { clusterId?: string };
    if (!clusterId) return NextResponse.json({ error: 'clusterId is required' }, { status: 400 });

    const supabase = createServerClient();

    // Remove any reference faces promoted from this cluster
    const { data: clusterFaces } = await supabase
      .from('detected_faces')
      .select('id, rekognition_face_id')
      .eq('cluster_id', clusterId);

    for (const face of clusterFaces ?? []) {
      const { data: ref } = await supabase
        .from('athlete_faces')
        .select('id, rekognition_face_id')
        .eq('source_face_id', face.id)
        .maybeSingle();
      if (ref) {
        try { await deleteFace(ref.rekognition_face_id); } catch { /* ignore */ }
        await supabase.from('athlete_faces').delete().eq('id', ref.id);
      }
    }

    // Clear the tag from the whole cluster
    await supabase
      .from('detected_faces')
      .update({ athlete_id: null, person_name: null, confidence: null, source: 'auto' })
      .eq('cluster_id', clusterId);

    return NextResponse.json({ untagged: true });
  } catch (error: unknown) {
    console.error('DELETE /api/photos/label error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
