// Security headers for every web response (task 74). Imported by next.config.mjs
// (plain .mjs so the config can load it without a TS step) and by the test.
//
// TWO layers, on purpose:
//
// 1. ENFORCED, and unable to break a page: frame-ancestors / X-Frame-Options (only
//    this origin may frame us — the release-rehearsal screen frames the feed, so
//    'self' and not 'none'), Referrer-Policy, nosniff, a Permissions-Policy that keeps
//    camera / microphone / geolocation for our own origin (photo upload, race-live
//    phone sharing) and turns off what the app never uses.
// 2. REPORT-ONLY full Content-Security-Policy. The app loads maps (Leaflet from unpkg,
//    tiles from ArcGIS/CARTO), Supabase over https + wss, PostHog, Mux video, Drive
//    thumbnails, Strava avatars, and member-pasted image URLs; an enforced policy that
//    misses one of those blanks a map or an avatar for everyone. Report-only logs the
//    violations in the browser console without blocking anything, so the policy can be
//    checked on the real app and flipped to enforced in a separate, deliberate change
//    (see CSP_REPORT_ONLY below).
//
// Inline scripts exist (theme/update boot scripts via dangerouslySetInnerHTML), so
// script-src keeps 'unsafe-inline' until they move to nonces.

export const CSP_REPORT_ONLY = true;

export const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://*.posthog.com'],
  'style-src': ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
  // Avatars (Strava CloudFront, Google), Drive thumbnails, map tiles, pasted links.
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': [
    "'self'",
    'https://*.supabase.co', 'wss://*.supabase.co',
    'https://*.posthog.com',
    'https://api.open-meteo.com',
    'https://nominatim.openstreetmap.org',
    'https://*.mux.com',
  ],
  'media-src': ["'self'", 'blob:', 'https://*.mux.com', 'https://*.googleusercontent.com', 'https://drive.google.com'],
  'frame-src': ["'self'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://drive.google.com', 'https://player.mux.com'],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'self'"],
};

export function cspString(directives = CSP_DIRECTIVES) {
  return Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

export function securityHeaders() {
  return [
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    // Enforced on its own: frame-ancestors never affects what a page can load.
    { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
    { key: CSP_REPORT_ONLY ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', value: cspString() },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()',
    },
  ];
}
