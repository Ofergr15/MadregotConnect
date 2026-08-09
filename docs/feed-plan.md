# Social Feed — Plan & Decisions

Covers PRD §3 (HOME feed + interactions), §6 (Instagram/Facebook share), §10 (Community),
and the parts of §11/§16 that surface through the feed.

Source: `brain/מסמך ללא שם.docx` — "צ'קליסט לפיתוח אפליקציית מדרגות – גרסה 1.0".

---

## What already existed before this work

The run *detail* layer was already strong and is **not** being rebuilt:

- `src/components/ActivityFeed.tsx` — expandable run cards, Leaflet route map with
  color-by-pace, SVG pace/HR/elevation charts, splits table, cadence/VO2/stride/
  training-effect/self-eval tiles.
- `athlete_activities` already stores everything the feed needs to display:
  distance, duration, moving_duration, average_pace, average_hr, max_hr, calories,
  elevation_gain, start/end lat-lng, avg_cadence, avg_stride_length, vo2max,
  location_name, `gps_points` (full polyline), `splits`, `laps`,
  `perceived_rpe` / `perceived_feel`.
- Working web-push + Notification Center (`scheduled_notifications`,
  `push_subscriptions`) with a cron scanner — §16 hooks into this rather than
  needing new delivery infrastructure.
- Image upload pattern established by `/api/athletes/avatar` (Supabase Storage).

So the §3 gap was never the run card. It was four things: the feed was not
cross-athlete, there were no interactions, no photos, and no non-run feed items.

---

## Decisions (agreed with Tal, 2026-08-04)

| # | Decision | Chosen | Consequence |
|---|---|---|---|
| 1 | Feed visibility | **Club-wide, full data** | Everyone sees everyone's runs including HR and route. Deliberately reverses the read-scoping added to `sync-activities` GET. |
| 2 | Feed architecture | **One polymorphic feed** | Single `feed_items` table with a `type` discriminator. §3 and §10 share one interaction layer. |
| 3 | Identity | **Harden new social routes now** | All feed/like/comment endpoints verify a real Supabase JWT. Existing routes unchanged; retrofit is a separate task. |
| 4 | First slice | **Feed + likes + comments + free posts** | Share-image and badges come after. |
| 5 | HOME layout | **Feed as its own tab** | `/dashboard` stays exactly as-is. New `/dashboard/feed` tab. Zero regression risk to the dashboard the club uses daily. |
| 6 | Free-text/image posts | **In slice 1** | Facebook-style composer: text + optional images, posted straight to the feed. Added after the first four decisions, on request. |

### On decision 6

The driving scenario: *"I just finished an ice bath and I want to post to the
community."* Not a run, not tied to any activity — just a member sharing something
with the club, with or without a photo.

This is §10's core, and it costs very little on top of slice 1 because the polymorphic
`feed_items` table already carries non-run types and the like/comment layer attaches to
`feed_item_id` regardless of type. The genuinely new work is a composer UI and image
upload — not a second feed.

It also means text-only posts must be first-class, so the type is `post` (free text
*plus optional* media) rather than `photo_post`.

### On decision 1

Concern was raised and overruled, which is fine — but the implementation keeps the
cost of changing course low. **All feed field selection goes through one projection
function** (`projectFeedItem` in `src/lib/feed/project.ts`). Tightening visibility
later — dropping HR, trimming route start/end, adding a per-athlete opt-out — is an
edit to that one function plus a `visibility` filter that the schema already carries.

`feed_items.visibility` defaults to `'club'` and is unused today. It exists so the
group-scoped and private cases don't need a migration later.

### On decision 3

Every user enters through Google OAuth (`src/app/auth/resolve/page.tsx`), so a real
Supabase session always exists. The rest of the app authorizes off a client-supplied
`x-user-email` header and `localStorage.athlete_id`, both forgeable. That is tolerable
for reading your own data; it is not tolerable for comments, which are public writes
attributed to a named person.

New routes therefore use `requireAthlete()` / `requireSession()` from
`src/lib/auth-session.ts`, which verify the JWT with Supabase and derive
`athlete_id` from the *verified* email. Nothing downstream trusts the client.

**Known unrelated hole, not fixed here:** `POST /api/auth/athlete-login` takes an
email and returns that athlete's record with no authentication factor at all. It is
not part of the OAuth path (likely legacy) but it is a live account-takeover bypass.
Should be deleted or gated — tracked separately.

---

## Slice 1 — group feed + likes + comments + free posts

### Schema (`supabase/migrations/036_social_feed.sql`)

```
feed_items      id, type, author_athlete_id, activity_id, body, media, payload,
                occurred_at, visibility, group_id,
                like_count, comment_count, deleted_at, created_at
feed_likes      feed_item_id, athlete_id            UNIQUE(feed_item_id, athlete_id)
feed_comments   feed_item_id, athlete_id, body, deleted_at
```

`type` ∈ `activity` | `post` | `achievement` | `announcement` | `new_plan`.
Slice 1 produces `activity` (auto, from a sync trigger) and `post` (manual, from the
composer). `achievement` / `announcement` / `new_plan` are what make §11 and the coach
messages of §3 cheap later.

`body` holds the caption or post text. `media` is a JSONB array of
`{ path, url, w, h }` for uploaded images — a dedicated column rather than buried in
`payload`, since it is read on every render. Text-only posts leave it null.

Three design points worth stating:

1. **Runs become feed items via a DB trigger** on `athlete_activities` INSERT, not
   via application code. Both the Garmin sync path and the Strava sync path get feed
   items with zero changes to either — and any future import path does too.
2. **`like_count` / `comment_count` are denormalized** and maintained by triggers, so
   rendering a page of feed items is one query with no per-item aggregates.
3. **`athlete_activities.route_preview`** is added alongside: `gps_points`
   downsampled to ~60 points. The feed list sends previews, not full polylines —
   20 full routes would be multi-megabyte on a phone. Full detail still loads on
   expand through the existing `activity-details` endpoint.

### API

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/feed?cursor=&limit=` | `requireSession` | Paginated club feed, `occurred_at DESC`, keyset cursor. Includes `liked_by_me`. |
| `POST /api/feed/like` | `requireAthlete` | Toggle like on a feed item. |
| `GET /api/feed/comments?itemId=` | `requireSession` | Comments for one item. |
| `POST /api/feed/comments` | `requireAthlete` | Add comment. |
| `DELETE /api/feed/comments?id=` | `requireAthlete` | Delete own comment; staff may delete any. |
| `POST /api/feed/posts` | `requireAthlete` | Create a free post: `{ body, media[] }`. Rejects empty (no text *and* no image). |
| `DELETE /api/feed/posts?id=` | `requireAthlete` | Soft-delete own post; staff may delete any. |
| `POST /api/feed/media` | `requireAthlete` | Upload one image → `feed-media` bucket → returns `{ path, url, w, h }`. |

Comments are flat (no threading) — matches the doc's "תגובות" and avoids depth UI.
Author-or-staff delete gives the moderation the doc implies for §19 without a
separate moderation queue. The same rule covers posts.

Media upload is a separate call from post creation so the composer can show upload
progress and thumbnails before the user commits the post, and so a failed upload never
loses typed text.

### UI

- `/dashboard/feed` — new tab with infinite scroll.
- **Composer** pinned at the top of the feed: avatar + "מה חדש?" tap target → bottom
  sheet with textarea, image picker (`capture` allowed so the camera is one tap), and
  thumbnail strip with per-image remove. Optimistic insert at the top of the feed on
  submit.
- Activity cards use a compact feed layout with an author header and action row.
- Post cards are the same shell: author header, text, image grid (1 image full-width;
  2–4 in a grid), same action row.
- Comment sheet — bottom sheet, matching the `BottomTabBar` "More" sheet pattern.
- Hebrew-first, RTL, via `next-intl` (`messages/he.json` + `en.json`).

### Image handling

Client-side downscale before upload (canvas, long edge ≤ 1600px, JPEG q≈0.82). Phone
photos are 3–8 MB; uploading them raw would be slow on mobile data and expensive in
Storage. Bucket `feed-media`, public read, paths namespaced `{athlete_id}/{uuid}.jpg`.
Cap of 4 images per post.

### Notifications (§16, partial)

Like and comment both push to the item's author via the existing
`sendPushToSubscriptions`. Never notify yourself for your own action.

---

## Roadmap for the rest of the document

Ordered by (value × how much the feed foundation already gives us):

1. **§6 Share to Instagram/Facebook — shipped.** Templated summary image.
   *Reality check to set with the client:* direct-to-Story needs a native app with a
   registered Facebook App ID. From a PWA the path is generate image →
   `navigator.share({files})` → share sheet → user taps Instagram. One extra tap.
   Recommend client-side canvas over Satori/`@vercel/og`: the photo never leaves the
   device, and Hebrew RTL text is fully controllable.
2. **§10 Community remainder** — free posts themselves ship in slice 1. What's left:
   member tagging (@-mentions), post search, personal-photo search
   ("חיפוש תמונות אישיות אחרי אימונים"), and surfacing the newsletter. Photo search
   implies either manual tagging or face recognition — needs its own scoping
   conversation before anyone estimates it.
   Also still open: attaching photos to a *run* (§3) as opposed to a standalone post.
3. **§11/§13 badges & challenges** — `achievement` feed items. Award engine reads
   `athlete_activities`; every award becomes a feed item and a push for free.
4. **§4/§8/§15 calendar, events, registration** — largest greenfield block, no feed
   dependency.
5. **§17/§21 search & follow graph** — cheap once `feed_items` exists; a follow table
   turns the club feed into a following feed with a `WHERE` clause.
6. **§9 store** — genuinely separate product (cart, payments, orders). Own project.

---

## Deferred / explicitly not in slice 1

- Per-athlete privacy toggle (decision 1 chose club-wide; the hook is in place).
- Retrofitting JWT auth onto the ~60 existing API routes.
- Threaded comments, reactions beyond a single like, @-mention tagging.
- Video upload (images only in slice 1 — video needs transcoding and a size policy).
- Post editing (delete + repost for now).
- Achievements and photos attached to runs.
