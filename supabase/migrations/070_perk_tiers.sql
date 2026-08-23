-- Tiered perk visibility: some sponsor deals have a richer offer for "core
-- runners" (רצי גרעין — an existing athletes.role value, see settings' Role
-- Manager) on top of the base offer every member gets. 'all' keeps existing
-- rows visible to everyone, unchanged.
ALTER TABLE club_perks ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'all'
  CHECK (tier IN ('all', 'core_runner'));

-- Remove the placeholder rows now that real sponsor deals exist.
DELETE FROM club_perks WHERE sponsor_name IN ('Example Sports Co. (placeholder)', 'Example Cafe (placeholder)');

-- Real partnership deals — "מדרגות אירוע פתיחת שנה 3" deck. Each sponsor with
-- a distinct core-runner upgrade gets two rows (base 'all' + richer
-- 'core_runner'); Alpha Sport's lactate testing has no tier split in the
-- source deck, so it's a single 'all' row. No discount_code/redeem_url are
-- given here — none were provided in the source material (these are
-- in-person/club-mediated redemptions, not self-serve promo codes).
INSERT INTO club_perks (sponsor_name, title_he, title_en, description_he, description_en, tier, sort_order) VALUES
  ('HOKA', '35% הנחה על נעלי ריצה', '35% Off Running Shoes',
   '35% הנחה קבועה בחנויות הוקה לכל חברי המדרגות, ו-25% הנחה באתר WESHOES.',
   '35% fixed discount in HOKA stores for all Madregot members, plus 25% off on the WESHOES website.',
   'all', 0),
  ('HOKA', 'מלאי נעליים לרצי הגרעין', 'Shoe Allocation for Core Runners',
   'הקצאה שנתית לרצי הגרעין: 3 זוגות נעלי תחרות, 6 זוגות נעלי אימונים, 2 זוגות נעלי התאוששות.',
   'Annual allocation for core runners: 3 pairs of racing shoes, 6 pairs of training shoes, 2 pairs of recovery shoes.',
   'core_runner', 1),

  ('SAYSKY', '20% הנחה על ביגוד ריצה', '20% Off Running Apparel',
   '20% הנחה קבועה באתר SAYSKY לכל חברי המדרגות.',
   '20% fixed discount on the SAYSKY website for all Madregot members.',
   'all', 2),
  ('SAYSKY', 'חבילת ביגוד לרצי הגרעין', 'Apparel Kit for Core Runners',
   '6 סטים (חולצה + מכנסיים + גרביים) לרצי הגרעין, ובנוסף 40% הנחה בהזמנה חודשית.',
   '6 kits (shirt + shorts + socks) for core runners, plus 40% off on monthly orders.',
   'core_runner', 3),

  ('PhysyoutLV', '20% הנחה על פיזיותרפיה', '20% Off Physiotherapy',
   '20% הנחה ברשת הפיזיותרפיה PhysyoutLV (4 סניפים באזור תל אביב) לכל חברי המדרגות.',
   '20% discount at PhysyoutLV physiotherapy clinics (4 branches in the Tel Aviv area) for all Madregot members.',
   'all', 4),
  ('PhysyoutLV', 'טיפול חודשי חינם לרצי הגרעין', 'Free Monthly Treatment for Core Runners',
   'טיפול פיזיותרפי חודשי אחד ללא עלות לרצי הגרעין.',
   'One free monthly physiotherapy treatment for core runners.',
   'core_runner', 5),

  ('Podium', '10% הנחה על תזונת ספורט', '10% Off Sports Nutrition',
   '10% הנחה במוצרי GU, PowerBar, SaltStick ו-Beet It בחנות פודיום, לכל חברי המדרגות.',
   '10% discount on GU, PowerBar, SaltStick and Beet It products at Podium, for all Madregot members.',
   'all', 6),
  ('Podium', 'קרדיט חודשי לרצי הגרעין', 'Monthly Credit for Core Runners',
   'קרדיט חודשי בסך 200 ש"ח למוצרי תזונת ספורט (GU, PowerBar, SaltStick).',
   'A monthly ₪200 credit toward sports-nutrition products (GU, PowerBar, SaltStick).',
   'core_runner', 7),

  ('LIFT', '15% הנחה במנוי ל-LIFT', '15% Off a LIFT Membership',
   '15% הנחה במנוי חד"כ ברשת חדרי הכושר LIFT, לכל חברי המדרגות.',
   '15% discount on a LIFT gym membership for all Madregot members.',
   'all', 8),
  ('LIFT', 'מנוי שנתי חינם לרצי הגרעין', 'Free Annual LIFT Membership for Core Runners',
   'מנוי שנתי חינם ברשת LIFT לרצי הגרעין.',
   'A free annual LIFT membership for core runners.',
   'core_runner', 9),

  ('וולנס', '15% הנחה במתחמי התאוששות', '15% Off Recovery Centers',
   '15% הנחה על כניסה למתחמי ההתאוששות של וולנס, לכל חברי המדרגות.',
   '15% discount on entry to Wellness recovery centers, for all Madregot members.',
   'all', 10),
  ('וולנס', 'כניסה שבועית חינם לרצי הגרעין', 'Free Weekly Entry for Core Runners',
   'כניסה שבועית חינם למתחמי וולנס לרצי הגרעין.',
   'Free weekly entry to Wellness recovery centers for core runners.',
   'core_runner', 11),

  ('CHAMELO', '25% הנחה על משקפי שמש', '25% Off Sunglasses',
   '25% הנחה לרכישת משקפי שמש CHAMELO, לכל חברי המדרגות.',
   '25% discount on CHAMELO sunglasses, for all Madregot members.',
   'all', 12),
  ('CHAMELO', 'זוג משקפי שמש חינם לרצי הגרעין', 'Free Sunglasses for Core Runners',
   'זוג משקפי שמש CHAMELO חינם לרצי הגרעין.',
   'A free pair of CHAMELO sunglasses for core runners.',
   'core_runner', 13),

  ('Alpha Sport', 'בדיקת לקטט מקצועית', 'Professional Lactate Testing',
   'בדיקת לקטט רבעונית בוולודרום, מבוצעת ע"י מעבדת הספורט של בי"ח אסף הרופא — כולל ניתוח מדעי של המדדים והכוונת קצבי מטרה לאימונים ותחרויות.',
   'A quarterly lactate test at the velodrome, run by Assaf Harofeh Hospital''s sports lab — including scientific analysis of the metrics and target pace guidance for training and races.',
   'all', 14)
ON CONFLICT DO NOTHING;
