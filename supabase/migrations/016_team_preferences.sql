-- Team Accommodation Requests & Preferences
-- Allows teams to request scheduling preferences like preferred times, bye weeks, etc.

-- Add preferences column to teams table
ALTER TABLE teams
ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}'::jsonb;

-- Create index for querying preferences
CREATE INDEX IF NOT EXISTS idx_teams_preferences ON teams USING gin(preferences);

-- Comment for clarity
COMMENT ON COLUMN teams.preferences IS 'Team scheduling preferences including preferred times, bye weeks, and week-specific requests. Structure: {
  "preferred_time": "early" | "late" | null,
  "preferred_days": ["Monday", "Tuesday", ...],
  "bye_dates": ["2026-03-13", ...],
  "week_preferences": {
    "1": "late",
    "3": "late"
  },
  "notes": "Additional requests or constraints"
}';
