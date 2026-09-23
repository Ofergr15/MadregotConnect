'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { WHATS_NEW, type WhatsNewLang } from '@/lib/whats-new/entries';
import { recentEntries } from '@/lib/whats-new/ledger';
import { WhatsNewArt } from './WhatsNewArt';

/**
 * WHAT'S NEW, ON THE WAY IN.
 *
 * The digest sheet deliberately never opens for somebody new (ledger.ts rule 1):
 * a feature that shipped before you arrived is not news, it is the app. But that
 * leaves a real gap — the two best things in here are exactly the things a new
 * member would not think to look for, and they would never be told.
 *
 * So the same entries appear once, here, on the screen where a new member is
 * waiting for approval and has nothing else to do. Three differences from the
 * sheet, all of them deliberate:
 *
 *   · the rows are NOT links. This account is not approved yet; every one of
 *     those pages would bounce it. A row that cannot work should not look
 *     tappable, so there is no chevron and no active state.
 *   · it does not touch the ledger. Nothing here is "spent" — if one of these two
 *     is still recent when the member is approved, the Settings row still lists
 *     it. Writing a ledger for an account that may never be approved would be
 *     bookkeeping about a stranger.
 *   · it says the quiet part out loud. The last line is the only place the app
 *     ever explains that new features arrive this way, which is what turns the
 *     first real sheet from an interruption into something expected.
 */

function onboardLang(locale: string): WhatsNewLang {
  return locale === 'en' ? 'en' : 'he';
}

export function WhatsNewOnboardingCard() {
  const t = useTranslations('whatsNew');
  const lang = onboardLang(useLocale());
  const entries = recentEntries(WHATS_NEW);

  if (entries.length === 0) return null;

  return (
    <section className="mt-6 rounded-xl border border-page bg-page/30 p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-ink-700">
        <Sparkles className="h-4 w-4 text-brand-600" />
        {t('onboardTitle')}
      </h3>
      <p className="mt-1 text-xs text-ink-400">{t('onboardLead')}</p>

      <ul className="mt-3 divide-y divide-page">
        {entries.map((e) => {
          const copy = e[lang];
          return (
            <li key={e.slug} className="flex items-start gap-3 py-3">
              {e.art && <WhatsNewArt art={e.art} lang={lang} />}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink-900">{copy.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-ink-500">{copy.body}</span>
              </span>
            </li>
          );
        })}
      </ul>

      {/* The promise. Said once, on the way in, so the first sheet is expected. */}
      <p className="mt-1 text-xs font-medium text-brand-600">{t('onboardPromise')}</p>
    </section>
  );
}
