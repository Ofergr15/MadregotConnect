import { describe, expect, it } from 'vitest';
import { classifyPlatform } from '@/lib/install/platform';

/**
 * Computer vs phone, the cases measured in the lab (2026-10-09, Playwright
 * device emulation). The one that used to be wrong: an Android phone on
 * "Desktop site" sends a Linux desktop UA and was classified as a computer, so
 * it would have lost the install guide and the notification step.
 */
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const LINUX_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const WIN_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const sig = (ua: string, over: Partial<Parameters<typeof classifyPlatform>[0]> = {}) => ({ ua, standalone: false, ios: false, inApp: false, fingerPrimary: false, ...over });

describe('computer detection', () => {
  it('a Mac or Windows browser with a mouse or trackpad is a computer', () => {
    expect(classifyPlatform(sig(MAC_SAFARI))).toBe('desktop');
    expect(classifyPlatform(sig(WIN_EDGE))).toBe('desktop');
  });
  it('a touchscreen laptop (finger is not the PRIMARY pointer) is still a computer', () => {
    expect(classifyPlatform(sig(WIN_EDGE, { fingerPrimary: false }))).toBe('desktop');
  });
  it('an Android phone on "Desktop site" is a phone, not a computer', () => {
    expect(classifyPlatform(sig(LINUX_CHROME, { fingerPrimary: true }))).toBe('android');
  });
  it('an iPhone asking for the desktop website is still an iPhone (the touch check)', () => {
    expect(classifyPlatform(sig(MAC_SAFARI, { ios: true }))).toBe('ios-safari-26');
  });
  it('a real Android phone is a phone', () => {
    expect(classifyPlatform(sig(PIXEL, { fingerPrimary: true }))).toBe('android');
  });
  it('an installed app is never a computer', () => {
    expect(classifyPlatform(sig(MAC_SAFARI, { standalone: true }))).toBe('standalone');
  });
});
