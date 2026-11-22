import { describe, it, expect } from 'vitest';
import { FEATURES, FEATURE_KEYS, isFeatureKey } from '@/lib/features/flags';

// iOS build 15 switches staff to the coach shell only when GET /api/features/me
// answers native_coach=true. The key must exist (so the route reports it) and be
// off by default (gated rollout: nobody gets it until a row turns it on).
describe('native_coach feature key', () => {
  it('is a known key, reported by features/me, default off', () => {
    expect(isFeatureKey('native_coach')).toBe(true);
    expect(FEATURE_KEYS).toContain('native_coach');
    expect(FEATURES.native_coach.defaultEnabled).toBe(false);
  });
});
