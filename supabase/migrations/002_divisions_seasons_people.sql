-- Divisions within a league (e.g. A, B, B+)
create table divisions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  name text not null,
  level int not null default 0, -- 0 = top, 1 = second, etc. used for promotion/relegation
  color text,
  created_at timestamptz default now()
);

create index idx_divisions_league on divisions(league_id);

-- Add division to teams
alter table teams add column division_id uuid references divisions(id) on delete set null;

-- Add season dates to leagues
alter table leagues add column season_start date;
alter table leagues add column season_end date;

-- Global people registry (cross-league identity)
create table people (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  phone text,
  full_name text not null,
  profile_id uuid references profiles(id), -- linked if they have an account
  created_at timestamptz default now()
);

create index idx_people_email on people(email);

-- Link players to people
alter table players add column person_id uuid references people(id) on delete set null;

-- Add sub availability preferences
alter table players add column sub_availability jsonb default '{}';
-- e.g. { "days": [1, 4], "notes": "Available Mondays and Thursdays" }

-- Playoff brackets
create table brackets (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  division_id uuid references divisions(id) on delete cascade,
  name text not null default 'Playoffs',
  format text not null default 'single_elimination'
    check (format in ('single_elimination', 'double_elimination')),
  num_teams int not null default 4,
  seed_by text not null default 'record'
    check (seed_by in ('record', 'points')),
  created_at timestamptz default now()
);

create table bracket_slots (
  id uuid primary key default gen_random_uuid(),
  bracket_id uuid not null references brackets(id) on delete cascade,
  round int not null,         -- 1 = first round, 2 = semis, etc.
  position int not null,      -- slot position within round
  team_id uuid references teams(id),
  seed int,
  game_id uuid references games(id), -- linked game for this matchup
  winner_to uuid references bracket_slots(id), -- which slot the winner goes to
  created_at timestamptz default now()
);

create index idx_bracket_slots_bracket on bracket_slots(bracket_id);

-- Chat channels (replaces flat messages approach)
alter table messages add column channel_type text default 'league'
  check (channel_type in ('league', 'team', 'organizer'));
