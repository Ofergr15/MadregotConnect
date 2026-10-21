import { describe, expect, it } from 'vitest';
import { firstFrame, isNetworkDrop } from '@/components/ClientEventReporter';

describe('#126 network drops', () => {
  it('knows the browsers\' words for a dropped request', () => {
    expect(isNetworkDrop('Load failed')).toBe(true);
    expect(isNetworkDrop('Failed to fetch')).toBe(true);
    expect(isNetworkDrop('NetworkError when attempting to fetch resource.')).toBe(true);
    expect(isNetworkDrop("Cannot read properties of undefined (reading 'x')")).toBe(false);
  });
  it('keeps where it came from', () => {
    const e = new TypeError('Load failed');
    e.stack = 'TypeError: Load failed\n    at https://www.madregot.app/_next/static/chunks/abc.js:1:2345';
    expect(firstFrame(e)).toBe('/_next/static/chunks/abc.js:1:2345');
    expect(firstFrame('x')).toBe('?');
  });
});
