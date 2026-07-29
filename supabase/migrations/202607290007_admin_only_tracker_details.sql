drop policy if exists "members read tracker status" on public.race_tracker_status;
drop policy if exists "members read tracker devices" on public.tracker_device_state;

create policy "admins read tracker status" on public.race_tracker_status
  for select to authenticated using (public.is_admin());

create policy "admins read tracker devices" on public.tracker_device_state
  for select to authenticated using (public.is_admin());

revoke all on function public.get_public_tracker_numbers(text)
  from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.get_public_race_internal(text)') is null then
    alter function public.get_public_race(text)
      rename to get_public_race_internal;
  end if;
end
$$;

revoke all on function public.get_public_race_internal(text)
  from public, anon, authenticated;

create or replace function public.get_public_race(p_race_cd text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select
    case
      when source.payload is null then null
      else jsonb_set(
        jsonb_set(
          source.payload,
          '{tracker_status}',
          case
            when source.payload->'tracker_status' is null then 'null'::jsonb
            else jsonb_build_object(
              'track_open',
              coalesce(
                (source.payload #>> '{tracker_status,track_open}')::boolean,
                false
              )
            )
          end
        ),
        '{trackers}',
        '[]'::jsonb
      )
    end
  from (
    select public.get_public_race_internal(p_race_cd) as payload
  ) source;
$$;

revoke all on function public.get_public_race(text) from public;
grant execute on function public.get_public_race(text) to anon, authenticated;
