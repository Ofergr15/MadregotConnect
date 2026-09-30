'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Search, UserCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import {
  filterAthletes,
  isFormMadeAccount,
  isSyntheticEmail,
  suggestAthleteLinks,
  type LinkableAthlete,
  type LinkableCandidate,
  type MatchConfidence,
} from '@/lib/academy/link';

/**
 * Joining a candidate to the athlete they became.
 *
 * The one screen in the funnel whose mistake is expensive in a way no other mistake here is.
 * Every other control on the board is a tick mark somebody can untick; this one attaches a
 * stranger's injuries and the coach's private `fit` verdict to a real account. So:
 *
 *  - **Nothing links on one tap.** Tapping a row SELECTS it and names it back in a confirm
 *    bar. An exact email match gets the same confirmation as a guess, because a shared family
 *    address is enough to make an exact match the wrong person.
 *
 *  - **An athlete already spoken for is shown, disabled, with the reason.** The partial unique
 *    index would refuse the link with a 409, and finding that out by being refused teaches the
 *    coach nothing. Seeing it also answers a question worth asking: one email across two
 *    candidate rows means there are two rows for one person.
 *
 *  - **What happens is stated before it happens.** The form's answers move to the chosen
 *    account, the account the form opened (if the card is on one) is deleted, and the runner's
 *    app does not change: the academy flag waits for accept.
 *
 *  - **A card on the account the form opened is still open to linking.** That is what the form
 *    does for a club member who signed up with Strava (a placeholder address it cannot match),
 *    so the sheet offers the real account and the whole roster search, not just an unlink.
 *
 *  - **Names match across alphabets, as a suggestion only.** `אבי ברק` meets `Avi Barak`
 *    through the same consonant skeletons that join Strava logins to the roster. The search
 *    box is still there for whoever the matcher misses.
 */

const ROW = 'flex w-full items-center justify-between gap-3 min-h-[56px] rounded-card px-3.5 text-start';

/** How sure the suggestion is, as three visibly different things rather than three greys. */
const BADGE: Record<MatchConfidence, string> = {
  exact: 'bg-accent-700 text-white',
  likely: 'bg-brand-600 text-white',
  weak: 'bg-card text-ink-500',
};

/** A fabricated Strava address is not an identity and must not be shown as one. */
function contactLine(athlete: LinkableAthlete): string | null {
  return athlete.email && !isSyntheticEmail(athlete.email) ? athlete.email : null;
}

export function LinkAthleteSheet({
  open,
  onOpenChange,
  candidate,
  athletes,
  takenBy,
  since,
  linkedAthlete,
  onLink,
  onUnlink,
  busy,
  loadFailed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidate: LinkableCandidate;
  /** The roster. Staff-only data, and this sheet is inside a staff-only screen. */
  athletes: readonly LinkableAthlete[];
  /** athleteId → the candidate already holding it, so the unique index is visible up front. */
  takenBy?: Readonly<Record<string, string>>;
  /** The candidate's last event, which is what a near-enough registration date is near to. */
  since?: string | null;
  /** The athlete already joined, when there is one. */
  linkedAthlete?: LinkableAthlete | null;
  onLink: (athleteId: string) => void;
  onUnlink?: () => void;
  busy?: boolean;
  /** The roster could not be read. A search box over nothing is worse than saying so. */
  loadFailed?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<LinkableAthlete | null>(null);

  // A different candidate is a different question. The sheet stays mounted, so without this
  // the next card opens with the previous card's selection armed in the confirm bar.
  useEffect(() => { setQuery(''); setChosen(null); }, [candidate.id, open]);

  const suggestions = useMemo(
    () => suggestAthleteLinks(candidate, athletes, { takenBy, since }),
    [candidate, athletes, takenBy, since],
  );

  // The search results, minus everybody already shown above them: the same person appearing
  // twice in one list reads as two people. The `Set` is built INSIDE the memo — a new one on
  // every render is a new dependency on every render, so the memo would never hold.
  // The account the form opened is not the runner: the card stays open to a real account.
  const fromForm = isFormMadeAccount(linkedAthlete);
  const pinned = linkedAthlete && !fromForm ? linkedAthlete : null;

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const suggested = new Set(suggestions.map(s => s.athlete.id));
    return filterAthletes(athletes, query).filter(
      a => !suggested.has(a.id) && a.id !== candidate.athleteId,
    );
  }, [athletes, query, suggestions, candidate.athleteId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`חיבור לחשבון · ${candidate.name}`}>
      <div className="px-4 pb-6">
        {pinned ? (
          <>
            <div className="flex items-center gap-2 rounded-card bg-page px-3.5 py-3">
              <UserCheck className="h-4 w-4 shrink-0 text-accent-700" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink-900" dir="auto">{pinned.name}</p>
                {contactLine(pinned) && (
                  <p className="truncate text-xs text-ink-500"><bdi dir="ltr">{contactLine(pinned)}</bdi></p>
                )}
              </div>
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-ink-500" dir="auto">
              מכאן הטסט, הדבוקה והתוכנית נקראים מהחשבון הזה. כל השלבים שכבר בוצעו נשארים על הכרטיס.
            </p>
            {onUnlink && (
              <button
                type="button"
                onClick={onUnlink}
                disabled={busy}
                // Not red, and not beside anything. Unlinking is how a mistake gets fixed, so
                // it must be findable — but it is also how a correct link gets undone by
                // accident, so it is small, low and alone.
                className="mt-5 min-h-[44px] w-full text-xs font-medium text-ink-500 disabled:opacity-50"
              >
                {busy ? 'מבטל…' : 'ביטול החיבור'}
              </button>
            )}
          </>
        ) : loadFailed ? (
          <p className="flex items-center gap-1.5 rounded-card bg-page px-3.5 py-3 text-xs text-accent-red-ink" dir="auto">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            רשימת הספורטאים לא נטענה. נסה לסגור ולפתוח שוב.
          </p>
        ) : (
          <>
            {fromForm ? (
              <div className="rounded-card bg-page px-3.5 py-3 text-xs leading-relaxed text-ink-500" dir="auto">
                <p className="text-sm font-bold text-ink-900">כרגע: חשבון חדש שנפתח מהטופס</p>
                אם הוא כבר רץ אצלנו, בחר את החשבון שלו. הטופס, השלבים וההערות יעברו אליו.
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-ink-500" dir="auto">
                ההצעות למטה לפי אימייל, טלפון, שם (גם בין עברית לאנגלית) ותאריך הרשמה. תמיד רק הצעה.
              </p>
            )}

            {suggestions.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {suggestions.map(({ athlete, reason, confidence, text, taken }) => (
                  <li key={athlete.id}>
                    <button
                      type="button"
                      onClick={() => setChosen(athlete)}
                      disabled={taken || busy}
                      className={cn(
                        ROW,
                        'bg-page disabled:opacity-60',
                        chosen?.id === athlete.id && 'ring-2 ring-brand-600',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-ink-900" dir="auto">{athlete.name}</span>
                        {/* The reason and the address are two lines, each truncating on its own.
                            One line carrying both is 232px of content in 220px on the 375 phone,
                            and what gets cut is the END — the address, mid-domain, leaving the
                            reason and a dangling separator. A half-shown address is the one
                            thing here that must stay readable: seeing it whole is how the coach
                            catches a shared family address, which is the exact way an "exact"
                            email match turns out to be the wrong person.

                            And when the reason IS the email, the address is shown INSTEAD of
                            the phrase rather than under it. `אותה כתובת אימייל` above
                            `avi@example.com` says one fact twice, and the badge already says
                            this is a match. */}
                        <span className="block truncate text-xs text-ink-500" dir="auto">
                          {reason === 'email' && contactLine(athlete)
                            ? <bdi dir="ltr">{contactLine(athlete)}</bdi>
                            : text}
                        </span>
                        {taken ? (
                          // WHY the row is here comes first, and the refusal second. A disabled
                          // row that only says "taken" reads as arbitrary, and the reason is the
                          // useful half: one email across two candidate rows means there are two
                          // rows for one person, which is a thing to go and fix.
                          <span className="block truncate text-xs text-accent-red-ink" dir="auto">
                            מחובר למועמד אחר
                          </span>
                        ) : reason !== 'email' && contactLine(athlete) && (
                          <span className="block truncate text-xs text-ink-400">
                            <bdi dir="ltr">{contactLine(athlete)}</bdi>
                          </span>
                        )}
                      </span>
                      <span className={cn('shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-bold', BADGE[confidence])} dir="auto">
                        {confidence === 'exact' ? 'התאמה' : confidence === 'likely' ? 'כנראה' : 'אפשרי'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-semibold text-ink-500" dir="auto">
                {suggestions.length > 0 ? 'או חיפוש בשם או באימייל' : 'חיפוש בשם או באימייל'}
              </span>
              <span className="relative block">
                <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Avi"
                  // 16px or iOS Safari zooms the page the moment the field is focused.
                  className="w-full min-h-[44px] rounded-card bg-page px-3 pe-9 text-[16px] text-ink-900 placeholder:text-ink-400"
                  dir="auto"
                />
              </span>
            </label>

            {query.trim() !== '' && (
              results.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {results.map(athlete => {
                    const taken = takenBy?.[athlete.id] !== undefined;
                    return (
                      <li key={athlete.id}>
                        <button
                          type="button"
                          onClick={() => setChosen(athlete)}
                          disabled={taken || busy}
                          className={cn(
                            ROW,
                            'bg-page disabled:opacity-60',
                            chosen?.id === athlete.id && 'ring-2 ring-brand-600',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-ink-900" dir="auto">{athlete.name}</span>
                            <span className="block truncate text-xs text-ink-500" dir="auto">
                              {taken ? 'מחובר למועמד אחר' : contactLine(athlete)
                                ? <bdi dir="ltr">{contactLine(athlete)}</bdi>
                                : 'אין אימייל'}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 px-1 text-xs text-ink-400" dir="auto">אין ספורטאי בשם הזה</p>
              )
            )}

            {suggestions.length === 0 && query.trim() === '' && (
              // Not an error. On day one there is no athlete row yet, because the person has
              // not registered — and the sheet has to say which of the two it is.
              <p className="mt-3 px-1 text-xs leading-relaxed text-ink-400" dir="auto">
                אין הצעה אוטומטית. אם הוא עוד לא נרשם לאפליקציה — אין למה לחבר, וזה שלב 4 במשפך.
              </p>
            )}
          </>
        )}
      </div>

      {/* The confirm bar. Named back rather than tapped once: this write attaches one person's
          history to another person's account, and an exact email match is no less capable of
          being the wrong person than a guess is. */}
      {chosen && !pinned && (
        // Sticky, because the row that was tapped may be at the top of a long roster and a
        // confirm bar below the fold is a tap that appears to have done nothing. The drawer's
        // body is the scroll container, so this sticks to the bottom of what is visible.
        <div className="sticky bottom-0 border-t border-page bg-card py-3">
          <p className="text-xs text-ink-700" dir="auto">
            לחבר את <span className="font-bold">{candidate.name}</span> לחשבון{' '}
            <bdi dir="ltr" className="font-bold">{chosen.name}</bdi>?
          </p>
          {/* What the link does, said before it happens: two of the three are writes. */}
          <ul className="mt-1 list-disc ps-4 text-[11px] leading-relaxed text-ink-500" dir="auto">
            <li>התשובות מהטופס עוברות לחשבון שלו</li>
            {fromForm && <li>החשבון החדש שנפתח מהטופס יימחק</li>}
            <li>האפליקציה שלו לא משתנה: לשונית האקדמיה נפתחת לו רק ב&quot;קבלה&quot;</li>
          </ul>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => onLink(chosen.id)}
              disabled={busy}
              className="flex-1 min-h-[48px] rounded-card bg-accent-700 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? 'מחבר…' : 'חיבור'}
            </button>
            <button
              type="button"
              onClick={() => setChosen(null)}
              className="flex items-center gap-1 min-h-[48px] rounded-card bg-page px-4 text-sm font-medium text-ink-500"
            >
              <X className="h-4 w-4" />
              ביטול
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
