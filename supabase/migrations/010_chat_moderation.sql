CREATE TABLE IF NOT EXISTS message_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reporter_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate', 'other')),
  details text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed', 'actioned')),
  reviewed_by uuid REFERENCES profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, reporter_profile_id)
);
