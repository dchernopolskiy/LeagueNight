-- 009: Chat read tracking + Co-organizer roles

-- 1. Track last-read timestamp per profile per league (for unread badges)
CREATE TABLE IF NOT EXISTS chat_read_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  channel_key text NOT NULL,  -- e.g. "league", "team-<uuid>", "division-<uuid>"
  last_read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(profile_id, league_id, channel_key)
);

CREATE INDEX IF NOT EXISTS idx_chat_read_cursors_profile ON chat_read_cursors(profile_id);
CREATE INDEX IF NOT EXISTS idx_chat_read_cursors_league ON chat_read_cursors(league_id);

-- 2. Co-organizer / league membership table
CREATE TABLE IF NOT EXISTS league_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'manager')),
  invited_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(league_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_league_staff_league ON league_staff(league_id);
CREATE INDEX IF NOT EXISTS idx_league_staff_profile ON league_staff(profile_id);
