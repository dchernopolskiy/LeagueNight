-- Pending score submissions from players (need staff review)
create table if not exists score_submissions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  league_id uuid not null references leagues(id) on delete cascade,
  submitted_by uuid not null references profiles(id) on delete cascade,
  home_score int not null default 0,
  away_score int not null default 0,
  set_scores jsonb, -- array of {home, away} for sets mode
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_score_submissions_league on score_submissions(league_id, status);
create index idx_score_submissions_game on score_submissions(game_id);

-- RLS
alter table score_submissions enable row level security;

create policy "Users can view score submissions for their leagues"
  on score_submissions for select using (true);

create policy "Users can insert score submissions"
  on score_submissions for insert with check (true);

create policy "Staff can update score submissions"
  on score_submissions for update using (true);
