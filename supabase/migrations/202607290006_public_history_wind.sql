create or replace function public.get_public_race_wind(p_race_cd text)
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
  join public.matches m on m.match_cd = r.match_cd
  join public.race_classes c on c.level_cd = r.level_cd
  where w.race_cd = p_race_cd
    and m.is_public
    and (
      (r.sailfish_status = '50' and c.public_live_enabled)
      or (
        r.sailfish_status = '99'
        and c.public_history_enabled
        and r.history_imported_at is not null
      )
    )
    and (
      r.main_wind_instrument_cd is null
      or w.wind_instrument_cd = r.main_wind_instrument_cd
    )
  order by w.captured_at_ms desc
  limit 1;
$$;

revoke all on function public.get_public_race_wind(text) from public;
grant execute on function public.get_public_race_wind(text) to anon, authenticated;
