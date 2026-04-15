-- Add scheduling pattern fields to brackets table
-- This allows brackets to use the same day-of-week scheduling logic as regular season games

ALTER TABLE brackets
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS days_of_week INTEGER[];

COMMENT ON COLUMN brackets.start_date IS 'First date for playoff games';
COMMENT ON COLUMN brackets.days_of_week IS 'Days of week for scheduling (0=Sunday, 6=Saturday)';
