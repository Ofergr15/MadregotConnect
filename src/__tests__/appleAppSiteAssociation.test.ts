import { describe, expect, it } from 'vitest';
import { GET } from '@/app/.well-known/apple-app-site-association/route';
import { config } from '@/proxy';

describe('apple-app-site-association', () => {
  it('is 200 JSON with the app id and only the invite paths', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    const body = JSON.parse(await res.text());
    expect(Object.keys(body)).toEqual(['applinks']);
    const [d] = body.applinks.details;
    expect(body.applinks.details).toHaveLength(1);
    expect(d.appIDs).toEqual(['V7D6R3AB64.app.madregot.ios']);
    expect(d.components.map((c: any) => c['/'])).toEqual(['/join/*', '/academy-register*']);
  });

  it('the proxy matcher does not intercept /.well-known', () => {
    const [pagePattern] = config.matcher;
    const re = new RegExp(`^${pagePattern.replace('/((', '/(?:(').replace(').*)', ').*)')}$`);
    expect(re.test('/.well-known/apple-app-site-association')).toBe(false);
    expect(re.test('/join/abc')).toBe(true); // sanity: the matcher does match pages
  });
});
