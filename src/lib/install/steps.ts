// The install guide's steps per platform — the words and which picture goes with
// each. One list feeds both the step-by-step guide and the short video that opens
// before it, so the two can never tell a member different things.
//
// `point` is where the real browser control sits on the PHYSICAL screen, outside
// the page: the guide draws a pulsing arrow at that edge of the viewport, toward
// the button the member actually has to press. Only where it cannot be wrong: a
// phone set to Hebrew mirrors its toolbars, so a corner can be either corner, and
// an arrow at the wrong one is worse than none. Safari's Share, in the middle of
// the bottom bar, is the one place that is the same both ways.

import type { InstallPlatform } from './platform';

export type InstallScene =
  | 'safari-share'        // Safari ≤18 bottom bar, Share in the middle
  | 'safari26-menu'       // Safari 26 bottom bar, the ⋯ at the right
  | 'safari26-share'      // the ⋯ menu open, Share in it
  | 'share-sheet'         // the share sheet, "Add to Home Screen" marked
  | 'add-confirm'         // the Add to Home Screen screen, "Add" marked
  | 'home-icon'           // the home screen with the new icon
  | 'inapp-menu'          // a webview's ⋯ menu, "Open in Safari/Chrome" marked
  | 'android-dialog'      // Chrome's install dialog
  | 'android-menu';       // Chrome's ⋮ menu, "Install app" marked

export type PointAt = 'bottom-center' | 'bottom-right' | 'top-right' | null;

export interface InstallStep {
  title: string;
  body: string;
  scene: InstallScene;
  point: PointAt;
  /** The caption the video shows over this step's picture. */
  caption: string;
}

const OPEN_FROM_ICON: InstallStep = {
  title: 'פותחים מהאייקון החדש',
  body: 'האייקון של מדרגות מחכה במסך הבית. סוגרים את הדפדפן, ומעכשיו נכנסים רק משם.',
  scene: 'home-icon',
  point: null,
  caption: 'פותחים מהאייקון החדש. זהו!',
};

const SHARE_SHEET: InstallStep = {
  title: 'בוחרים "הוספה למסך הבית"',
  body: 'בחלון שנפתח גוללים קצת למטה. זאת השורה עם הריבוע והפלוס.',
  scene: 'share-sheet',
  point: null,
  caption: 'גוללים ובוחרים "הוספה למסך הבית"',
};

const ADD_CONFIRM: InstallStep = {
  title: 'לוחצים "הוספה" למעלה',
  body: 'בפינה העליונה של המסך (בטלפון בעברית זה בצד שמאל). השם "מדרגות" כבר כתוב, לא צריך לשנות כלום.',
  scene: 'add-confirm',
  point: null,
  caption: 'לוחצים "הוספה" למעלה',
};

export const INSTALL_STEPS: Record<Exclude<InstallPlatform, 'standalone' | 'desktop'>, InstallStep[]> = {
  'ios-safari': [
    {
      title: 'לוחצים על כפתור השיתוף',
      body: 'הריבוע עם החץ למעלה, באמצע השורה התחתונה של המסך.',
      scene: 'safari-share',
      point: 'bottom-center',
      caption: 'לוחצים על כפתור השיתוף, למטה באמצע',
    },
    SHARE_SHEET,
    ADD_CONFIRM,
    OPEN_FROM_ICON,
  ],
  'ios-safari-26': [
    {
      title: 'לוחצים על ⋯ בשורה התחתונה',
      body: 'שלוש הנקודות בעיגול, ליד הכתובת בשורה התחתונה של המסך.',
      scene: 'safari26-menu',
      point: null,
      caption: 'לוחצים על שלוש הנקודות, למטה בצד',
    },
    {
      title: 'בוחרים "שיתוף"',
      body: 'בתפריט שנפתח, השורה עם הריבוע והחץ למעלה.',
      scene: 'safari26-share',
      point: null,
      caption: 'בוחרים "שיתוף"',
    },
    SHARE_SHEET,
    { ...ADD_CONFIRM, body: 'בפינה העליונה. אם יש מתג "לפתוח כאפליקציה", משאירים אותו דלוק.' },
    OPEN_FROM_ICON,
  ],
  'ios-inapp': [
    {
      title: 'פותחים את הקישור ב-Safari',
      body: 'מתוך וואטסאפ, Gmail או אינסטגרם אי אפשר להוסיף למסך הבית. לוחצים על התפריט (⋯ או החץ) ובוחרים "פתיחה ב-Safari".',
      scene: 'inapp-menu',
      point: null,
      caption: 'קודם עוברים ל-Safari: תפריט ← "פתיחה ב-Safari"',
    },
  ],
  android: [
    {
      title: 'לוחצים "התקנה"',
      body: 'אנדרואיד יפתח חלון קטן. לוחצים בו "התקנה", והאפליקציה נכנסת למסך הבית.',
      scene: 'android-dialog',
      point: null,
      caption: 'לוחצים "התקנה" בחלון שנפתח',
    },
    OPEN_FROM_ICON,
  ],
  'android-inapp': [
    {
      title: 'פותחים את הקישור ב-Chrome',
      body: 'מתוך וואטסאפ או Gmail אי אפשר להתקין. לוחצים על ⋮ למעלה ובוחרים "פתיחה ב-Chrome".',
      scene: 'inapp-menu',
      point: null,
      caption: 'קודם עוברים ל-Chrome: ⋮ ← "פתיחה ב-Chrome"',
    },
  ],
};

/** Android without a captured `beforeinstallprompt`: the same thing through Chrome's own menu. */
export const ANDROID_MENU_STEPS: InstallStep[] = [
  {
    title: 'לוחצים על ⋮ למעלה',
    body: 'שלוש הנקודות בפינה העליונה של Chrome, ושם "התקנת אפליקציה" (או "הוספה למסך הבית").',
    scene: 'android-menu',
    point: null,
    caption: '⋮ למעלה ← "התקנת אפליקציה"',
  },
  OPEN_FROM_ICON,
];

export function stepsFor(platform: InstallPlatform, canPrompt: boolean): InstallStep[] {
  if (platform === 'standalone' || platform === 'desktop') return [];
  if (platform === 'android' && !canPrompt) return ANDROID_MENU_STEPS;
  return INSTALL_STEPS[platform];
}

/** How long each step's picture stays in the video, and the total. */
export const VIDEO_STEP_MS = 5200;
export const videoLengthMs = (steps: InstallStep[]) => steps.length * VIDEO_STEP_MS;
