create or replace function public.get_public_tracker_numbers(p_race_cd text)
returns table (
  team_cd text,
  tracker_no text
)
language sql stable security definer set search_path = public
as $$
  select t.team_cd, t.device_cd as tracker_no
  from public.teams t
  join public.races r on r.race_cd = t.race_cd
  join public.matches m on m.match_cd = r.match_cd
  join public.race_classes c on c.level_cd = r.level_cd
  where t.race_cd = p_race_cd
    and m.is_public
    and c.public_live_enabled
    and r.sailfish_status in ('10', '50')
  order by t.sail_no, t.team_name;
$$;

revoke all on function public.get_public_tracker_numbers(text) from public;
grant execute on function public.get_public_tracker_numbers(text) to anon, authenticated;
