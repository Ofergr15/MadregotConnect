import Link from 'next/link';

/** Shown instead of a sign-up form while `signups_open` is off. Server component, no state. */
export function SignupsClosed() {
  return (
    <main dir="rtl" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f0f0f0] px-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/25">
        <img src="/images/logo-white.png" alt="" className="h-9 w-9 object-contain" />
      </span>
      <h1 className="text-2xl font-black text-ink-900">ההרשמה סגורה כרגע</h1>
      <p className="max-w-xs text-base leading-relaxed text-ink-500">
        המועדון לא מקבל חברים חדשים בזמן הזה. כבר חברים? נכנסים עם המייל.
      </p>
      <Link href="/" className="mt-2 inline-flex min-h-[52px] items-center justify-center rounded-full bg-brand-600 px-8 text-base font-black text-white">
        כניסה לחברים
      </Link>
    </main>
  );
}
