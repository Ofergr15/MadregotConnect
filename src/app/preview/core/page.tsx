'use client';

import { notFound } from 'next/navigation';
import CorePage from '@/app/(app)/dashboard/core/page';

// "הגרעין שלי" on a stubbed answer (screenshots). Development only.

const DATA = {"preview": false, "name": "Ofer Grosfeld", "clubCount": 7, "perks": [{"id": "33135111-c67b-49ec-9093-613246db6f9b", "sponsorName": "HOKA", "title": "גיפטקארד נעליים", "description": "הקצאה שנתית לרצי הגרעין: 3 זוגות נעלי תחרות, 6 זוגות נעלי אימונים, 2 זוגות נעלי התאוששות.", "imageUrl": "https://njzldypndkicpsmdtyll.supabase.co/storage/v1/object/public/perk-images/hoka-04eb2cec-c7f0-4b6a-919a-64009b7c2c47.png", "discountCode": null, "redeemUrl": null, "status": "הגיפטקארדים סופקו השבוע", "tone": "now", "where": "מימוש בחנויות HOKA: מנדרין והדרך", "locations": [{"name": "HOKA מנדרין", "query": "HOKA מנדרין"}, {"name": "HOKA הדרך", "query": "HOKA הדרך"}], "whatsapp": null, "website": null, "highlights": [{"n": "3", "label": "זוגות תחרות"}, {"n": "6", "label": "זוגות אימון"}, {"n": "2", "label": "התאוששות"}], "how": ["מגיעים לאחת החנויות עם הגיפטקארד", "בוחרים נעליים מהמכסה של השנה", "כל אחד מחליט איך לחלק"]}, {"id": "248f28fa-5a0b-46e9-a918-efddc62d1d3d", "sponsorName": "SAYSKY", "title": "חבילת ביגוד לרצי הגרעין", "description": "6 סטים (חולצה + מכנסיים + גרביים) לרצי הגרעין, ובנוסף 40% הנחה בהזמנה חודשית.", "imageUrl": "https://njzldypndkicpsmdtyll.supabase.co/storage/v1/object/public/perk-images/saysky-b1ca7af7-a99c-4903-9e1e-7e772663f680.png", "discountCode": null, "redeemUrl": null, "status": "דרופ בקרוב", "tone": "soon", "where": null, "locations": [], "whatsapp": null, "website": null, "highlights": [], "how": []}, {"id": "68facae4-e76a-411b-9dcf-58dc388d6af0", "sponsorName": "PhysyoutLV", "title": "טיפול חודשי חינם לרצי הגרעין", "description": "טיפול פיזיותרפי חודשי אחד ללא עלות לרצי הגרעין.", "imageUrl": "https://njzldypndkicpsmdtyll.supabase.co/storage/v1/object/public/perk-images/physyoutlv-c378f3ea-4223-41cd-9545-fe496d6c426d.jpg", "discountCode": null, "redeemUrl": null, "status": "טיפול אחד בחודש", "tone": "now", "where": "הסניף ברחוב המקצוע 5", "locations": [{"name": "PhysyoutLV · המקצוע 5", "query": "רחוב המקצוע 5"}], "whatsapp": "972549478223", "website": null, "highlights": [], "how": ["שולחים הודעה בוואטסאפ לסניף", "אומרים שאתם מהגרעין של מדרגות"]}, {"id": "9ad13b8e-efb2-43ba-a05d-44505e054069", "sponsorName": "Podium", "title": "₪600 לרבעון בתזונת ספורט", "description": "₪200 לחודש, בהזמנה מרוכזת אחת לרבעון — GU, PowerBar, SaltStick.", "imageUrl": "https://njzldypndkicpsmdtyll.supabase.co/storage/v1/object/public/perk-images/podium-f7d65ea0-8a34-4114-bdae-5ccce8e847b9.jpg", "discountCode": null, "redeemUrl": null, "status": "ההזמנה יוצאת בתחילת נובמבר", "tone": "soon", "where": null, "locations": [], "whatsapp": null, "website": null, "highlights": [{"n": "₪200", "label": "לחודש"}, {"n": "₪600", "label": "בהזמנה לרבעון"}], "how": []}, {"id": "f6777058-d9a5-4b5b-9d8f-01d5586e44b5", "sponsorName": "LIFT", "title": "מנוי שנתי חינם לרצי הגרעין", "description": "מנוי שנתי חינם ברשת LIFT לרצי הגרעין.", "imageUrl": "https://njzldypndkicpsmdtyll.supabase.co/storage/v1/object/public/perk-images/lift-25bc1530-47ab-4248-b6c1-22bdf59f2784.jpg", "discountCode": null, "redeemUrl": null, "status": "מנוי שנתי", "tone": "now", "where": null, "locations": [], "whatsapp": null, "website": null, "highlights": [], "how": []}, {"id": "31bcb0bf-218e-4323-85e6-79f7cb9367f9", "sponsorName": "וולנס", "title": "כניסה שבועית חינם לרצי הגרעין", "description": "כניסה שבועית חינם למתחמי וולנס לרצי הגרעין.", "imageUrl": null, "discountCode": null, "redeemUrl": null, "status": "פרטים בקרוב", "tone": "tbd", "where": null, "locations": [], "whatsapp": null, "website": null, "highlights": [], "how": []}]};

if (typeof window !== 'undefined' && !(window as { __coreStub?: boolean }).__coreStub) {
  (window as { __coreStub?: boolean }).__coreStub = true;
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (url.startsWith('/api/perks/core')) return new Response(JSON.stringify(DATA), { status: 200, headers: { 'content-type': 'application/json' } });
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PreviewCore() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <div className="mx-auto max-w-md bg-page p-4"><CorePage /></div>;
}
