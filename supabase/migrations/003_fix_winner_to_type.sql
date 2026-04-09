-- Drop the foreign key constraint on winner_to (was referencing bracket_slots.id as uuid)
-- and change it to text so we can store descriptive references like "W-2-0"
ALTER TABLE bracket_slots DROP CONSTRAINT IF EXISTS bracket_slots_winner_to_fkey;
ALTER TABLE bracket_slots ALTER COLUMN winner_to TYPE text;
