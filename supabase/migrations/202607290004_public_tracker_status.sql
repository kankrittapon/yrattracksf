create table if not exists public.race_tracker_status (
  race_cd text primary key references public.races(race_cd) on delete cascade,
  track_open boolean not null default false,
  total_gps integer not null default 0,
  online_gps integer not null default 0,
  stale_gps integer not null default 0,
  offline_gps integer not null default 0,
  last_signal_at_ms bigint,
  checked_at timestamptz not null default now()
);

create table if not exists public.tracker_device_state (
  race_cd text not null,
  team_cd text not null,
  team_name text,
  sail_no text,
  captured_at_ms bigint,
  signal_status text not null default 'offline'
    check (signal_status in ('online', 'stale', 'offline')),
  checked_at timestamptz not null default now(),
  primary key (race_cd, team_cd),
  foreign key (race_cd, team_cd)
    references public.teams(race_cd, team_cd) on delete cascade
);

create index if not exists tracker_device_state_race_status_idx
  on public.tracker_device_state(race_cd, signal_status);

alter table public.race_tracker_status enable row level security;
alter table public.tracker_device_state enable row level security;

drop policy if exists "members read tracker status" on public.race_tracker_status;
create policy "members read tracker status" on public.race_tracker_status
  for select using (public.is_member());

drop policy if exists "members read tracker devices" on public.tracker_device_state;
create policy "members read tracker devices" on public.tracker_device_state
  for select using (public.is_member());

create or replace function public.get_public_race(p_race_cd text)
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
      'end_at', r.end_at
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
          'updated_at', a.updated_at
        )
        order by t.sail_no, t.team_name
      )
      from public.teams t
      left join public.live_athlete_state a
        on a.race_cd = t.race_cd and a.team_cd = t.team_cd
      where t.race_cd = r.race_cd
    ), '[]'::jsonb)
    when r.sailfish_status = '99' and r.history_imported_at is not null then coalesce((
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
      or (r.sailfish_status = '99' and (c.public_live_enabled or (c.public_history_enabled and r.history_imported_at is not null)))
    );
$$;

revoke all on function public.get_public_race(text) from public;
grant execute on function public.get_public_race(text) to anon, authenticated;
