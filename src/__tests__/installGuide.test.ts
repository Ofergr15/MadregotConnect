import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyPlatform, iosMajor, otherSafari } from '@/lib/install/platform';
import { stepsFor, INSTALL_STEPS } from '@/lib/install/steps';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const IOS18 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IOS26 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36';
const sig = (ua: string, o: Partial<{ standalone: boolean; ios: boolean; inApp: boolean }> = {}) =>
  ({ ua, standalone: false, ios: /iphone/i.test(ua), inApp: false, ...o });

describe('which install guide a device gets', () => {
  it('tells Safari 26 from the older bar, even though 26 froze the OS token at 18_6', () => {
    expect(iosMajor(IOS26)).toBe(26);
    expect(classifyPlatform(sig(IOS18))).toBe('ios-safari');
    expect(classifyPlatform(sig(IOS26))).toBe('ios-safari-26');
  });

  it('sends a webview, and Chrome on an iPhone, to Safari first', () => {
    expect(classifyPlatform(sig(IOS18, { inApp: true }))).toBe('ios-inapp');
    expect(classifyPlatform(sig(IOS_CHROME))).toBe('ios-inapp');
  });

  it('android, its webview, a desktop, and the installed app', () => {
    expect(classifyPlatform(sig(ANDROID))).toBe('android');
    expect(classifyPlatform(sig(ANDROID, { inApp: true }))).toBe('android-inapp');
    expect(classifyPlatform(sig('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15'))).toBe('desktop');
    expect(classifyPlatform(sig(IOS18, { standalone: true }))).toBe('standalone');
  });

  it('"looks different on my phone" swaps only between the two Safari layouts', () => {
    expect(otherSafari('ios-safari')).toBe('ios-safari-26');
    expect(otherSafari('ios-safari-26')).toBe('ios-safari');
    expect(otherSafari('android')).toBe('android');
  });
});

describe('the steps', () => {
  it('every Safari path ends on opening from the icon, and Android without the prompt uses the menu', () => {
    for (const p of ['ios-safari', 'ios-safari-26'] as const) expect(INSTALL_STEPS[p].at(-1)!.scene).toBe('home-icon');
    expect(stepsFor('android', true)[0].scene).toBe('android-dialog');
    expect(stepsFor('android', false)[0].scene).toBe('android-menu');
    expect(stepsFor('desktop', false)).toEqual([]);
  });

  it('points at the screen edge only where it cannot be the wrong corner', () => {
    const points = Object.values(INSTALL_STEPS).flat().map(s => s.point).filter(Boolean);
    expect(points).toEqual(['bottom-center']);
  });
});

describe('where it shows', () => {
  it('replaces the install sheet while it is tried, and sits over the end of /join', () => {
    expect(read('components/InstallPrompt.tsx')).toMatch(/if \(v2\) \{\s+return \(\s+<InstallGuide/);
    expect(read('app/join/[token]/page.tsx')).toMatch(/\{guideV2 && !guideClosed && <InstallGuide /);
    expect(read('lib/install/flag.ts')).toMatch(/export const ONBOARDING_V2_FOR_ALL = false;/);
  });

  it('opens on the video once per device, with a skip', () => {
    const g = read('components/install/InstallGuide.tsx');
    expect(g).toMatch(/localStorage\.setItem\(VIDEO_SEEN_KEY, '1'\)/);
    expect(g).toMatch(/דילוג ←/);
  });
});

describe('the approval message', () => {
  it('the v2 link opens the guide, the old one does not', async () => {
    const { joinLinkV2, approvalWhatsAppText } = await import('@/lib/install/flag');
    expect(joinLinkV2('https://www.madregot.app', 'abc12345', true)).toBe('https://www.madregot.app/join/abc12345?onb=v2');
    expect(joinLinkV2('https://www.madregot.app', 'abc12345', false)).toBe('https://www.madregot.app/join/abc12345');
    const text = approvalWhatsAppText('https://x/join/t?onb=v2', 'דבוקה 2');
    expect(text).toContain('https://x/join/t?onb=v2');
    expect(text).toContain('דבוקה 2');
  });

  it('the v2 mail: journey, steps, QR, Safari tip, and a reply that reaches a person', () => {
    const mail = read('lib/email/index.ts');
    const v2 = mail.slice(mail.indexOf('if (user.v2) {'), mail.indexOf("subject: '✅ ההרשמה שלך למדרגות אושרה'"));
    expect(v2).toMatch(/renderJourney\(2\)/);
    expect(v2).toMatch(/renderScanOnPhone\(`\$\{APP_URL\}\/api\/public\/qr\?t=/);
    expect(v2).toMatch(/replyTo: ADMIN_EMAIL/);
    expect(read('lib/email/send.ts')).toMatch(/\.\.\.\(msg\.replyTo \? \{ replyTo: msg\.replyTo \} : \{\}\)/);
  });

  it('only the super user sends it while it is tried, and the queue keeps the link to send on WhatsApp', () => {
    expect(read('app/api/admin/registrations/approve/route.ts')).toMatch(/const v2 = ONBOARDING_V2_FOR_ALL \|\| !!auth\.user\.isSuperUser;/);
    expect(read('app/api/admin/registrations/resend/route.ts')).toMatch(/const v2 = ONBOARDING_V2_FOR_ALL \|\| !!auth\.user\.isSuperUser;/);
    expect(read('app/(app)/dashboard/entry-queue/page.tsx')).toMatch(/approvalWhatsAppText\(a\.url, a\.groupName\)/);
  });

  it('the QR endpoint only draws our own join link', () => {
    const qr = read('app/api/public/qr/route.ts');
    expect(qr).toMatch(/q\.addData\(joinLinkV2\(APP_URL, t, true\)\)/);
    expect(qr).toMatch(/const TOKEN = \/\^\[A-Za-z0-9_-\]\{8,128\}\$\/;/);
  });
});
