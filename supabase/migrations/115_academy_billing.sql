-- ════════════════════════════════════════════════════════════════════════════════════════
-- 115 — PAYMENT STATUS: who is being coached for free
-- ════════════════════════════════════════════════════════════════════════════════════════
--
-- Flow-map row 12, "קישור תשלום → הוראת קבע; מייל על תשלום → סימון בקובץ", owner Ofer, tools
-- GO + Excel — and the mockup's own sentence about why this screen exists at all: "'מי לא שילם'
-- חייב לשבת ליד 'מי מקבל ליווי' — אחרת אתה מגלה את זה רק בסוף החודש."
--
-- That is the entire brief, and it is deliberately narrow.
--
-- ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────
--
-- Not billing. The money stays in GO: GO issues the payment link, GO holds the standing order,
-- GO sends the receipt, and GO is the system of record for every shekel. Nothing here charges
-- anybody, and nothing here should ever be reconciled against as if it were an accounting
-- ledger. What lives here is STATUS — link sent / standing order active / paid this month —
-- because status is the part Ofer currently keeps in a spreadsheet and therefore the part that
-- goes stale beside a roster that does not.
--
-- The screen's grey box says this out loud on purpose, so that nobody later mistakes a marked
-- month for a receipt.
--
-- ── WHY TWO TABLES ──────────────────────────────────────────────────────────────────────
--
-- `academy_billing` is one row per trainee and holds a CURRENT fact: is there a live standing
-- order behind this person's coaching. It is overwritten as reality changes.
--
-- `academy_payments` is one row per trainee per month and holds a HISTORICAL fact: this month
-- was paid. It is never overwritten, because "did September get paid" must stay answerable in
-- December, and because a standing order that fails in November says nothing about October.
--
-- Collapsing them into a `last_paid_month` column on the billing row would answer "is he paid
-- up" and lose "which months were". The mockup's two lists — לא שולם and שולם החודש — are
-- exactly one query against each table.
--
-- ── THE ONE RULE WORTH A DATABASE ───────────────────────────────────────────────────────
--
-- The red box: "יעל פרץ — הקישור נשלח לפני 5 ימים ולא הוקמה הוראת קבע. מתאמנת פעילה שמקבלת
-- ליווי בחינם." That state — active in the academy, receiving a written plan and weekly
-- feedback, with no standing order behind it — is invisible today until the end of the month,
-- and it is the only thing on this screen that costs real money while nobody is looking. It is
-- derived rather than stored (lib/academy/payments.ts), because it is a fact about the gap
-- between two tables and a stored copy of it would be wrong the moment either side changed.
--
-- ── WHY MARKING IS A TAP ────────────────────────────────────────────────────────────────
--
-- The mockup's build-order note: "תלוי בהחלטה אחת — האם מייל מ-GO נקרא אוטומטית או שאתה מסמן
-- בלחיצה. עד שיוחלט, הסימון הידני מספיק." So `source` exists from day one with two values, and
-- the manual tap is the only one the app writes today. When a GO mailbox is read automatically,
-- the rows it creates are distinguishable from the rows a human vouched for — which matters the
-- first time the parser gets a month wrong.

-- ── One row per trainee: the standing order behind their coaching ────────────────────────
CREATE TABLE IF NOT EXISTS academy_billing (
  -- The athlete IS the key. A trainee has one coaching arrangement at a time; a second row
  -- would be a second answer to "is this person paying".
  athlete_id UUID PRIMARY KEY REFERENCES athletes(id) ON DELETE CASCADE,

  -- 'none'      — nothing has been sent. The normal state of somebody who just joined.
  -- 'link_sent' — GO's payment link went out. This is the state the red box watches: it is
  --               supposed to be brief, and the whole problem is that it silently is not.
  -- 'active'    — a standing order exists. The trainee is paying.
  -- 'failed'    — it existed and stopped (card expired, bank refused). Distinct from 'none'
  --               because it needs a phone call, not a link; the mockup's amber לבדוק pill.
  -- 'cancelled' — deliberately ended. Distinct from 'failed' because nothing is wrong.
  status TEXT NOT NULL DEFAULT 'none'
    CHECK (status IN ('none', 'link_sent', 'active', 'failed', 'cancelled')),

  -- What they pay per month, which is the input to every number on the profitability screen.
  -- Nullable: the status is knowable before the price is agreed, and a guessed amount would
  -- quietly become a revenue figure.
  monthly_amount_ils NUMERIC(10, 2),

  -- Each transition keeps its own timestamp rather than one `status_changed_at`, because the
  -- question is never "when did this last change" — it is "how long has the link been out
  -- there unanswered", and that answer must survive a later failure and recovery.
  link_sent_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,

  -- "מדבר עם אשתו", "מתחיל ב-1.11". The reason a row is in an odd state is the thing Ofer
  -- currently remembers, and forgetting it is what turns a follow-up into a second follow-up.
  note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES athletes(id) ON DELETE SET NULL,

  -- A claim with no date behind it cannot be aged, and every one of these states is judged by
  -- how long it has been true. 'link_sent' with no `link_sent_at` would make the red box
  -- unreachable — the one alert on this screen that costs money.
  CONSTRAINT academy_billing_link_sent_has_time
    CHECK (status <> 'link_sent' OR link_sent_at IS NOT NULL),
  CONSTRAINT academy_billing_active_has_time
    CHECK (status <> 'active' OR activated_at IS NOT NULL),
  CONSTRAINT academy_billing_failed_has_time
    CHECK (status <> 'failed' OR failed_at IS NOT NULL),

  -- A negative or absurd monthly fee is a typo, and this number multiplies into the mentor
  -- payout table. 6000 is far above anything the club charges and far below a slipped decimal.
  CONSTRAINT academy_billing_amount_plausible
    CHECK (monthly_amount_ils IS NULL OR (monthly_amount_ils > 0 AND monthly_amount_ils <= 6000))
);

-- The screen's three KPIs and both of its lists are "every academy trainee, by billing state".
CREATE INDEX IF NOT EXISTS idx_academy_billing_status
  ON academy_billing (status);

-- The red box: links that went out and were never answered, oldest first. Partial, because this
-- is supposed to be a short list and the whole point is noticing when it is not.
CREATE INDEX IF NOT EXISTS idx_academy_billing_link_pending
  ON academy_billing (link_sent_at)
  WHERE status = 'link_sent';

-- ── One row per paid month: what was actually collected ─────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,

  -- The month, normalised to its first day. A DATE rather than a text 'YYYY-MM' so that "the
  -- last six months" is a range scan and not string arithmetic, and pinned to the first of the
  -- month by a CHECK so two rows can never disagree about which month they mean.
  period DATE NOT NULL,

  -- Copied from the billing row at marking time rather than joined. The fee changes; what was
  -- paid in September must keep saying what was paid in September.
  amount_ils NUMERIC(10, 2),

  -- 'manual'   — Ofer read the GO mail and tapped. The only value the app writes today.
  -- 'go_email' — reserved for the undecided automation. Kept distinguishable so that the first
  --              month a parser gets wrong is separable from the months a human vouched for.
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'go_email')),

  marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  marked_by UUID REFERENCES athletes(id) ON DELETE SET NULL,
  note TEXT,

  -- One payment per trainee per month. A double tap must be idempotent, not a second month's
  -- revenue: the totals on the profitability screen are a SUM over this table.
  CONSTRAINT academy_payments_one_per_month UNIQUE (athlete_id, period),

  CONSTRAINT academy_payments_period_is_month_start
    CHECK (period = date_trunc('month', period)::date),

  CONSTRAINT academy_payments_amount_plausible
    CHECK (amount_ils IS NULL OR (amount_ils > 0 AND amount_ils <= 6000))
);

-- "September" — the month view, and the SUM behind the revenue KPI.
CREATE INDEX IF NOT EXISTS idx_academy_payments_period
  ON academy_payments (period DESC);

-- "this trainee's payment history" — the per-trainee lens of the same screen.
CREATE INDEX IF NOT EXISTS idx_academy_payments_athlete
  ON academy_payments (athlete_id, period DESC);

-- ── What a mentor costs ─────────────────────────────────────────────────────────────────
--
-- The manager phone's whole argument: "השורה שמזיזה את זה היא עלות המלווה למתאמן — ולכן זמן
-- הפידבק הוא מדד כלכלי, לא רק נוחות", and the simulation beside it — a mentor handling ten
-- trainees instead of six takes the remainder per trainee from ₪226 to ₪314.
--
-- Both columns are nullable on purpose, and that is not indecision: whether a mentor is paid
-- per trainee or a flat monthly fee is genuinely unsettled, and the two are not exclusive (a
-- retainer plus a per-head amount is a normal arrangement). The payout is flat + per_trainee ×
-- headcount, so either column alone, or both, describes a real deal. What is NOT allowed is
-- neither — a mentor row that cannot produce a number would make the payout table silently
-- short.
CREATE TABLE IF NOT EXISTS academy_coach_pay (
  coach_id UUID PRIMARY KEY REFERENCES athletes(id) ON DELETE CASCADE,
  per_trainee_ils NUMERIC(10, 2),
  monthly_flat_ils NUMERIC(10, 2),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES athletes(id) ON DELETE SET NULL,

  CONSTRAINT academy_coach_pay_has_an_amount
    CHECK (per_trainee_ils IS NOT NULL OR monthly_flat_ils IS NOT NULL),
  CONSTRAINT academy_coach_pay_amounts_plausible
    CHECK ((per_trainee_ils IS NULL OR (per_trainee_ils >= 0 AND per_trainee_ils <= 6000))
       AND (monthly_flat_ils IS NULL OR (monthly_flat_ils >= 0 AND monthly_flat_ils <= 40000)))
);

-- Service-role only, like every academy table. No policies on purpose: without a policy anon
-- and authenticated read zero rows, and the anon key ships inside the browser bundle. It
-- matters more here than elsewhere — these three tables are the only place in the app where one
-- athlete could read what another pays, and what a mentor earns.
ALTER TABLE academy_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_coach_pay ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE academy_billing IS
  'Payment STATUS beside coaching status — not billing. The money stays in GO; this row says '
  'whether a standing order exists behind a trainee who is receiving plans and feedback.';
COMMENT ON TABLE academy_payments IS
  'One row per trainee per paid month, never overwritten. A standing order failing in November '
  'says nothing about October, and "did September get paid" must stay answerable in December.';
COMMENT ON COLUMN academy_payments.source IS
  'manual = a human read the GO mail and vouched for it. go_email = the undecided automation. '
  'Kept apart so the first month a parser gets wrong is separable from the rest.';
COMMENT ON TABLE academy_coach_pay IS
  'What a mentor costs: a flat monthly fee, a per-trainee amount, or both. Feeds the payout '
  'table and the per-trainee remainder, which is how "does another mentor pay for itself" is '
  'answered.';

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY. Expect 0 rows in all three, rowsecurity = true and 0 policies on each,
-- 4 indexes (excluding the primary keys), and 10 CHECK constraints.
-- ───────────────────────────────────────────────────────────────────────────
