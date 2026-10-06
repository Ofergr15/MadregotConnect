'use client';

// The iPhone's own notification-permission popup, drawn BEFORE it appears, with
// the button to press ringed. "Don't Allow" is the reflex tap on a surprise system
// dialog, and on iOS a refusal can only be undone deep in Settings. Used by the
// notifications step of the first run (onboarding v2, iOS only).

export function IosPermissionPreview() {
  return (
    <div className="mt-4" aria-hidden>
      <div className="mx-auto max-w-[270px] rounded-2xl bg-[rgba(242,242,247,0.98)] pt-3 text-center shadow-[0_10px_30px_rgba(0,0,0,0.14)]">
        <p className="px-4 text-[13px] font-bold text-ink-900">״מדרגות״ רוצה לשלוח לך הודעות</p>
        <p className="mt-0.5 px-4 text-[11px] text-ink-500">ההודעות עשויות לכלול התראות, צלילים וסמלים.</p>
        <div className="mt-3 flex border-t border-[#d8d8dd] text-[14px] text-[#007aff]" dir="rtl">
          <span className="flex-1 py-2.5">אל תאפשר</span>
          <span className="flex-1 rounded-be-2xl border-s border-[#d8d8dd] py-2.5 font-bold outline outline-[3px] -outline-offset-[3px] outline-[#FF5315]">אפשר</span>
        </div>
      </div>
      <p className="mt-2 text-center text-13 font-bold text-[#c2410c]">↑ בחלון שיופיע לוחצים ״אפשר״</p>
    </div>
  );
}
