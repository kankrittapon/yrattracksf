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
        and r.history_imported_at is not null
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
