import { describe, expect, it } from 'vitest';
import { usableAvatarUrl } from '@/lib/avatar-url';

describe('usableAvatarUrl', () => {
  it('treats Strava placeholder silhouettes as no photo', () => {
    expect(usableAvatarUrl('avatar/athlete/large.png')).toBeNull();
    expect(usableAvatarUrl('https://d3nn82uaxijpm6.cloudfront.net/assets/avatar/athlete/large-800a7033cc92b2a5548399e26b1ef42414dd1a9cb13d99454222d38d58fd28ef.png')).toBeNull();
    expect(usableAvatarUrl('https://www.strava.com/avatar/athlete/medium.png')).toBeNull();
  });
  it('treats empty values as no photo', () => {
    expect(usableAvatarUrl(null)).toBeNull();
    expect(usableAvatarUrl(undefined)).toBeNull();
    expect(usableAvatarUrl('')).toBeNull();
    expect(usableAvatarUrl('  ')).toBeNull();
  });
  it('keeps real photos', () => {
    const strava = 'https://dgalywyr863hv.cloudfront.net/pictures/athletes/123/456/large.jpg';
    const google = 'https://lh3.googleusercontent.com/a/abc=s96-c';
    expect(usableAvatarUrl(strava)).toBe(strava);
    expect(usableAvatarUrl(google)).toBe(google);
  });
});
