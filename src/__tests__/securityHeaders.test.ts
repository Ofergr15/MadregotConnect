import { describe, expect, it } from 'vitest';
import { CSP_DIRECTIVES, CSP_REPORT_ONLY, cspString, securityHeaders } from '@/lib/security-headers.mjs';

type H = { key: string; value: string };
const headers = securityHeaders() as H[];
const get = (k: string) => headers.find((h) => h.key === k)?.value;

describe('security headers', () => {
  it('only this origin may frame the app (release rehearsal frames the feed)', () => {
    expect(get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(get('Content-Security-Policy')).toBe("frame-ancestors 'self'");
  });
  it('referrer, nosniff and permissions are set', () => {
    expect(get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(get('X-Content-Type-Options')).toBe('nosniff');
    expect(get('Permissions-Policy')).toMatch(/geolocation=\(self\)/);
    expect(get('Permissions-Policy')).toMatch(/camera=\(self\)/);
  });
  it('the full policy ships report-only until checked on the real app', () => {
    expect(CSP_REPORT_ONLY).toBe(true);
    expect(get('Content-Security-Policy-Report-Only')).toBe(cspString());
  });
  it('allows what maps, Supabase, Strava/Garmin avatars, video and analytics need', () => {
    const d = CSP_DIRECTIVES as Record<string, string[]>;
    expect(d['script-src']).toContain('https://unpkg.com'); // Leaflet
    expect(d['style-src']).toContain('https://unpkg.com');
    expect(d['img-src']).toContain('https:'); // tiles, Strava CloudFront avatars, Drive
    expect(d['connect-src']).toEqual(expect.arrayContaining(['https://*.supabase.co', 'wss://*.supabase.co', 'https://*.posthog.com']));
    expect(d['media-src']).toContain('https://*.mux.com');
    expect(d['frame-ancestors']).toEqual(["'self'"]);
    expect(d['object-src']).toEqual(["'none'"]);
  });
});
