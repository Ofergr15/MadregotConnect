import { describe, expect, it } from 'vitest';
import { urlBase64ToUint8Array } from '@/lib/pwa';

// VAPID public keys arrive as URL-safe base64 (RFC 4648 §5: '-'/'_' instead of
// '+'/'/', no padding) and the Push API's applicationServerKey needs a raw
// Uint8Array — this is the one conversion standing between a correctly
// configured VAPID key and subscribeToPush failing to enroll the device at
// all, so it's worth pinning down exactly.

describe('urlBase64ToUint8Array', () => {
  it('decodes a standard base64 string with no padding needed', () => {
    // "AAECAw==" -> the base64 URL-safe form here has no '=' because its
    // length is already a multiple of 4; bytes 0,1,2,3.
    const result = urlBase64ToUint8Array('AAECAw');
    expect(Array.from(result)).toEqual([0, 1, 2, 3]);
  });

  it('adds the correct padding for a length not divisible by 4', () => {
    // 'AA' (2 chars) needs 2 '=' to reach a multiple of 4 -> decodes to byte 0x00.
    expect(Array.from(urlBase64ToUint8Array('AA'))).toEqual([0]);
  });

  it('converts URL-safe characters (- and _) back to standard base64 (+ and /) before decoding', () => {
    // Byte 0xFB 0xFF encodes to standard base64 "+/8=" -> URL-safe "-_8".
    const standard = urlBase64ToUint8Array('+/8=');
    const urlSafe = urlBase64ToUint8Array('-_8');
    expect(Array.from(urlSafe)).toEqual(Array.from(standard));
    expect(Array.from(urlSafe)).toEqual([251, 255]);
  });

  it('round-trips a realistic-length VAPID-style key without throwing and returns the expected byte count', () => {
    // A real P-256 public key is 65 raw bytes; the base64url encoding of a
    // 65-byte buffer is 87 chars with no padding needed at 65*8/6 ≈ 86.67 → 87.
    const bytes = new Uint8Array(65).fill(7);
    const encoded = Buffer.from(bytes).toString('base64url');
    const decoded = urlBase64ToUint8Array(encoded);
    expect(decoded.length).toBe(65);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it('returns an empty array for an empty string', () => {
    expect(Array.from(urlBase64ToUint8Array(''))).toEqual([]);
  });
});
