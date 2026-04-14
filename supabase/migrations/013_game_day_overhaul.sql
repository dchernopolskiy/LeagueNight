-- Game day pattern overhaul: multi-day selection, stored scheduling settings,
-- skip dates on pattern, and grouping for patterns created together.

alter table game_day_patterns
  -- Which days of week this pattern covers (for display grouping — one row per day still)
  add column if not exists days_of_week integer[] default null,
  -- Groups patterns created together (e.g. Mon+Wed created at once share a group_id)
  add column if not exists group_id uuid default null,
  -- Scheduling settings stored on pattern so regeneration is self-contained
  add column if not exists games_per_team integer not null default 1,
  add column if not exists games_per_session integer not null default 1,
  add column if not exists matchup_frequency integer not null default 1,
  add column if not exists mix_divisions boolean not null default false,
  add column if not exists skip_dates text[] not null default '{}';

-- Back-fill days_of_week from day_of_week for existing rows
update game_day_patterns
  set days_of_week = array[day_of_week]
  where days_of_week is null;
