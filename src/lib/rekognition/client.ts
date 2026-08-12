/**
 * AWS Rekognition face recognition client.
 *
 * Design: every face detected in every run photo is indexed in the collection
 * at process time (so searching by FaceId is fast and cheap later). Reference
 * faces (selfie or coach-labeled) are also indexed with ExternalImageId=athleteId,
 * which is what lets SearchFaces(referenceId) find all matching detected faces
 * in one API call — the cheap retroactive backfill.
 *
 * Two classes of indexed face:
 *   - detected: indexed to support similarity search; no ExternalImageId
 *   - reference: indexed with ExternalImageId = athlete UUID; used to backfill
 */

import {
  RekognitionClient,
  CreateCollectionCommand,
  ListCollectionsCommand,
  DetectFacesCommand,
  IndexFacesCommand,
  SearchFacesCommand,
  DeleteFacesCommand,
  type BoundingBox,
} from '@aws-sdk/client-rekognition';

const COLLECTION_ID = process.env.REKOGNITION_COLLECTION_ID || 'madregot-runners';

const client = new RekognitionClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function ensureCollection(): Promise<void> {
  const { CollectionIds } = await client.send(new ListCollectionsCommand({}));
  if (CollectionIds?.includes(COLLECTION_ID)) return;
  await client.send(new CreateCollectionCommand({ CollectionId: COLLECTION_ID }));
}

export interface FaceBoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DetectedFaceBox {
  boundingBox: FaceBoundingBox;
  confidence: number; // 0-100, face detection confidence
}

/**
 * Detects all faces in an image and returns their bounding boxes.
 * This is the first step for group photos — then crop each box and index separately.
 */
export async function detectFaces(buffer: Buffer): Promise<DetectedFaceBox[]> {
  await ensureCollection();
  const { FaceDetails } = await client.send(new DetectFacesCommand({
    Image: { Bytes: new Uint8Array(buffer) },
    Attributes: ['DEFAULT'],
  }));

  return (FaceDetails ?? [])
    .filter(f => f.BoundingBox && (f.Confidence ?? 0) >= 80)
    .map(f => ({
      boundingBox: normBox(f.BoundingBox!),
      confidence: f.Confidence ?? 0,
    }));
}

/**
 * Indexes a single face into the collection and returns its Rekognition FaceId.
 *
 * @param buffer  - JPEG/PNG of a single cropped face
 * @param externalImageId - if provided, this face is a *reference* face (selfie or
 *   coach-labeled crop). Set to the athlete's UUID string. If omitted, the face is
 *   indexed as a *detected* face (no athlete link in the collection).
 */
export async function indexFace(
  buffer: Buffer,
  externalImageId?: string
): Promise<string> {
  await ensureCollection();
  const { FaceRecords } = await client.send(new IndexFacesCommand({
    CollectionId: COLLECTION_ID,
    Image: { Bytes: new Uint8Array(buffer) },
    MaxFaces: 1,
    QualityFilter: 'AUTO',
    DetectionAttributes: [],
    ...(externalImageId ? { ExternalImageId: externalImageId } : {}),
  }));

  const faceId = FaceRecords?.[0]?.Face?.FaceId;
  if (!faceId) throw new Error('No face detected or quality too low');
  return faceId;
}

export interface FaceMatch {
  faceId: string;
  similarity: number; // 0-100
  externalImageId?: string; // set when the match is a reference face
}

/**
 * Searches the collection for faces matching a known FaceId.
 * Used for: (1) auto-tagging a new detected face against enrolled references,
 * and (2) the retroactive backfill when a new reference face is enrolled.
 *
 * Returns matches with similarity >= threshold (default 80%).
 */
export async function searchByFaceId(
  faceId: string,
  threshold = 80,
  maxFaces = 4096
): Promise<FaceMatch[]> {
  await ensureCollection();
  const { FaceMatches } = await client.send(new SearchFacesCommand({
    CollectionId: COLLECTION_ID,
    FaceId: faceId,
    MaxFaces: maxFaces,
    FaceMatchThreshold: threshold,
  }));

  return (FaceMatches ?? []).map(m => ({
    faceId: m.Face!.FaceId!,
    similarity: m.Similarity!,
    externalImageId: m.Face?.ExternalImageId ?? undefined,
  }));
}

export async function deleteFace(faceId: string): Promise<void> {
  await client.send(new DeleteFacesCommand({
    CollectionId: COLLECTION_ID,
    FaceIds: [faceId],
  }));
}

// ─── helpers ────────────────────────────────────────────────────────────────

function normBox(b: BoundingBox): FaceBoundingBox {
  return {
    left: b.Left ?? 0,
    top: b.Top ?? 0,
    width: b.Width ?? 0,
    height: b.Height ?? 0,
  };
}
