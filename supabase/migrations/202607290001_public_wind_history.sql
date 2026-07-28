create or replace function public.get_public_wind_history(
  p_race_cd text,
  p_minutes integer default 10
)
returns table (
  captured_at_ms bigint,
  speed_knots double precision,
  direction_degree double precision,
  updated_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select
    w.captured_at_ms,
    w.speed_knots,
    w.direction_degree,
    w.created_at as updated_at
  from public.wind_readings w
  join public.races r on r.race_cd = w.race_cd
  join public.race_classes c on c.level_cd = r.level_cd
  where w.race_cd = p_race_cd
    and r.sailfish_status = '50'
    and c.public_live_enabled
    and (
      r.main_wind_instrument_cd is null
      or w.wind_instrument_cd = r.main_wind_instrument_cd
    )
    and w.captured_at_ms >= (
      extract(epoch from now()) * 1000
      - least(greatest(coalesce(p_minutes, 10), 1), 10) * 60 * 1000
    )::bigint
  order by w.captured_at_ms desc
  limit 1200;
$$;

revoke all on function public.get_public_wind_history(text, integer) from public;
grant execute on function public.get_public_wind_history(text, integer)
  to anon, authenticated;
