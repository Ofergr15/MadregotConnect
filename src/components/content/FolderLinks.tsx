'use client';

import { useState } from 'react';
import { Check, Link2 } from 'lucide-react';

// The folder's two quick doors (Ofer 10-23: "a quick button next to it, like the story copy,
// with the logo — nothing written, just convenient"): open it in Drive, copy its link.

/** Google Drive's mark, drawn — no asset to load, crisp at any size. */
export function DriveMark({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 87.3 78" className={className} aria-hidden>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

export function FolderLinks({ link, name }: { link: string; name: string }) {
  const [copied, setCopied] = useState(false);
  if (!link) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* the open button still works */ }
  };
  const btn = 'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-page active:scale-95';
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <a href={link} target="_blank" rel="noopener noreferrer" aria-label={`לפתוח את ${name} בדרייב`} className={btn}><DriveMark /></a>
      <button type="button" onClick={() => void copy()} aria-label={`להעתיק קישור ל${name}`} className={btn}>
        {copied ? <Check className="h-4 w-4 text-[#15803d]" strokeWidth={3} /> : <Link2 className="h-4 w-4 text-ink-700" />}
      </button>
    </span>
  );
}
