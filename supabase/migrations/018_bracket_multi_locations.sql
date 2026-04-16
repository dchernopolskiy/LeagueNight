-- Allow playoff brackets to store multiple default locations for game generation.
-- Keep default_location_id for backward compatibility and mirror the first selected
-- location into that legacy field.

ALTER TABLE brackets
  ADD COLUMN IF NOT EXISTS default_location_ids UUID[];

COMMENT ON COLUMN brackets.default_location_ids IS
  'Selected locations for playoff scheduling; first item mirrors default_location_id for compatibility';
