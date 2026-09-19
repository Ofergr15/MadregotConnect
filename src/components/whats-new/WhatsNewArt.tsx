import { Check, Moon, Watch } from 'lucide-react';
import type { WhatsNewArt as ArtKey, WhatsNewLang } from '@/lib/whats-new/entries';

/**
 * The thumbnail on a what's-new row — the feature itself, drawn.
 *
 * Not a photo of somebody running: the whole argument for interrupting anyone is
 * that the row shows them something they cannot already do, and a stock runner
 * says nothing the title did not. Not a screenshot either, for now — a real one
 * would be a binary asset per feature that goes stale the next time the screen is
 * restyled, and at 84 px wide the parts of a screenshot that carry meaning are
 * below the noise floor anyway.
 *
 * So each scene is composed once at 320×200 and scaled into the 84 px slot. That
 * is why the type sizes below look absurd for a thumbnail: they are being read at
 * 26 % and the composition survives the reduction, where a re-flowed layout turns
 * into three grey smudges.
 *
 * When a feature is genuinely visual enough to deserve a photograph, give the
 * entry an `image` and render it here instead — the slot is the same box.
 */

const SCALE = 0.2625;   // 84 / 320, and 53 / 200

/**
 * The handful of words inside the pictures. In the entry's language, because the
 * art is a picture OF the app and the app an English reader opens is in English —
 * a Hebrew thumbnail beside an English row is a screenshot of somebody else's
 * phone. Same call, and same reasoning, as WEEK_CARD_TEXT on the share card.
 */
const ART_TEXT = {
  he: {
    club: 'מדרגות', km: 'ק״מ', hours: 'שעות', pace: 'קצב',
    session: 'מחר · אינטרוולים', distance: '12 ק״מ', plan: 'תוכנית', actual: 'ביצוע',
  },
  en: {
    club: 'MADREGOT', km: 'km', hours: 'hours', pace: 'pace',
    session: 'Tomorrow · intervals', distance: '12 km', plan: 'plan', actual: 'actual',
  },
} satisfies Record<WhatsNewLang, Record<string, string>>;

function Scene({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className="relative block h-[53px] w-[84px] shrink-0 overflow-hidden rounded-xl bg-page">
      <span
        className={`absolute left-1/2 top-1/2 flex h-[200px] w-[320px] items-center justify-center ${className || ''}`}
        style={{ transform: `translate(-50%, -50%) scale(${SCALE})` }}
      >
        {children}
      </span>
    </span>
  );
}

/** The story card: the club mark over a frosted panel of the week's numbers. */
function WeekShareScene({ lang }: { lang: WhatsNewLang }) {
  const w = ART_TEXT[lang];
  return (
    <Scene className="flex-col gap-2.5 bg-gradient-to-br from-[#2f45ff] to-[#1b1150]">
      <span className="text-[19px] font-black tracking-[0.16em] text-white">{w.club}</span>
      <span className="w-[74%] rounded-xl border border-white/25 bg-white/15 px-3 py-2">
        {[[w.km, '42'], [w.hours, '3:48'], [w.pace, '5:26']].map(([label, value], i) => (
          <span
            key={label}
            className={`flex items-baseline justify-between py-1 ${i > 0 ? 'border-t border-white/15' : ''}`}
          >
            <span className="text-[11px] font-bold text-white/60">{label}</span>
            <span className="text-[19px] font-black text-white">{value}</span>
          </span>
        ))}
      </span>
    </Scene>
  );
}

/** The feed row itself, watch pill and all. */
function NextSessionScene({ lang }: { lang: WhatsNewLang }) {
  const w = ART_TEXT[lang];
  return (
    <Scene className="bg-[#EEF0F7] px-5">
      <span className="flex w-full items-center gap-2 rounded-2xl bg-card px-3 py-3.5 shadow-md">
        <span className="h-5 w-5 shrink-0 rounded-md bg-accent-red" />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="whitespace-nowrap text-[14px] font-black text-ink-900">{w.session}</span>
          <span className="text-[12px] font-bold text-ink-500">{w.distance}</span>
        </span>
        <span className="shrink-0 rounded-full bg-[#E9E4FF] p-1.5">
          <Moon className="h-3 w-3 text-[#4632B5]" />
        </span>
        <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-accent-600/10 px-1.5 py-1.5">
          <Watch className="h-3 w-3 text-accent-600" />
          <Check className="h-3 w-3 text-accent-600" />
        </span>
      </span>
    </Scene>
  );
}

/** Plan against execution: paired bars, plan behind, run in front. */
function PlanVsExecutionScene({ lang }: { lang: WhatsNewLang }) {
  const w = ART_TEXT[lang];
  const pairs = [[62, 74], [80, 78], [46, 66], [90, 88], [70, 52]];
  return (
    <Scene className="flex-col gap-2 bg-card px-5 pb-3.5 pt-5">
      <span className="flex w-full flex-1 items-end justify-between">
        {pairs.map(([plan, real], i) => (
          <span key={i} className="flex h-full items-end gap-[3px]">
            <span className="w-[13px] rounded-t bg-ink-300" style={{ height: `${plan}%` }} />
            <span className="w-[13px] rounded-t bg-brand-600" style={{ height: `${real}%` }} />
          </span>
        ))}
      </span>
      <span className="flex gap-4 text-[11px] font-extrabold text-ink-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-ink-300" />{w.plan}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-brand-600" />{w.actual}</span>
      </span>
    </Scene>
  );
}

/** Missing a scene for a new art key is a compile error, not a blank thumbnail. */
const SCENES: Record<ArtKey, (p: { lang: WhatsNewLang }) => React.ReactElement> = {
  weekShare: WeekShareScene,
  nextSession: NextSessionScene,
  planVsExecution: PlanVsExecutionScene,
};

export function WhatsNewArt({ art, lang }: { art: ArtKey; lang: WhatsNewLang }) {
  const Render = SCENES[art];
  return <Render lang={lang} />;
}
