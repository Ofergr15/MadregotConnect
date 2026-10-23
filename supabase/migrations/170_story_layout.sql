-- The weekly story's layout, edited on the story itself by the admin: hidden slides,
-- hidden parts of a slide, the default workout (quality | long) and the background.
-- Shape: lib/week-story/layout.ts (StoryLayout). NULL = everything shown, quality, blue.
ALTER TABLE story_feature_settings ADD COLUMN IF NOT EXISTS layout JSONB;
