import { IframeFitter } from './IframeFitter';

// Live iPhone-frame showcase for the native-iOS redesign preview branch.
// The embedded iframes point at the Vercel preview deployment, which sits
// behind Vercel's SSO wall — VERCEL_AUTOMATION_BYPASS_SECRET (a Vercel system
// env var, auto-populated once a "Protection Bypass for Automation" secret
// exists for the project) lets these specific iframe requests through
// without touching the project's general deployment-protection settings, so
// it's read server-side here rather than ever hardcoded into committed
// source.
const PREVIEW_BASE = 'https://madregot-connect-git-preview-ios-redesign-st-d1c4461c.vercel.app';

const CSS = `
  :root{
    --indigo:#4338ff;--indigo-l:#818cf8;--s400:#94a3b8;--s500:#64748b;--amber:#f59e0b;
    --ti-1:#5c5c60;--ti-2:#8b8b8f;--ti-3:#3a3a3d;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  .ipv-body{
    background:radial-gradient(120% 60% at 50% 0%,#16213b 0%,#0f172a 45%,#0b1120 100%);
    color:#fff;font-family:"Heebo","Rubik",-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    min-height:100vh;padding:50px 20px 100px;
  }
  .ipv-wrap{max-width:1180px;margin:0 auto}
  .ipv-header{text-align:center;margin-bottom:10px}
  .ipv-kick{color:var(--indigo-l);font-size:13px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}
  .ipv-header h1{font-size:36px;font-weight:900;letter-spacing:-.5px;margin-top:8px}
  .ipv-header p{color:var(--s400);font-size:15px;margin-top:10px;max-width:600px;margin-inline:auto;line-height:1.6}
  .ipv-pill{display:inline-flex;align-items:center;gap:8px;margin-top:18px;background:rgba(245,158,11,.14);border:1px solid rgba(245,158,11,.3);color:var(--amber);font-weight:800;font-size:13px;padding:8px 18px;border-radius:999px}
  .ipv-note{max-width:640px;margin:16px auto 0;background:rgba(67,56,255,.08);border:1px solid rgba(67,56,255,.25);border-radius:14px;padding:12px 16px;color:#c7d2fe;font-size:13px;line-height:1.7;text-align:right}
  .ipv-note b{color:#fff}

  .ipv-phone{
    position:relative;border-radius:64px;
    background:linear-gradient(155deg,var(--ti-2) 0%,var(--ti-1) 45%,var(--ti-3) 100%);
    padding:14px;
    box-shadow:0 40px 90px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.06) inset,0 2px 3px rgba(255,255,255,.18) inset;
  }
  .ipv-phone .ipv-buttons{position:absolute;top:150px;right:-3px;width:3px;height:70px;background:linear-gradient(90deg,var(--ti-3),var(--ti-1));border-radius:0 3px 3px 0}
  .ipv-phone .ipv-buttons.b2{top:230px;height:46px}
  .ipv-phone .ipv-action{position:absolute;top:120px;left:-3px;width:3px;height:34px;background:linear-gradient(270deg,var(--ti-3),var(--ti-1));border-radius:3px 0 0 3px}
  .ipv-screen{position:relative;overflow:hidden;border-radius:52px;background:#000;box-shadow:0 0 0 2px #000}
  .ipv-screen .ipv-scaler{position:absolute;top:0;left:0;transform-origin:top left}
  .ipv-screen iframe{display:block;border:0;background:#0b1120}
  .ipv-island{position:absolute;top:16px;left:50%;transform:translateX(-50%);width:33%;height:30px;background:#000;border-radius:18px;z-index:5;pointer-events:none}
  .ipv-home{position:absolute;bottom:9px;left:50%;transform:translateX(-50%);width:34%;height:5px;background:rgba(255,255,255,.85);border-radius:3px;z-index:5;pointer-events:none}

  .ipv-hero-row{display:flex;justify-content:center;margin-top:34px}
  .ipv-hero{width:min(380px,78vw)}
  .ipv-hero .ipv-screen{aspect-ratio:390/844}
  .ipv-hero-caption{text-align:center;margin-top:22px}
  .ipv-hero-caption b{font-size:17px;font-weight:800;display:block}
  .ipv-hero-caption span{color:var(--s400);font-size:13.5px;margin-top:4px;display:block}

  .ipv-sec{margin:60px 0 6px;display:flex;align-items:center;gap:12px;justify-content:center}
  .ipv-sec h2{font-size:19px;font-weight:900}
  .ipv-sec .ipv-line{width:60px;height:1px;background:linear-gradient(90deg,transparent,rgba(51,65,85,.9),transparent)}

  .ipv-row{display:flex;flex-wrap:wrap;justify-content:center;gap:36px;margin-top:26px}
  .ipv-card{width:250px;text-align:center}
  .ipv-card .ipv-screen{aspect-ratio:390/844;border-radius:36px}
  .ipv-card .ipv-phone{border-radius:44px;padding:10px}
  .ipv-card .ipv-island{width:36%;height:20px;top:11px}
  .ipv-card .ipv-home{width:38%;height:4px;bottom:7px}
  .ipv-card-caption{margin-top:16px}
  .ipv-card-caption b{font-size:14.5px;font-weight:800;display:block}
  .ipv-card-caption span{color:var(--s500);font-size:12px;margin-top:3px;display:block;line-height:1.5}

  .ipv-cta{display:flex;justify-content:center;gap:12px;margin-top:56px;flex-wrap:wrap}
  .ipv-cta a{font-weight:800;font-size:14.5px;padding:13px 24px;border-radius:14px;text-decoration:none;transition:transform .15s}
  .ipv-cta a:active{transform:scale(.97)}
  .ipv-cta a.primary{background:var(--indigo);color:#fff;box-shadow:0 10px 24px rgba(67,56,255,.35)}
  .ipv-cta a.secondary{background:rgba(30,41,59,.7);color:#fff;border:1px solid rgba(51,65,85,.7)}

  .ipv-footer{text-align:center;color:var(--s500);font-size:12px;margin-top:60px;line-height:1.8}
`;

function Phone({
  path,
  title,
  bypassQs,
  size = 'card',
}: {
  path: string;
  title: string;
  bypassQs: string;
  size?: 'hero' | 'card';
}) {
  const src = `${PREVIEW_BASE}${path}${bypassQs ? `?${bypassQs}` : ''}`;
  return (
    <div className="ipv-phone">
      <div className="ipv-screen" data-w="390" data-h="844">
        <div className="ipv-island" />
        <div className="ipv-scaler">
          <iframe src={src} width={390} height={844} loading="lazy" title={title} />
        </div>
        <div className="ipv-home" />
      </div>
      {size === 'hero' && (
        <>
          <div className="ipv-buttons" />
          <div className="ipv-buttons b2" />
          <div className="ipv-action" />
        </>
      )}
    </div>
  );
}

export default function IPhonePreviewPage() {
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
  const bypassQs = bypassSecret
    ? `x-vercel-protection-bypass=${bypassSecret}&x-vercel-set-bypass-cookie=samesitenone`
    : '';

  return (
    <div className="ipv-body" dir="rtl">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ipv-wrap">
        <header className="ipv-header">
          <div className="ipv-kick">Madregot · After 2KM Running Club</div>
          <h1>ככה זה נראה על iPhone 📱</h1>
          <p>זו לא הדמיה — האפליקציה החדשה רצה בתוך המסך למטה, ממש כאן. אפשר ללחוץ, לגלול ולנווט בדיוק כמו באפליקציה האמיתית.</p>
          <div className="ipv-pill">⚠ תצוגה מקדימה — לא בפרודקשן עדיין</div>
          <div className="ipv-note">
            <b>הערה חשובה:</b> בכניסה הראשונה יופיע מסך ההתחברות של האפליקציה (Google). התחברות דרך Google לא עובדת בתוך מסגרת מוטבעת —
            לכן, בפעם הראשונה בלבד, לחצו על &quot;פתח את האפליקציה החיה&quot; למטה, התחברו שם ברגיל, וחזרו לעמוד הזה — המסכים למטה יזהו
            את החיבור וישארו מחוברים.
          </div>
        </header>

        <div className="ipv-hero-row">
          <Phone path="/dashboard" title="לוח הבקרה" bypassQs={bypassQs} size="hero" />
        </div>
        <div className="ipv-hero-caption">
          <b>לוח הבקרה — חי ואינטראקטיבי</b>
          <span>אפשר ללחוץ על התפריט התחתון, לגלול, לפתוח אימונים — זו האפליקציה האמיתית</span>
        </div>

        <div className="ipv-sec">
          <div className="ipv-line" />
          <h2>עוד מסכים חיים לשחק איתם</h2>
          <div className="ipv-line" />
        </div>

        <div className="ipv-row">
          <div className="ipv-card">
            <Phone path="/dashboard/program" title="תוכנית אימונים שבועית" bypassQs={bypassQs} />
            <div className="ipv-card-caption">
              <b>תוכנית שבועית</b>
              <span>כרטיסי יום טבעיים — במקום PDF בתוך iframe</span>
            </div>
          </div>

          <div className="ipv-card">
            <Phone path="/dashboard/profile" title="פרופיל וסטטיסטיקות" bypassQs={bypassQs} />
            <div className="ipv-card-caption">
              <b>פרופיל · סטטיסטיקות</b>
              <span>חדש · בסטייל Strava/Garmin — לחצו על &quot;סטטיסטיקה&quot; בתוך המסך</span>
            </div>
          </div>

          <div className="ipv-card">
            <Phone path="/dashboard/coach-tools" title="כלי מאמן" bypassQs={bypassQs} />
            <div className="ipv-card-caption">
              <b>כלי מאמן</b>
              <span>חדש · כל כלי הניהול שהיו בתפריט גלישה עמוס, במקום אחד</span>
            </div>
          </div>
        </div>

        <div className="ipv-cta">
          <a className="primary" href={`${PREVIEW_BASE}/dashboard`} target="_blank" rel="noopener">
            פתח את האפליקציה החיה (להתחברות) ←
          </a>
          <a className="secondary" href="/app-map.html">
            מפת האפליקציה המלאה
          </a>
        </div>

        <footer className="ipv-footer">
          <p>כל המסכים למעלה הם האפליקציה החיה, לא צילומי מסך.</p>
        </footer>
      </div>
      <IframeFitter />
    </div>
  );
}
