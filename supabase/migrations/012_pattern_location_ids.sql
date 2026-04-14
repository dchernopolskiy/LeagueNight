-- Add location_ids array to game_day_patterns for multi-location support.
alter table game_day_patterns
  add column if not exists location_ids uuid[] default '{}';

-- Back-fill existing rows that already have a location_id
update game_day_patterns
  set location_ids = array[location_id]
  where location_id is not null and (location_ids is null or location_ids = '{}');

-- Add end_time to cap game scheduling (no games start after this time)
alter table game_day_patterns
  add column if not exists end_time time;

-- Add loser_to for double elimination bracket advancement
alter table bracket_slots
  add column if not exists loser_to text;
