-- Server-side unread message count aggregation.
-- Replaces the in-route JS loop that was capped at 1000 messages and would
-- silently under-count once a busy league crossed that threshold.
--
-- Returns one row per (league_id, channel_key) for the given profile.
-- The caller joins these back into league-level totals.

create or replace function unread_counts_for_profile(p_profile_id uuid)
returns table (
  league_id uuid,
  channel_key text,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with user_leagues as (
    select id as league_id from leagues where organizer_id = p_profile_id
    union
    select league_id from league_staff where profile_id = p_profile_id
    union
    select league_id from players where profile_id = p_profile_id
  ),
  labeled as (
    select
      m.league_id,
      case
        when m.channel_type = 'team' and m.team_id is not null
          then 'team-' || m.team_id::text
        when m.channel_type = 'division' and m.division_id is not null
          then 'division-' || m.division_id::text
        when m.channel_type = 'direct' and m.team_id is not null
          then 'direct-' || m.team_id::text
        else m.channel_type
      end as channel_key,
      m.created_at
    from messages m
    join user_leagues ul on ul.league_id = m.league_id
    where m.deleted_at is null
  )
  select
    l.league_id,
    l.channel_key,
    count(*)::bigint as unread_count
  from labeled l
  left join chat_read_cursors c
    on c.profile_id = p_profile_id
   and c.league_id = l.league_id
   and c.channel_key = l.channel_key
  where c.last_read_at is null or l.created_at > c.last_read_at
  group by l.league_id, l.channel_key;
$$;

grant execute on function unread_counts_for_profile(uuid) to authenticated;
