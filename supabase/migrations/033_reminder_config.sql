-- Configurable workout-reminder schedule (admin-editable via Settings). Stored as
-- JSON in app_settings so times/days/enabled can change without a redeploy.
-- Defaults: team days = Tue(2) & Fri(5); "day before at 08:00" reminder to all;
-- "evening before at 18:00" reminder to RSVP non-responders. Israel local time.
INSERT INTO app_settings (key, value) VALUES (
  'reminder_config',
  '{"teamDays":[2,5],"dayBefore":{"enabled":true,"hour":8},"eveningBefore":{"enabled":true,"hour":18}}'
) ON CONFLICT (key) DO NOTHING;
