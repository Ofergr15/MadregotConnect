-- Height and weight, filled by the member in the app ("הפרטים שלי"), not on the academy form
-- (academy-onboarding/who-fills-what.html, Ofer 2026-10-19: "גובה, משקל — הוא ימלא באפליקציה").
-- Whole centimetres; kilograms to one decimal. The ranges only refuse typos.
-- OPTIONAL until pasted: the profile reads both as unset, and saving them is a no-op (bodySaved: false).
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS height_cm SMALLINT CHECK (height_cm BETWEEN 100 AND 250);
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(5,1) CHECK (weight_kg BETWEEN 25 AND 250);
NOTIFY pgrst, 'reload schema';
