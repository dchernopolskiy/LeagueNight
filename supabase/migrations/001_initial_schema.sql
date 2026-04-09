-- LeagueNight initial schema

-- Profiles: authenticated users (organizers, captains who opt in)
create table profiles (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique not null,
  email text not null,
  full_name text not null,
  phone text,
  avatar_url text,
  created_at timestamptz default now()
);

-- Leagues: top-level organizational unit
create table leagues (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references profiles(id),
  name text not null,
  slug text unique not null,
  sport text,
  description text,
  season_name text,
  timezone text not null default 'America/New_York',
  is_public boolean default true,
  settings jsonb default '{}',
  created_at timestamptz default now(),
  archived_at timestamptz
);

-- Teams within a league
create table teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  name text not null,
  color text,
  captain_player_id uuid, -- FK added after players table
  created_at timestamptz default now()
);

-- Players: frictionless entity with magic-link token
create table players (
  id uuid primary key default gen_random_uuid(),
  token uuid unique not null default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  profile_id uuid references profiles(id),
  name text not null,
  email text,
  phone text,
  is_sub boolean default false,
  notification_pref text default 'email',
  created_at timestamptz default now(),
  unique(league_id, email)
);

-- Back-reference: team captain
alter table teams
  add constraint fk_captain
  foreign key (captain_player_id) references players(id) on delete set null;

-- Recurring game day patterns
create table game_day_patterns (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  venue text,
  court_count int default 1,
  duration_minutes int default 60,
  starts_on date not null,
  ends_on date
);

-- Individual scheduled games
create table games (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  home_team_id uuid not null references teams(id),
  away_team_id uuid not null references teams(id),
  scheduled_at timestamptz not null,
  venue text,
  court text,
  status text default 'scheduled' check (status in ('scheduled', 'cancelled', 'completed', 'rescheduled')),
  cancel_reason text,
  home_score int,
  away_score int,
  is_playoff boolean default false,
  week_number int,
  created_at timestamptz default now()
);

-- RSVP / availability responses
create table rsvps (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  response text not null check (response in ('yes', 'no', 'maybe')),
  responded_at timestamptz default now(),
  unique(game_id, player_id)
);

-- Sub requests
create table sub_requests (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  team_id uuid not null references teams(id),
  requested_by uuid not null references players(id),
  claimed_by uuid references players(id),
  status text default 'open' check (status in ('open', 'claimed', 'cancelled')),
  notes text,
  created_at timestamptz default now(),
  claimed_at timestamptz
);

-- Availability checks (scheduled pings)
create table availability_checks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  game_id uuid not null references games(id) on delete cascade,
  send_at timestamptz not null,
  reminder_at timestamptz,
  sent boolean default false,
  reminder_sent boolean default false
);

-- League fees
create table league_fees (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  amount_cents int not null,
  currency text default 'usd',
  per text default 'player' check (per in ('player', 'team')),
  description text,
  due_date date
);

-- Payments
create table payments (
  id uuid primary key default gen_random_uuid(),
  league_fee_id uuid not null references league_fees(id),
  player_id uuid not null references players(id),
  amount_cents int not null,
  status text default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  paid_at timestamptz,
  created_at timestamptz default now(),
  unique(league_fee_id, player_id)
);

-- Chat messages
create table messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  team_id uuid references teams(id),
  player_id uuid not null references players(id),
  body text not null,
  is_announcement boolean default false,
  created_at timestamptz default now()
);

-- Denormalized standings (recalculated on score entry)
create table standings (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  team_id uuid not null references teams(id),
  wins int default 0,
  losses int default 0,
  ties int default 0,
  points_for int default 0,
  points_against int default 0,
  h2h_record jsonb default '{}',
  rank int,
  updated_at timestamptz default now(),
  unique(league_id, team_id)
);

-- Notification log
create table notifications (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  type text not null,
  channel text not null,
  payload jsonb,
  sent_at timestamptz default now(),
  delivered boolean,
  external_id text
);

-- Indexes for common queries
create index idx_players_token on players(token);
create index idx_players_league on players(league_id);
create index idx_players_team on players(team_id);
create index idx_games_league on games(league_id);
create index idx_games_scheduled on games(scheduled_at);
create index idx_rsvps_game on rsvps(game_id);
create index idx_messages_league on messages(league_id);
create index idx_messages_team on messages(team_id);
create index idx_leagues_slug on leagues(slug);
create index idx_standings_league on standings(league_id);

-- Function to recalculate standings for a league
create or replace function recalculate_standings(p_league_id uuid)
returns void as $$
begin
  -- Upsert standings from completed games
  insert into standings (league_id, team_id, wins, losses, ties, points_for, points_against)
  select
    p_league_id,
    t.id,
    coalesce(sum(case
      when (g.home_team_id = t.id and g.home_score > g.away_score) or
           (g.away_team_id = t.id and g.away_score > g.home_score) then 1 else 0 end), 0),
    coalesce(sum(case
      when (g.home_team_id = t.id and g.home_score < g.away_score) or
           (g.away_team_id = t.id and g.away_score < g.home_score) then 1 else 0 end), 0),
    coalesce(sum(case
      when g.home_score = g.away_score and g.status = 'completed' then 1 else 0 end), 0),
    coalesce(sum(case
      when g.home_team_id = t.id then coalesce(g.home_score, 0)
      else coalesce(g.away_score, 0) end), 0),
    coalesce(sum(case
      when g.home_team_id = t.id then coalesce(g.away_score, 0)
      else coalesce(g.home_score, 0) end), 0)
  from teams t
  left join games g on (g.home_team_id = t.id or g.away_team_id = t.id) and g.status = 'completed'
  where t.league_id = p_league_id
  group by t.id
  on conflict (league_id, team_id)
  do update set
    wins = excluded.wins,
    losses = excluded.losses,
    ties = excluded.ties,
    points_for = excluded.points_for,
    points_against = excluded.points_against,
    updated_at = now();

  -- Update ranks by wins desc, point differential desc
  with ranked as (
    select id, row_number() over (
      order by wins desc, (points_for - points_against) desc
    ) as new_rank
    from standings
    where league_id = p_league_id
  )
  update standings s set rank = r.new_rank
  from ranked r where s.id = r.id;
end;
$$ language plpgsql;
