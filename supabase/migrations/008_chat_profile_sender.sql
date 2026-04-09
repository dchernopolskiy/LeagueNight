-- Allow organizers (who may not be players) to send messages
-- Use profile_id as the true sender identity

-- Add profile_id column
ALTER TABLE messages ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Make player_id nullable (organizers don't have player records)
ALTER TABLE messages ALTER COLUMN player_id DROP NOT NULL;

-- Backfill profile_id from player records where possible
UPDATE messages m
SET profile_id = p.profile_id
FROM players p
WHERE m.player_id = p.id
  AND p.profile_id IS NOT NULL
  AND m.profile_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_profile ON messages(profile_id);
