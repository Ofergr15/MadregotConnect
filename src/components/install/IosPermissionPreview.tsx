'use client';

// The phone's own notification-permission popup, drawn BEFORE it appears, with
// the button to press ringed. "Don't Allow" is the reflex tap on a surprise system
// dialog, and on iOS a refusal can only be undone deep in Settings.
//
// In the PHONE's language, because that is the language the real popup comes up
// in: a Hebrew app on an English iPhone still gets "Allow", and a preview that
// says "אפשר" points at a word that is not on the screen (Ofer's own phone,
// 2026-10-06). iOS and Android draw it differently, so both are here.

import { useEffect, useState } from 'react';

type Kind = 'ios-he' | 'ios-en' | 'android-he' | 'android-en';

const COPY: Record<Kind, { title: string; body?: string; no: string; yes: string; dir: 'rtl' | 'ltr' }> = {
  'ios-en': { title: '“Madregot” Would Like to Send You Notifications', body: 'Notifications may include alerts, sounds, and icon badges.', no: 'Don’t Allow', yes: 'Allow', dir: 'ltr' },
  'ios-he': { title: '״מדרגות״ רוצה לשלוח לך הודעות', body: 'ההודעות עשויות לכלול התראות, צלילים וסמלים.', no: 'אל תאפשר', yes: 'אפשר', dir: 'rtl' },
  'android-en': { title: 'Allow madregot.app to send notifications?', no: 'Don’t allow', yes: 'Allow', dir: 'ltr' },
  'android-he': { title: 'לאפשר ל-madregot.app לשלוח התראות?', no: 'אין לאפשר', yes: 'אישור', dir: 'rtl' },
};

/** Which popup this phone will show. Exported for the tests. */
export function permissionKind(ua: string, languages: readonly string[]): Kind {
  const he = (languages[0] || '').toLowerCase().startsWith('he') || (languages[0] || '').toLowerCase().startsWith('iw');
  const android = /android/i.test(ua);
  return `${android ? 'android' : 'ios'}-${he ? 'he' : 'en'}` as Kind;
}

export function IosPermissionPreview() {
  const [kind, setKind] = useState<Kind | null>(null);
  useEffect(() => {
    setKind(permissionKind(navigator.userAgent, navigator.languages?.length ? navigator.languages : [navigator.language]));
  }, []);
  if (!kind) return null;
  const c = COPY[kind];
  const ios = kind.startsWith('ios');
  return (
    <div className="mt-4" aria-hidden>
      {ios ? (
        <div dir={c.dir} className="mx-auto max-w-[272px] rounded-[18px] bg-[rgba(242,242,247,0.98)] pt-3.5 text-center shadow-[0_12px_32px_rgba(0,0,0,0.16)]">
          <p className="px-4 text-[13.5px] font-semibold leading-snug text-[#111]">{c.title}</p>
          {c.body && <p className="mt-1 px-4 text-[11.5px] leading-snug text-[#3c3c43]">{c.body}</p>}
          <div className="mt-3 flex border-t border-[#d1d1d6] text-[15px] text-[#007aff]">
            <span className="flex-1 py-2.5">{c.no}</span>
            <span className="relative flex-1 border-s border-[#d1d1d6] py-2.5 font-semibold">
              {c.yes}
              <span className="absolute inset-[3px] rounded-[10px] border-[3px] border-[#FF5315]" />
            </span>
          </div>
        </div>
      ) : (
        <div dir={c.dir} className="mx-auto max-w-[290px] rounded-[26px] bg-white p-4 text-start shadow-[0_12px_32px_rgba(0,0,0,0.18)]">
          <p className="text-[14.5px] leading-snug text-[#1f1f1f]">{c.title}</p>
          <div className="mt-4 flex justify-end gap-2 text-[14px] font-medium text-[#0b57d0]">
            <span className="px-3 py-1.5">{c.no}</span>
            <span className="relative rounded-full bg-[#0b57d0] px-4 py-1.5 text-white">
              {c.yes}
              <span className="absolute -inset-[5px] rounded-full border-[3px] border-[#FF5315]" />
            </span>
          </div>
        </div>
      )}
      <p className="mt-2.5 text-center text-13 font-bold text-[#c2410c]">↑ בחלון שיופיע לוחצים ״{c.yes}״</p>
    </div>
  );
}
