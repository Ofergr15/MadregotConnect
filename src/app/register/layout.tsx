import Link from 'next/link';

// Someone who taps "מצטרפים למועדון" by mistake had no way back to sign-in (25.11, right
// after the Frankfurt move when every member signs in again). One fixed link on every
// /register step returns to the landing page with the sign-in sheet open.
export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Link
        href="/?signin=1"
        dir="rtl"
        className="fixed z-[320] rounded-pill bg-black/55 px-4 py-2 text-sm font-bold text-white backdrop-blur"
        style={{ top: 'calc(env(safe-area-inset-top) + 10px)', insetInlineStart: 'max(12px, env(safe-area-inset-left))' }}
      >
        → כבר חברים? כניסה
      </Link>
    </>
  );
}
