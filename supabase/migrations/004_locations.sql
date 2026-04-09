-- Locations: shared venues across sports and leagues
-- An organizer can manage locations from the dashboard
-- and assign them to game day patterns and individual games.

create table locations (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references profiles(id),
  name text not null,              -- e.g. "Reeves Middle School"
  address text,                    -- full street address
  court_count int default 1,       -- how many courts/fields at this location
  notes text,                      -- parking info, entrance details, etc.
  created_at timestamptz default now()
);

create index idx_locations_organizer on locations(organizer_id);

-- Location unavailability: track dates when a location is not available
-- (holiday closures, maintenance, school events, etc.)
create table location_unavailability (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  unavailable_date date not null,
  reason text,                     -- e.g. "School holiday", "Gym maintenance"
  created_at timestamptz default now(),
  unique(location_id, unavailable_date)
);

create index idx_location_unavail_date on location_unavailability(unavailable_date);
create index idx_location_unavail_location on location_unavailability(location_id);

-- Link game day patterns to locations (instead of free-text venue)
alter table game_day_patterns add column location_id uuid references locations(id) on delete set null;

-- Link individual games to locations
alter table games add column location_id uuid references locations(id) on delete set null;
