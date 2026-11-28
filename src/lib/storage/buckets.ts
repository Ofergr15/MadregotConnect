/**
 * EVERY STORAGE BUCKET THE APP USES, IN ONE LIST (owner rule 2026-11-28: no bucket is
 * public unless there is a reason, and the reason is written here).
 *
 * `public: true` means anyone with the URL reads the file AND anyone holding the anon key
 * (it ships in the web bundle) can list the bucket — Supabase serves a public bucket with
 * no RLS at all, so migration 223 dropping the SELECT policies did not stop that. The only
 * lever is `storage.buckets.public = false` (migration 300).
 *
 * A private bucket marked `serve` is read through GET /api/files/<bucket>/<path>
 * (lib/storage/file-access.ts): a verified member (or staff, for 'staff') gets a 302 to a
 * ten-minute signed URL. Private buckets without `serve` have their own gated routes.
 *
 * src/__tests__/storageBuckets.test.ts fails when code names a bucket that is not listed.
 */
export type BucketAccess = 'member' | 'staff';

export interface BucketEntry {
  public: boolean;
  /** Served by /api/files to this audience. Only for private buckets. */
  serve?: BucketAccess;
  reason: string;
}

export const BUCKETS = {
  // ── public, each with the no-login client that has to fetch it ──────────────────
  'notification-images': {
    public: true,
    reason:
      'The push banner image: Chrome/Android fetch `image`/`icon` themselves, outside the page and without our session, and a scheduled push can be shown days after it was sent. Staff-made broadcast art, nothing personal.',
  },
  // ── private, served by /api/files to members ────────────────────────────────────
  avatars: { public: false, serve: 'member', reason: 'Members’ own photos. Only the club sees them; a push icon gets a signed link at send time.' },
  'badge-icons': { public: false, serve: 'member', reason: 'Shown only inside the app (/api/badges is called from the logged-in shell).' },
  'event-images': { public: false, serve: 'member', reason: 'Event covers, shown only on in-app event screens.' },
  'feed-media': { public: false, serve: 'member', reason: 'Feed posts, birthday and quality-session photos of members.' },
  'perk-images': { public: false, serve: 'member', reason: 'Sponsor perks are a members-only benefit.' },
  'program-plans': { public: false, serve: 'member', reason: 'The weekly training/nutrition PDFs every athlete opens in the app; not public material.' },
  'run-chat': { public: false, serve: 'member', reason: 'Workout and laps images in a member’s run chat and the weekly plan.' },
  'store-products': { public: false, serve: 'member', reason: 'Merch photos, shown only on the in-app store.' },
  // ── private, own routes ─────────────────────────────────────────────────────────
  'face-crops': { public: false, reason: 'Biometric crops of members’ faces.' },
  'reference-faces': { public: false, reason: 'Members’ enrolment selfies; /api/photos/selfie-url signs them.' },
  'club-photos': { public: false, reason: 'Drive photo mirror + photo indexes; lib/photos/mirror.ts signs them.' },
  'run-gpx': { public: false, reason: 'Where a member runs; /api/activities/gpx, owner only.' },
} as const satisfies Record<string, BucketEntry>;

export type BucketName = keyof typeof BUCKETS;

export function bucketEntry(name: string): BucketEntry | null {
  return Object.prototype.hasOwnProperty.call(BUCKETS, name) ? (BUCKETS as Record<string, BucketEntry>)[name] : null;
}

/** Buckets /api/files serves. */
export const SERVED_BUCKETS = (Object.keys(BUCKETS) as BucketName[]).filter((b) => !!(BUCKETS[b] as BucketEntry).serve);

export const FILE_ROUTE = '/api/files';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
const SERVED_ALT = SERVED_BUCKETS.map(escape).join('|');

// Any project host: rows written before the Tokyo → Frankfurt move still name the old one.
const PUBLIC_OBJECT = new RegExp(`https?://[A-Za-z0-9.-]+(?::\\d+)?/storage/v1/object/public/(${SERVED_ALT})/`, 'g');
const ROUTE_ON_A_HOST = new RegExp(`^https?://[A-Za-z0-9.-]+(?::\\d+)?(${escape(FILE_ROUTE)}/(?:${SERVED_ALT})/)`);

/** The route URL for an object: `/api/files/<bucket>/<path>`, each segment encoded once. */
export function fileRouteUrl(bucket: BucketName, path: string): string {
  return `${FILE_ROUTE}/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * A stored file link as the app should load it: a public object URL of a served bucket
 * (any project host) becomes the route URL; a route URL on any host becomes site-relative
 * (so the same-origin file cookie goes with it); anything else is returned unchanged.
 * The query string is kept (`?v=` cache busters).
 */
export function toFileRoute<T extends string | null | undefined>(stored: T): T {
  if (typeof stored !== 'string' || !stored) return stored;
  const rewritten = rewriteStorageUrls(stored);
  if (rewritten !== stored) return rewritten as T;
  const m = stored.match(ROUTE_ON_A_HOST);
  return (m ? stored.slice(m[0].length - m[1].length) : stored) as T;
}

/** toFileRoute over a whole text (a JSON body): every public object URL of a served bucket. */
export function rewriteStorageUrls(text: string): string {
  if (!text.includes('/storage/v1/object/public/')) return text;
  return text.replace(PUBLIC_OBJECT, (_m, bucket: string) => `${FILE_ROUTE}/${bucket}/`);
}

/**
 * The object key for /api/files/<bucket>/<...segments>, or null when it isn't one we serve.
 * Segments arrive decoded; a traversal, an empty segment or a control char is refused.
 */
export function servedObject(bucket: string, segments: readonly string[] | undefined): { bucket: BucketName; access: BucketAccess; path: string } | null {
  const entry = bucketEntry(bucket);
  if (!entry || entry.public || !entry.serve) return null;
  if (!segments?.length || segments.length > 12) return null;
  for (const s of segments) {
    if (!s || s === '.' || s === '..' || s.includes('\\') || /[\u0000-\u001f]/.test(s)) return null;
  }
  const path = segments.join('/');
  if (path.length > 512) return null;
  return { bucket: bucket as BucketName, access: entry.serve, path };
}
