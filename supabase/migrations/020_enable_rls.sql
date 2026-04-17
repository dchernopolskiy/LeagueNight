-- 020: Enable RLS on staff-managed tables.
--
-- Model: "is_league_staff(league_id, profile_id)" = organizer OR row in league_staff.
-- Chat tables (messages, chat_read_cursors, chat_mutes, message_reports) are NOT
-- touched here; they need a different access model (league members, not just staff)
-- and will be covered in a follow-up migration.
--
-- Player-portal paths (token-based, no auth.uid()) continue to work because every
-- API route that serves the portal uses createAdminClient() which bypasses RLS.

-- ── Helpers ─────────────────────────────────────────────────────────────

create or replace function is_league_staff(p_league_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from leagues
    where id = p_league_id and organizer_id = p_profile_id
  ) or exists (
    select 1 from league_staff
    where league_id = p_league_id and profile_id = p_profile_id
  );
$$;

grant execute on function is_league_staff(uuid, uuid) to authenticated;

-- Resolve the current auth user's profile id. Cached per-statement by Postgres.
create or replace function current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from profiles where auth_id = auth.uid();
$$;

grant execute on function current_profile_id() to authenticated;

-- ── leagues ────────────────────────────────────────────────────────────

alter table leagues enable row level security;

create policy "staff read leagues"
  on leagues for select
  using (is_league_staff(id, current_profile_id()));

create policy "organizer inserts leagues"
  on leagues for insert
  with check (organizer_id = current_profile_id());

create policy "staff updates leagues"
  on leagues for update
  using (is_league_staff(id, current_profile_id()))
  with check (is_league_staff(id, current_profile_id()));

create policy "organizer deletes leagues"
  on leagues for delete
  using (organizer_id = current_profile_id());

-- ── league_staff ───────────────────────────────────────────────────────
-- Only organizers can manage staff rows. Staff can see the roster.

alter table league_staff enable row level security;

create policy "staff read league_staff"
  on league_staff for select
  using (is_league_staff(league_id, current_profile_id()));

create policy "organizer writes league_staff"
  on league_staff for all
  using (
    exists (
      select 1 from leagues
      where id = league_staff.league_id
        and organizer_id = current_profile_id()
    )
  )
  with check (
    exists (
      select 1 from leagues
      where id = league_staff.league_id
        and organizer_id = current_profile_id()
    )
  );

-- ── Direct league-scoped tables ────────────────────────────────────────
-- All follow the same shape: staff of league_id can do anything.

do $$
declare
  t text;
begin
  foreach t in array array[
    'teams',
    'divisions',
    'games',
    'brackets',
    'game_day_patterns',
    'availability_checks',
    'league_fees',
    'standings',
    'score_submissions'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$
      create policy "staff all %1$s"
        on %1$I for all
        using (is_league_staff(league_id, current_profile_id()))
        with check (is_league_staff(league_id, current_profile_id()))
    $p$, t);
  end loop;
end $$;

-- ── sub_requests ──────────────────────────────────────────────────────
-- Joined via games.league_id. The table stores game_id/team_id, not league_id.

alter table sub_requests enable row level security;

create policy "staff all sub_requests"
  on sub_requests for all
  using (
    exists (
      select 1 from games g
      where g.id = sub_requests.game_id
        and is_league_staff(g.league_id, current_profile_id())
    )
  )
  with check (
    exists (
      select 1 from games g
      where g.id = sub_requests.game_id
        and is_league_staff(g.league_id, current_profile_id())
    )
  );

-- ── bracket_slots ──────────────────────────────────────────────────────
-- Joined via brackets.league_id.

alter table bracket_slots enable row level security;

create policy "staff all bracket_slots"
  on bracket_slots for all
  using (
    exists (
      select 1 from brackets b
      where b.id = bracket_slots.bracket_id
        and is_league_staff(b.league_id, current_profile_id())
    )
  )
  with check (
    exists (
      select 1 from brackets b
      where b.id = bracket_slots.bracket_id
        and is_league_staff(b.league_id, current_profile_id())
    )
  );

-- ── locations ──────────────────────────────────────────────────────────
-- Owner (organizer_id on the location) + staff of any league that uses it.
-- "Uses it" = game_day_patterns for that league reference this location, OR
-- the location is explicitly shared via bracket_scheduling (18). For now we
-- keep it simple: staff of any league owned by the same organizer can see it.
-- Rationale: locations are organizer-owned infrastructure; co-admins of that
-- organizer's leagues already have write access to the games that reference them.

alter table locations enable row level security;

create policy "owner or staff reads locations"
  on locations for select
  using (
    organizer_id = current_profile_id()
    or exists (
      select 1 from leagues l
      join league_staff s on s.league_id = l.id
      where l.organizer_id = locations.organizer_id
        and s.profile_id = current_profile_id()
    )
  );

create policy "owner writes locations"
  on locations for insert
  with check (organizer_id = current_profile_id());

create policy "owner or staff updates locations"
  on locations for update
  using (
    organizer_id = current_profile_id()
    or exists (
      select 1 from leagues l
      join league_staff s on s.league_id = l.id
      where l.organizer_id = locations.organizer_id
        and s.profile_id = current_profile_id()
    )
  );

create policy "owner deletes locations"
  on locations for delete
  using (organizer_id = current_profile_id());

alter table location_unavailability enable row level security;

create policy "owner or staff all location_unavailability"
  on location_unavailability for all
  using (
    exists (
      select 1 from locations loc
      where loc.id = location_unavailability.location_id
        and (
          loc.organizer_id = current_profile_id()
          or exists (
            select 1 from leagues l
            join league_staff s on s.league_id = l.id
            where l.organizer_id = loc.organizer_id
              and s.profile_id = current_profile_id()
          )
        )
    )
  )
  with check (
    exists (
      select 1 from locations loc
      where loc.id = location_unavailability.location_id
        and (
          loc.organizer_id = current_profile_id()
          or exists (
            select 1 from leagues l
            join league_staff s on s.league_id = l.id
            where l.organizer_id = loc.organizer_id
              and s.profile_id = current_profile_id()
          )
        )
    )
  );

-- ── open_gym ───────────────────────────────────────────────────────────
-- Sessions are organizer-owned (like locations). RSVPs are public-writable
-- by design (no-auth signup via session link), so we keep RSVP inserts open
-- but restrict reads/updates/deletes to the owning organizer + their staff.

alter table open_gym_sessions enable row level security;

create policy "owner or staff reads open_gym_sessions"
  on open_gym_sessions for select
  using (
    organizer_id = current_profile_id()
    or exists (
      select 1 from leagues l
      join league_staff s on s.league_id = l.id
      where l.organizer_id = open_gym_sessions.organizer_id
        and s.profile_id = current_profile_id()
    )
  );

create policy "owner writes open_gym_sessions"
  on open_gym_sessions for insert
  with check (organizer_id = current_profile_id());

create policy "owner or staff updates open_gym_sessions"
  on open_gym_sessions for update
  using (
    organizer_id = current_profile_id()
    or exists (
      select 1 from leagues l
      join league_staff s on s.league_id = l.id
      where l.organizer_id = open_gym_sessions.organizer_id
        and s.profile_id = current_profile_id()
    )
  );

create policy "owner deletes open_gym_sessions"
  on open_gym_sessions for delete
  using (organizer_id = current_profile_id());

alter table open_gym_rsvps enable row level security;

create policy "owner or staff reads open_gym_rsvps"
  on open_gym_rsvps for select
  using (
    exists (
      select 1 from open_gym_sessions ogs
      where ogs.id = open_gym_rsvps.session_id
        and (
          ogs.organizer_id = current_profile_id()
          or exists (
            select 1 from leagues l
            join league_staff s on s.league_id = l.id
            where l.organizer_id = ogs.organizer_id
              and s.profile_id = current_profile_id()
          )
        )
    )
  );

create policy "owner or staff writes open_gym_rsvps"
  on open_gym_rsvps for update
  using (
    exists (
      select 1 from open_gym_sessions ogs
      where ogs.id = open_gym_rsvps.session_id
        and (
          ogs.organizer_id = current_profile_id()
          or exists (
            select 1 from leagues l
            join league_staff s on s.league_id = l.id
            where l.organizer_id = ogs.organizer_id
              and s.profile_id = current_profile_id()
          )
        )
    )
  );

create policy "owner or staff deletes open_gym_rsvps"
  on open_gym_rsvps for delete
  using (
    exists (
      select 1 from open_gym_sessions ogs
      where ogs.id = open_gym_rsvps.session_id
        and (
          ogs.organizer_id = current_profile_id()
          or exists (
            select 1 from leagues l
            join league_staff s on s.league_id = l.id
            where l.organizer_id = ogs.organizer_id
              and s.profile_id = current_profile_id()
          )
        )
    )
  );

-- Note: open_gym_rsvps INSERT is intentionally not policied here. Session signups
-- flow through API routes using createAdminClient() (no auth.uid() for walk-ins).
-- If you later add a no-auth public insert path, add a permissive insert policy
-- with a rate-limited sanity check.

-- ── players ────────────────────────────────────────────────────────────
-- Staff of the league can read/write. Token-auth (portal) paths go through
-- createAdminClient(), so they bypass RLS.

alter table players enable row level security;

create policy "staff all players"
  on players for all
  using (is_league_staff(league_id, current_profile_id()))
  with check (is_league_staff(league_id, current_profile_id()));

create policy "self reads own player rows"
  on players for select
  using (profile_id = current_profile_id());

-- ── rsvps ──────────────────────────────────────────────────────────────
-- Joined via games.league_id. Token-auth portal mutations go through admin client.

alter table rsvps enable row level security;

create policy "staff all rsvps"
  on rsvps for all
  using (
    exists (
      select 1 from games g
      where g.id = rsvps.game_id
        and is_league_staff(g.league_id, current_profile_id())
    )
  )
  with check (
    exists (
      select 1 from games g
      where g.id = rsvps.game_id
        and is_league_staff(g.league_id, current_profile_id())
    )
  );

-- ── payments ───────────────────────────────────────────────────────────
-- Joined via league_fees.league_id.

alter table payments enable row level security;

create policy "staff all payments"
  on payments for all
  using (
    exists (
      select 1 from league_fees lf
      where lf.id = payments.league_fee_id
        and is_league_staff(lf.league_id, current_profile_id())
    )
  )
  with check (
    exists (
      select 1 from league_fees lf
      where lf.id = payments.league_fee_id
        and is_league_staff(lf.league_id, current_profile_id())
    )
  );

-- ── profiles ───────────────────────────────────────────────────────────
-- Each profile can read + update its own row. Writes outside of self go
-- through service role (e.g. signup trigger).

alter table profiles enable row level security;

create policy "self reads profile"
  on profiles for select
  using (auth_id = auth.uid());

create policy "self updates profile"
  on profiles for update
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

-- Staff can see profile basics of fellow staff in shared leagues (for chat UI etc).
create policy "staff reads co-staff profiles"
  on profiles for select
  using (
    exists (
      select 1 from league_staff s1
      join league_staff s2 on s1.league_id = s2.league_id
      where s1.profile_id = profiles.id
        and s2.profile_id = current_profile_id()
    )
    or exists (
      select 1 from leagues l
      where l.organizer_id = profiles.id
        and is_league_staff(l.id, current_profile_id())
    )
  );

-- ── notifications ──────────────────────────────────────────────────────
-- Notifications are addressed to players; staff of the league can read them.

alter table notifications enable row level security;

create policy "staff reads notifications"
  on notifications for select
  using (
    exists (
      select 1 from players p
      where p.id = notifications.player_id
        and is_league_staff(p.league_id, current_profile_id())
    )
  );

-- Inserts go through service role (senders), no insert policy needed for authenticated.

-- ── people ─────────────────────────────────────────────────────────────
-- Global cross-league identity table. Staff can read people referenced by
-- any of their players; writes are organizer-only via service role paths.

alter table people enable row level security;

create policy "self reads people"
  on people for select
  using (
    exists (
      select 1 from profiles p
      where p.id = current_profile_id()
        and (p.email = people.email or (p.phone is not null and p.phone = people.phone))
    )
  );

-- Staff reads will go through service role API routes for now; revisit if
-- we start querying people directly from the client.

-- ── match_notifications ────────────────────────────────────────────────
-- Joined via games.league_id (assuming schema — verify if table has direct league_id).

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'match_notifications') then
    execute 'alter table match_notifications enable row level security';
    -- Try direct league_id first; fall back to join via game_id.
    if exists (select 1 from information_schema.columns
               where table_schema = 'public'
                 and table_name = 'match_notifications'
                 and column_name = 'league_id') then
      execute $p$
        create policy "staff all match_notifications"
          on match_notifications for all
          using (is_league_staff(league_id, current_profile_id()))
          with check (is_league_staff(league_id, current_profile_id()))
      $p$;
    else
      execute $p$
        create policy "staff all match_notifications"
          on match_notifications for all
          using (
            exists (
              select 1 from games g
              where g.id = match_notifications.game_id
                and is_league_staff(g.league_id, current_profile_id())
            )
          )
          with check (
            exists (
              select 1 from games g
              where g.id = match_notifications.game_id
                and is_league_staff(g.league_id, current_profile_id())
            )
          )
      $p$;
    end if;
  end if;
end $$;
