-- Add default scheduling fields to brackets so auto-created games
-- can be pre-populated with a location, start time, and duration.

alter table brackets
  add column if not exists default_location_id uuid references locations(id) on delete set null,
  add column if not exists default_start_time text default null,
  add column if not exists default_duration_minutes integer default null;
