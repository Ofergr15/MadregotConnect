/**
 * POST /api/photos/clusters/merge
 * Body: { sourceClusterId: string, targetClusterId: string }
 * Merges all faces in sourceClusterId into targetClusterId. Staff only.
 *
 * POST /api/photos/clusters/recluster
 * Assigns cluster_ids to any detected_faces that don't have one yet,
 * by searching Rekognition for similar already-clustered faces. Staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, isStaff } from '@/lib/auth/verify';
import { createServerClient } from '@/lib/supabase/server';
import { searchByFaceId } from '@/lib/rekognition/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const user = await verifyRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isStaff(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = (await req.json()) as {
      action?: string;
      sourceClusterId?: string;
      targetClusterId?: string;
    };

    const supabase = createServerClient();

    // ── Merge two clusters ────────────────────────────────────────────────────
    if (body.action === 'merge') {
      const { sourceClusterId, targetClusterId } = body;
      if (!sourceClusterId || !targetClusterId) {
        return NextResponse.json({ error: 'sourceClusterId and targetClusterId required' }, { status: 400 });
      }
      if (sourceClusterId === targetClusterId) {
        return NextResponse.json({ error: 'Cannot merge a cluster with itself' }, { status: 400 });
      }

      // Move all faces from source into target
      const { error: mergeErr } = await supabase
        .from('detected_faces')
        .update({ cluster_id: targetClusterId })
        .eq('cluster_id', sourceClusterId);

      if (mergeErr) return NextResponse.json({ error: mergeErr.message }, { status: 500 });
      return NextResponse.json({ merged: true });
    }

    // ── Retroactively cluster faces that have no cluster_id ───────────────────
    if (body.action === 'recluster') {
      // Load ALL faces (clustered and not) into memory so we can maintain local
      // state without re-querying the DB on every iteration.
      const { data: allFaces } = await supabase
        .from('detected_faces')
        .select('id, rekognition_face_id, cluster_id')
        .not('rekognition_face_id', 'is', null)
        .limit(500);

      if (!allFaces || allFaces.length === 0) return NextResponse.json({ reclustered: 0 });

      // Local map: rekognition_face_id → cluster_id (starts from DB values)
      const clusterMap = new Map<string, string>();
      for (const f of allFaces) {
        if (f.cluster_id) clusterMap.set(f.rekognition_face_id, f.cluster_id);
      }

      // Running photos have faces at angles/blur — same person often scores 55-70%.
      // 65% threshold for clustering (lower than the 80% used for reference matching).
      const CLUSTER_THRESHOLD = 65;

      let reclustered = 0;
      for (const face of allFaces.filter(f => !f.cluster_id)) {
        try {
          const matches = await searchByFaceId(face.rekognition_face_id, CLUSTER_THRESHOLD, 20);
          const matchFaceIds = matches
            .map(m => m.faceId)
            .filter(id => id !== face.rekognition_face_id);

          // Find an existing cluster from already-processed faces (local map first)
          let clusterId: string | undefined;
          for (const fid of matchFaceIds) {
            const existing = clusterMap.get(fid);
            if (existing) { clusterId = existing; break; }
          }
          if (!clusterId) clusterId = crypto.randomUUID();

          // Assign cluster to this face
          clusterMap.set(face.rekognition_face_id, clusterId);

          // Also proactively assign to any matching faces that don't have a cluster yet
          const toUpdate: string[] = [face.id];
          for (const fid of matchFaceIds) {
            if (!clusterMap.has(fid)) {
              clusterMap.set(fid, clusterId);
              const match = allFaces.find(f => f.rekognition_face_id === fid);
              if (match && !match.cluster_id) toUpdate.push(match.id);
            }
          }

          await supabase
            .from('detected_faces')
            .update({ cluster_id: clusterId })
            .in('id', toUpdate);

          reclustered++;
        } catch {
          // Skip faces whose Rekognition entry may have been deleted
        }
      }

      return NextResponse.json({ reclustered });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: unknown) {
    console.error('POST /api/photos/clusters error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
