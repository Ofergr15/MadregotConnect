import { describe, expect, it } from 'vitest';
import { isStravaPhoto, pickStravaPhoto } from '@/lib/strava/avatar-refresh';

describe('a Strava photo kept current (Shalev, 10-20)', () => {
  it('knows a Strava-hosted photo from one uploaded to the app', () => {
    expect(isStravaPhoto('https://dgalywyr863hv.cloudfront.net/pictures/athletes/94115461/22377611/23/large.jpg')).toBe(true);
    expect(isStravaPhoto('https://njzldypndkicpsmdtyll.supabase.co/storage/v1/object/public/avatars/x.jpg')).toBe(false);
    expect(isStravaPhoto(null)).toBe(false);
  });
  it('keeps the new photo, and never Strava\'s grey placeholder', () => {
    expect(pickStravaPhoto({ profile: 'https://dgalywyr863hv.cloudfront.net/pictures/athletes/1/2/3/large.jpg' })).toMatch(/large\.jpg$/);
    expect(pickStravaPhoto({ profile: 'avatar/athlete/large.png' })).toBeNull();
    expect(pickStravaPhoto({ profile: 'https://d3nn82uaxijpm6.cloudfront.net/assets/avatar/athlete/large-800a7033.png' })).toBeNull();
    expect(pickStravaPhoto({ profile_medium: 'https://x.cloudfront.net/pictures/athletes/1/2/3/medium.jpg' })).toMatch(/medium\.jpg$/);
    expect(pickStravaPhoto(null)).toBeNull();
  });
});
