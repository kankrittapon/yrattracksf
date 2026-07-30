-- Marks when a race's athlete_readings/wind_readings have been moved out of
-- Supabase to the archive Postgres on ai-brain (retention policy: readings
-- older than 7 days are archived to keep this project under the free-tier
-- storage quota). Frontend uses this to decide whether to query Supabase
-- directly or the backend's /archive endpoints for a given race's history.
alter table public.races add column if not exists archived_at timestamptz;

-- Adding archived_at changes the OUT-parameter row shape, which
-- CREATE OR REPLACE cannot do in place; drop first, then recreate.
drop function if exists public.get_public_race_catalog();

create function public.get_public_race_catalog()
returns table (
  match_cd text,
  match_name text,
  level_cd text,
  class_name text,
  race_cd text,
  race_name text,
  rounds text,
  sailfish_status text,
  public_mode text,
  start_at timestamptz,
  end_at timestamptz,
  history_imported_at timestamptz,
  archived_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  with live_and_waiting as (
    select r.*, 'live'::text as public_mode
    from public.races r
    join public.matches m on m.match_cd = r.match_cd
    join public.race_classes c on c.level_cd = r.level_cd
    where m.is_public and c.public_live_enabled and r.sailfish_status in ('10', '50')
  ),
  waiting_for_next as (
    select distinct on (r.match_cd, r.level_cd) r.*, 'live'::text as public_mode
    from public.races r
    join public.matches m on m.match_cd = r.match_cd
    join public.race_classes c on c.level_cd = r.level_cd
    where m.is_public
      and c.public_live_enabled
      and r.sailfish_status = '99'
      and not exists (
        select 1 from public.races next
        where next.match_cd = r.match_cd
          and next.level_cd = r.level_cd
          and next.sailfish_status in ('10', '50')
      )
    order by r.match_cd, r.level_cd, r.end_at desc nulls last, r.updated_at desc
  ),
  history_ready as (
    select r.*, 'history'::text as public_mode
    from public.races r
    join public.matches m on m.match_cd = r.match_cd
    join public.race_classes c on c.level_cd = r.level_cd
    where m.is_public
      and c.public_history_enabled
      and r.sailfish_status = '99'
      and (r.history_imported_at is not null or r.archived_at is not null)
  ),
  catalog as (
    select * from live_and_waiting
    union all select * from waiting_for_next
    union all select * from history_ready
  )
  select
    m.match_cd, m.name, c.level_cd, c.name,
    r.race_cd, r.name, r.rounds, r.sailfish_status, r.public_mode,
    r.start_at, r.end_at, r.history_imported_at, r.archived_at
  from catalog r
  join public.matches m on m.match_cd = r.match_cd
  join public.race_classes c on c.level_cd = r.level_cd
  order by m.starts_at desc nulls last, c.name, r.start_at desc nulls last, r.rounds desc;
$$;

revoke all on function public.get_public_race_catalog() from public;
grant execute on function public.get_public_race_catalog() to anon, authenticated;

-- get_public_race was renamed to get_public_race_internal in
-- 202607290007_admin_only_tracker_details.sql; the outer get_public_race
-- wrapper (also from 202607290007) just reshapes this function's payload and
-- needs no changes. Redefine get_public_race_internal itself (body from
-- 202607290004, plus vmc_knots from 202607290011) to add archived_at and
-- relax the history-ready condition so archived races still resolve.
create or replace function public.get_public_race_internal(p_race_cd text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'race', jsonb_build_object(
      'race_cd', r.race_cd,
      'match_cd', r.match_cd,
      'match_name', m.name,
      'level_cd', c.level_cd,
      'class_name', c.name,
      'race_name', r.name,
      'rounds', r.rounds,
      'status', r.sailfish_status,
      'start_at', r.start_at,
      'end_at', r.end_at,
      'archived_at', r.archived_at
    ),
    'tracker_status', case when r.sailfish_status in ('10', '50') then (
      select jsonb_build_object(
        'track_open', s.track_open,
        'total_gps', s.total_gps,
        'online_gps', s.online_gps,
        'stale_gps', s.stale_gps,
        'offline_gps', s.offline_gps,
        'last_signal_at_ms', s.last_signal_at_ms,
        'checked_at', s.checked_at
      )
      from public.race_tracker_status s
      where s.race_cd = r.race_cd
    ) else null end,
    'trackers', case when r.sailfish_status in ('10', '50') then coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'team_cd', d.team_cd,
          'team_name', d.team_name,
          'sail_no', d.sail_no,
          'captured_at_ms', d.captured_at_ms,
          'signal_status', d.signal_status,
          'checked_at', d.checked_at
        )
        order by d.sail_no, d.team_name
      )
      from public.tracker_device_state d
      where d.race_cd = r.race_cd
        and d.checked_at >= now() - interval '30 seconds'
    ), '[]'::jsonb) else '[]'::jsonb end,
    'wind', case when r.sailfish_status = '50' then (
      select jsonb_build_object(
        'race_cd', w.race_cd,
        'wind_instrument_cd', w.wind_instrument_cd,
        'captured_at_ms', w.captured_at_ms,
        'speed_knots', w.speed_knots,
        'direction_degree', w.direction_degree,
        'updated_at', w.updated_at
      )
      from public.live_wind_state w
      where w.race_cd = r.race_cd
      order by w.captured_at_ms desc
      limit 1
    ) else null end,
    'athletes', case when r.sailfish_status = '50' then coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'team_cd', t.team_cd,
          'team_name', t.team_name,
          'sail_no', t.sail_no,
          'nationality', t.nationality,
          'captured_at_ms', a.captured_at_ms,
          'sog_knots', a.sog_knots,
          'cog_degree', a.cog_degree,
          'relative_signed_degree', a.relative_signed_degree,
          'relative_angle_degree', a.relative_angle_degree,
          'upwind_vmg_knots', a.upwind_vmg_knots,
          'vmc_knots', a.vmc_knots,
          'updated_at', a.updated_at
        )
        order by t.sail_no, t.team_name
      )
      from public.teams t
      left join public.live_athlete_state a
        on a.race_cd = t.race_cd and a.team_cd = t.team_cd
      where t.race_cd = r.race_cd
    ), '[]'::jsonb)
    when r.sailfish_status = '99' and (r.history_imported_at is not null or r.archived_at is not null) then coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'team_cd', t.team_cd,
          'team_name', t.team_name,
          'sail_no', t.sail_no,
          'nationality', t.nationality,
          'captured_at_ms', null,
          'sog_knots', null,
          'cog_degree', null,
          'relative_signed_degree', null,
          'relative_angle_degree', null,
          'upwind_vmg_knots', null,
          'vmc_knots', null,
          'updated_at', null
        )
        order by t.sail_no, t.team_name
      )
      from public.teams t
      where t.race_cd = r.race_cd
    ), '[]'::jsonb)
    else '[]'::jsonb end
  )
  from public.races r
  join public.matches m on m.match_cd = r.match_cd
  join public.race_classes c on c.level_cd = r.level_cd
  where r.race_cd = p_race_cd
    and m.is_public
    and (
      (r.sailfish_status in ('10', '50') and c.public_live_enabled)
      or (r.sailfish_status = '99' and (c.public_live_enabled or (c.public_history_enabled and (r.history_imported_at is not null or r.archived_at is not null))))
    );
$$;

revoke all on function public.get_public_race_internal(text) from public, anon, authenticated;

-- get_public_athlete_history (202607290011 body) also needs to allow
-- archived races through, matching the relaxed condition above.
drop function if exists public.get_public_athlete_history(text, text, bigint, bigint, integer);

create function public.get_public_athlete_history(
  p_race_cd text,
  p_team_cd text,
  p_from_ms bigint default null,
  p_to_ms bigint default null,
  p_sample_seconds integer default 1
)
returns table (
  team_cd text,
  team_name text,
  sail_no text,
  nationality text,
  captured_at_ms bigint,
  sog_knots double precision,
  cog_degree double precision,
  wind_speed_knots double precision,
  wind_direction_degree double precision,
  relative_signed_degree double precision,
  relative_angle_degree double precision,
  upwind_vmg_knots double precision,
  vmc_knots double precision
)
language sql stable security definer set search_path = public
as $$
  select
    a.team_cd,
    t.team_name,
    t.sail_no,
    t.nationality,
    a.captured_at_ms,
    a.sog_knots,
    a.cog_degree,
    w.speed_knots,
    w.direction_degree,
    a.relative_signed_degree,
    a.relative_angle_degree,
    a.upwind_vmg_knots,
    a.vmc_knots
  from public.athlete_readings a
  join public.teams t
    on t.race_cd = a.race_cd and t.team_cd = a.team_cd
  join public.races r on r.race_cd = a.race_cd
  join public.matches m on m.match_cd = r.match_cd
  join public.race_classes c on c.level_cd = r.level_cd
  left join public.wind_readings w
    on w.race_cd = a.race_cd
    and w.captured_at_ms = a.wind_reading_captured_at_ms
    and (
      r.main_wind_instrument_cd is null
      or w.wind_instrument_cd = r.main_wind_instrument_cd
    )
  where a.race_cd = p_race_cd
    and a.team_cd = p_team_cd
    and m.is_public
    and (
      (r.sailfish_status = '50' and c.public_live_enabled)
      or (
        r.sailfish_status = '99'
        and c.public_history_enabled
        and (r.history_imported_at is not null or r.archived_at is not null)
      )
    )
    and (p_from_ms is null or a.captured_at_ms >= p_from_ms)
    and (p_to_ms is null or a.captured_at_ms <= p_to_ms)
    and (
      p_sample_seconds <= 1
      or mod(
        (a.captured_at_ms / 1000)::bigint,
        least(greatest(p_sample_seconds, 1), 60)::bigint
      ) = 0
    )
  order by a.captured_at_ms
  limit 10000;
$$;

revoke all on function public.get_public_athlete_history(
  text, text, bigint, bigint, integer
) from public;

grant execute on function public.get_public_athlete_history(
  text, text, bigint, bigint, integer
) to anon, authenticated;
