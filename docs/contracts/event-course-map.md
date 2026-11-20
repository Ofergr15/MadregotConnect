# Race course map: proposal (parse-only built; nothing stored, fetched or published)

**Built (local, `u21-manager-events`):** `parseCourseGpx(text)` in `src/lib/events/course-gpx.ts`. Pure: a GPX string →
`{ points: [{lat,lng}] (≤2000, finish kept), distanceM (full track), start, finish, bounds, sourcePoints, name }`, or an
error `too_large | not_gpx | doctype | too_few_points | bad_coordinate`. No XML parser (no entity expansion; DOCTYPE refused).
Pinned by `eventCourseGpxParse.test.ts` with synthetic equator coordinates — **not** the Valencia course.

**Data source (not fabricated):** the course must come from the organiser's own GPX/route file, uploaded by staff.
Its licence/terms of reuse are **unverified** — owner decision before showing it in the app. No course geometry exists in
the DB today; `events.course_gpx_url` (migration 181, unapplied) only stores a link.

**To ship it (each needs authority):** (1) migration 181 applied; (2) a staff-only route that reads the file at
`course_gpx_url` (https only, size-capped) and returns `parseCourseGpx` output — or parse at upload time;
(3) client drawing. Google Maps: per the coordinator's check, the Maps SDK basic tier lists no unit price but requires
billing and an API key; a polyline is drawn from these coordinates. No key, SDK or env change has been made.
