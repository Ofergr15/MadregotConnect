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
  /**
   * A REAL screenshot of this step (an iPhone 17 Pro, iOS 26, Safari "Bottom"
   * layout — Ofer's own phone, 2026-10-06, contacts and wallpaper blurred), shown
   * instead of the drawing, with a ring on the control to press. Box in % of the
   * picture, so it holds at any width.
   */
  shot?: { src: string; ring: { x: number; y: number; w: number; h: number; round?: boolean } };
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

// iOS 26+ with Safari's "Bottom" layout — the layout every iPhone that UPGRADED
// keeps, so the common one in the club. Measured on a real phone: the share
// sheet opens WITHOUT "Add to Home Screen"; it is behind "View More".
const IOS26_BOTTOM: InstallStep[] = [
    {
      title: 'לוחצים על כפתור השיתוף',
      body: 'הריבוע עם החץ למעלה, באמצע השורה התחתונה, מתחת לכתובת.',
      scene: 'safari-share',
      point: 'bottom-center',
      caption: 'לוחצים על כפתור השיתוף',
      shot: { src: '/images/install/ios-share.jpg', ring: { x: 48.7, y: 94.2, w: 13, h: 6, round: true } },
    },
    {
      title: 'לוחצים "View More" (החץ למטה)',
      body: 'בחלון שנפתח, העיגול האחרון בשורה התחתונה. בטלפון בעברית: "עוד".',
      scene: 'share-sheet',
      point: null,
      caption: 'לוחצים View More (החץ למטה)',
      shot: { src: '/images/install/ios-view-more.jpg', ring: { x: 82.8, y: 89.2, w: 15, h: 7, round: true } },
    },
    {
      title: 'בוחרים "Add to Home Screen"',
      body: 'השורה האחרונה ברשימה, עם הריבוע והפלוס. בטלפון בעברית: "הוספה למסך הבית".',
      scene: 'share-sheet',
      point: null,
      caption: 'בוחרים Add to Home Screen',
      shot: { src: '/images/install/ios-add-to-home.jpg', ring: { x: 50, y: 94.4, w: 92, h: 5.5 } },
    },
    {
      title: 'משאירים את המתג דלוק, ולוחצים "Add"',
      body: 'המתג "Open as Web App" צריך להיות ירוק. אחר כך הכפתור הכחול למעלה.',
      scene: 'add-confirm',
      point: null,
      caption: 'משאירים את המתג דלוק, ולוחצים Add',
      shot: { src: '/images/install/ios-add.jpg', ring: { x: 88, y: 11.5, w: 20, h: 5.5, round: true } },
    },
    {
      ...OPEN_FROM_ICON,
      shot: { src: '/images/install/ios-home-icon.jpg', ring: { x: 15.7, y: 71.4, w: 19, h: 9, round: true } },
    },
  ];

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
  'ios-safari-26': IOS26_BOTTOM,
  // iOS 26+ with the "Compact" layout (a new phone's default): Share is behind the menu button.
  'ios-safari-compact': [
    {
      title: 'לוחצים על ☰ בשורה התחתונה',
      body: 'הכפתור העגול ליד הכתובת (בגרסאות מסוימות: שלוש נקודות ⋯).',
      scene: 'safari26-menu',
      point: null,
      caption: 'לוחצים על ☰ בשורה למטה',
    },
    {
      title: 'בוחרים "Share" (שיתוף)',
      body: 'בתפריט שנפתח, השורה עם הריבוע והחץ למעלה.',
      scene: 'safari26-share',
      point: null,
      caption: 'בוחרים Share',
    },
    ...IOS26_BOTTOM.slice(1),
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
