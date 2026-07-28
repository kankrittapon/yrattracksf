alter table public.race_classes
  add column if not exists public_live_enabled boolean not null default false,
  add column if not exists public_history_enabled boolean not null default false;

alter table public.races
  add column if not exists tracked_at timestamptz,
  add column if not exists history_imported_at timestamptz;

create table if not exists public.history_imports (
  race_cd text primary key references public.races(race_cd) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'error')),
  scheduled_for timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  progress_percent double precision not null default 0,
  athlete_readings_count bigint not null default 0,
  wind_readings_count bigint not null default 0,
  attempts integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);

create index if not exists history_imports_due_idx
  on public.history_imports(status, scheduled_for);

alter table public.history_imports enable row level security;

create policy "admins read history imports" on public.history_imports
  for select to authenticated using (public.is_admin());

create or replace function public.get_public_race_catalog()
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
  history_imported_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select
    m.match_cd,
    m.name,
    c.level_cd,
    c.name,
    r.race_cd,
    r.name,
    r.rounds,
    r.sailfish_status,
    case when r.sailfish_status = '50' then 'live' else 'history' end,
    r.start_at,
    r.end_at,
    r.history_imported_at
  from public.races r
  join public.matches m on m.match_cd = r.match_cd
  join public.race_classes c on c.level_cd = r.level_cd
  where
    (r.sailfish_status = '50' and c.public_live_enabled)
    or
    (
      r.sailfish_status = '99'
      and r.history_imported_at is not null
      and c.public_history_enabled
    )
  order by m.starts_at desc nulls last, c.name, r.start_at desc nulls last;
$$;

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
    'wind', (
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
    ),
    'athletes', coalesce((
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
  )
  from public.races r
  join public.matches m on m.match_cd = r.match_cd
  join public.race_classes c on c.level_cd = r.level_cd
  where r.race_cd = p_race_cd
    and (
      (r.sailfish_status = '50' and c.public_live_enabled)
      or
      (
        r.sailfish_status = '99'
        and r.history_imported_at is not null
        and c.public_history_enabled
      )
    );
$$;

create or replace function public.get_public_athlete_history(
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
  upwind_vmg_knots double precision
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
    a.upwind_vmg_knots
  from public.athlete_readings a
  join public.teams t
    on t.race_cd = a.race_cd and t.team_cd = a.team_cd
  join public.races r on r.race_cd = a.race_cd
  join public.race_classes c on c.level_cd = r.level_cd
  left join public.wind_readings w
    on w.race_cd = a.race_cd
    and w.captured_at_ms = a.wind_reading_captured_at_ms
    and w.wind_instrument_cd = r.main_wind_instrument_cd
  where a.race_cd = p_race_cd
    and a.team_cd = p_team_cd
    and r.sailfish_status = '99'
    and r.history_imported_at is not null
    and c.public_history_enabled
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

revoke all on function public.get_public_race_catalog() from public;
revoke all on function public.get_public_race(text) from public;
revoke all on function public.get_public_athlete_history(text, text, bigint, bigint, integer) from public;

grant execute on function public.get_public_race_catalog() to anon, authenticated;
grant execute on function public.get_public_race(text) to anon, authenticated;
grant execute on function public.get_public_athlete_history(text, text, bigint, bigint, integer)
  to anon, authenticated;
