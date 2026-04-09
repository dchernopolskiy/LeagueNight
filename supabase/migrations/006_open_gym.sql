-- Open gym / court rental sessions
create table open_gym_sessions (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references profiles(id),
  location_id uuid references locations(id) on delete set null,
  title text not null,
  sport text,
  description text,
  day_of_week int,                  -- 0-6 for recurring, null for one-off
  start_time time not null,
  end_time time not null,
  specific_date date,               -- for one-off sessions
  recurring_start date,             -- when recurrence begins
  recurring_end date,               -- when it ends
  capacity int,                     -- max participants, null = unlimited
  fee_amount_cents int default 0,
  fee_description text,
  court_numbers text[] default '{}',
  notes text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create index idx_open_gym_organizer on open_gym_sessions(organizer_id);
create index idx_open_gym_location on open_gym_sessions(location_id);

-- RSVP tracking
create table open_gym_rsvps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references open_gym_sessions(id) on delete cascade,
  player_name text not null,
  player_email text,
  player_phone text,
  session_date date not null,
  status text default 'confirmed' check (status in ('confirmed', 'waitlist', 'cancelled')),
  created_at timestamptz default now(),
  unique(session_id, player_name, session_date)
);

create index idx_open_gym_rsvps_session on open_gym_rsvps(session_id);
