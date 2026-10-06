'use client';

// One drawing per step of the install guide (lib/install/steps.ts): a small phone
// showing what the member will actually see, with the control to press ringed in
// orange and a finger on it. The same drawings are the frames of the video.

import type { InstallScene as Scene } from '@/lib/install/steps';
import './install.css';

const ICON = '/images/icon-192.png';

const Share = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
  </svg>
);
const PlusSquare = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
    <rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" />
  </svg>
);
const Dots = ({ vertical = false }: { vertical?: boolean }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    {vertical
      ? (<><circle cx="12" cy="5" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="12" cy="19" r="1.9" /></>)
      : (<><circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" /></>)}
  </svg>
);
const Compass = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" />
  </svg>
);

const Page = () => (
  <div className="ig-page">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={ICON} alt="" />
    <b>מדרגות</b>
  </div>
);

const Finger = ({ style }: { style: React.CSSProperties }) => <span className="ig-finger" style={style} aria-hidden>👆</span>;

export function InstallScene({ scene, browser = 'Safari' }: { scene: Scene; browser?: 'Safari' | 'Chrome' }) {
  switch (scene) {
    case 'safari-share':
      return (
        <div className="ig-phone" dir="ltr">
          <Page />
          <div style={{ padding: '0 8px' }}><div className="ig-url" style={{ textAlign: 'center' }}>madregot.app</div></div>
          <div className="ig-bar">
            <span>‹</span><span>›</span><span className="ig-hot"><Share /></span><span>📖</span><span>⧉</span>
          </div>
          <Finger style={{ left: '50%', bottom: 2, marginLeft: -6 }} />
        </div>
      );
    case 'safari26-menu':
      return (
        <div className="ig-phone" dir="ltr">
          <Page />
          <div className="ig-bar26">
            <span className="ig-round">‹</span>
            <div className="ig-url">madregot.app</div>
            <span className="ig-round ig-hot"><Dots /></span>
          </div>
          <Finger style={{ right: 2, bottom: 0 }} />
        </div>
      );
    case 'safari26-share':
      return (
        <div className="ig-phone" dir="rtl">
          <div className="ig-menu">
            <div className="ig-srow ig-row-hot"><span>שיתוף</span><Share /></div>
            <div className="ig-srow dim">הוספה לסימניות</div>
            <div className="ig-srow dim">כרטיסייה חדשה</div>
            <div className="ig-srow dim">חיפוש בדף</div>
          </div>
          <div className="ig-bar26" dir="ltr"><span className="ig-round">‹</span><div className="ig-url">madregot.app</div><span className="ig-round"><Dots /></span></div>
          <Finger style={{ left: '40%', top: '46%' }} />
        </div>
      );
    case 'share-sheet':
      return (
        <div className="ig-phone" dir="rtl">
          <div className="ig-sheet">
            <div className="ig-sheet-head">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ICON} alt="" /><div><b>מדרגות</b><span>madregot.app</span></div>
            </div>
            <div className="ig-srow dim">העתקה</div>
            <div className="ig-srow dim">הוספה לרשימת הקריאה</div>
            <div className="ig-srow ig-row-hot"><span>הוספה למסך הבית</span><PlusSquare /></div>
            <div className="ig-srow dim">סימון…</div>
          </div>
          <Finger style={{ left: '38%', bottom: '17%' }} />
        </div>
      );
    case 'add-confirm':
      return (
        <div className="ig-phone" dir="rtl">
          <div className="ig-add">
            <div className="ig-add-bar"><span>ביטול</span><b>הוספה למסך הבית</b><span className="ig-btn ig-row-hot">הוספה</span></div>
            <div className="ig-add-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ICON} alt="" /><div><b>מדרגות</b><span>madregot.app</span></div>
            </div>
          </div>
          <Finger style={{ left: 8, top: 18 }} />
        </div>
      );
    case 'home-icon':
      return (
        <div className="ig-phone">
          <div className="ig-home" dir="rtl">
            <i /><i /><i /><i /><i /><i /><i />
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ICON} alt="" /><figcaption>מדרגות</figcaption>
            </figure>
          </div>
          <Finger style={{ left: '12%', top: '22%' }} />
        </div>
      );
    case 'inapp-menu':
      return (
        <div className="ig-phone" dir="rtl">
          <div className="ig-chromebar" dir="ltr">
            <span>✕</span><div className="ig-url">madregot.app</div><span className="ig-hot"><Dots vertical={browser === 'Chrome'} /></span>
          </div>
          <div className="ig-menu top">
            <div className="ig-srow ig-row-hot"><span>פתיחה ב-{browser}</span><Compass /></div>
            <div className="ig-srow dim">העתקת קישור</div>
            <div className="ig-srow dim">שיתוף…</div>
          </div>
          <Page />
          <Finger style={{ left: '40%', top: '20%' }} />
        </div>
      );
    case 'android-dialog':
      return (
        <div className="ig-phone" dir="rtl">
          <div className="ig-adialog">
            <b>להתקין את האפליקציה?</b>
            <div className="r">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ICON} alt="" /><span>מדרגות<br /><small style={{ color: '#888' }}>madregot.app</small></span>
            </div>
            <div className="btns"><span>ביטול</span><em>התקנה</em></div>
          </div>
          <Finger style={{ left: '18%', top: '60%' }} />
        </div>
      );
    case 'android-menu':
      return (
        <div className="ig-phone" dir="rtl">
          <div className="ig-chromebar" dir="ltr"><div className="ig-url">madregot.app</div><span className="ig-hot"><Dots vertical /></span></div>
          <div className="ig-menu top">
            <div className="ig-srow dim">כרטיסייה חדשה</div>
            <div className="ig-srow ig-row-hot"><span>התקנת אפליקציה</span><PlusSquare /></div>
            <div className="ig-srow dim">הגדרות</div>
          </div>
          <Page />
          <Finger style={{ left: '40%', top: '24%' }} />
        </div>
      );
  }
}
