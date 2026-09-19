import { describe, expect, it } from 'vitest';

import {
  NO_TOKEN_ERROR,
  classifyDeliveryFailure,
  shouldTellAthlete,
} from '@/lib/garmin/delivery-failure';

// The question these tests actually ask is not "does the regex fire" — it is "would this
// message be worth waking an athlete up for". A failure the athlete cannot act on must stay
// between us and the coach, because the mockup caps the athlete at three notifications per
// workout and says plainly what a fourth costs: the notifications get turned off.

describe('failures the athlete has to fix', () => {
  it('treats a missing token as theirs — nobody else can reconnect it', () => {
    expect(classifyDeliveryFailure(NO_TOKEN_ERROR)).toBe('reconnect');
  });

  it('treats Garmin refusing our credential as theirs', () => {
    for (const message of [
      'Request failed with status code 401',
      'Unauthorized',
      'unauthorised',
      'invalid_grant',
      'oauth token expired',
      'The refresh token is invalid',
      'expired access token',
      'Please re-authenticate with Garmin',
      'Login failed',
      'Not logged in',
    ]) {
      expect(classifyDeliveryFailure(message), message).toBe('reconnect');
      expect(shouldTellAthlete(message), message).toBe(true);
    }
  });
});

describe('failures that are ours, and stay quiet', () => {
  it('keeps Garmin being unavailable off the athlete\'s phone', () => {
    // Every one of these is fixed by the coach pressing the button again in ten minutes.
    for (const message of [
      'Request failed with status code 429',
      'Request failed with status code 500',
      'Request failed with status code 502',
      'Request failed with status code 503',
      'socket hang up',
      'ETIMEDOUT',
      'ECONNRESET',
      'timeout of 30000ms exceeded',
      'Too Many Requests',
    ]) {
      expect(classifyDeliveryFailure(message), message).toBe('ours');
      expect(shouldTellAthlete(message), message).toBe(false);
    }
  });

  it('keeps our own bugs off the athlete\'s phone', () => {
    for (const message of [
      'scheduleWorkout called without a workout id',
      'deleteWorkout called without a workout id — nothing was ever created to delete',
      'Garmin accepted the workout but returned no id',
      'Verified on Garmin but could not record the delivery: timeout',
      'Garmin scheduled the workout on 2026-09-21, not 2026-09-20',
    ]) {
      expect(classifyDeliveryFailure(message), message).toBe('ours');
    }
  });

  it('leaves 403 alone, because Garmin means two different things by it', () => {
    // Dead session AND "we won't serve you right now" share this status. A message that
    // could mean either cannot carry an instruction to go reconnect.
    expect(classifyDeliveryFailure('Request failed with status code 403')).toBe('ours');
    expect(classifyDeliveryFailure('Forbidden')).toBe('ours');
  });

  it('defaults an unrecognised or empty message to ours', () => {
    // The asymmetry is the point: a missed `reconnect` leaves the athlete exactly where
    // they already are today, while a false one tells somebody their watch is broken when
    // it is not — and teaches them to ignore the alert that matters.
    for (const message of ['Unknown error', 'something went sideways', '', '   ', null, undefined]) {
      expect(classifyDeliveryFailure(message)).toBe('ours');
      expect(shouldTellAthlete(message)).toBe(false);
    }
  });

  it('does not fire on the word "token" alone', () => {
    // An early cut of this matched /token/, which caught our own "returned no id" wording
    // and would have told a dozen athletes to reconnect a working watch.
    expect(classifyDeliveryFailure('no workout token in the response')).toBe('ours');
  });
});
