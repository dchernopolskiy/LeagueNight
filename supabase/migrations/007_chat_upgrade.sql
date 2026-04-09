-- Upgrade messages for division channels, direct messages, edit/unsend
ALTER TABLE messages ADD COLUMN IF NOT EXISTS division_id uuid REFERENCES divisions(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Expand channel_type to include division + direct
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_channel_type_check
  CHECK (channel_type IN ('league', 'team', 'organizer', 'division', 'direct'));

-- Direct messages between captain and organizer
-- For direct channels: team_id = captain's team, player_id = sender
-- We track the organizer side via a profile_id column
ALTER TABLE messages ADD COLUMN IF NOT EXISTS recipient_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Notifications preferences per player per channel
CREATE TABLE IF NOT EXISTS chat_mutes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  channel_type text NOT NULL,
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  division_id uuid REFERENCES divisions(id) ON DELETE CASCADE,
  muted_at timestamptz DEFAULT now(),
  UNIQUE(player_id, league_id, channel_type, team_id, division_id)
);

-- Upcoming match notification tracking
CREATE TABLE IF NOT EXISTS match_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  notified_at timestamptz DEFAULT now(),
  type text DEFAULT 'upcoming' CHECK (type IN ('upcoming', 'reminder', 'score')),
  UNIQUE(game_id, player_id, type)
);

CREATE INDEX IF NOT EXISTS idx_messages_division ON messages(division_id);
CREATE INDEX IF NOT EXISTS idx_messages_deleted ON messages(deleted_at);
CREATE INDEX IF NOT EXISTS idx_chat_mutes_player ON chat_mutes(player_id);
