create extension if not exists pgcrypto;

create type public.app_role as enum ('viewer', 'admin');
create type public.collector_state as enum (
  'idle', 'armed', 'waiting_for_start', 'recording',
  'finishing', 'completed', 'error'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.matches (
  match_cd text primary key,
  name text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  country text,
  city text,
  is_public boolean not null default false,
  synced_at timestamptz not null default now(),
  raw_metadata jsonb not null default '{}'::jsonb
);

create table public.race_classes (
  level_cd text primary key,
  match_cd text not null references public.matches(match_cd) on delete cascade,
  name text not null,
  logo_url text,
  raw_metadata jsonb not null default '{}'::jsonb
);

create table public.races (
  race_cd text primary key,
  match_cd text not null references public.matches(match_cd) on delete cascade,
  level_cd text references public.race_classes(level_cd) on delete set null,
  name text,
  rounds text,
  group_name text,
  sailfish_status text,
  start_at timestamptz,
  end_at timestamptz,
  main_wind_instrument_cd text,
  wind_direction_convention text not null default 'from'
    check (wind_direction_convention in ('from', 'to')),
  raw_metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.teams (
  team_cd text not null,
  race_cd text not null references public.races(race_cd) on delete cascade,
  team_name text,
  sail_no text,
  nationality text,
  team_area text,
  device_cd text,
  race_team_color text,
  raw_metadata jsonb not null default '{}'::jsonb,
  primary key (race_cd, team_cd)
);

create table public.devices (
  race_cd text not null references public.races(race_cd) on delete cascade,
  device_cd text not null,
  device_type text not null,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  raw_metadata jsonb not null default '{}'::jsonb,
  primary key (race_cd, device_cd, device_type)
);

create table public.wind_instruments (
  wind_instrument_cd text not null,
  race_cd text not null references public.races(race_cd) on delete cascade,
  name text,
  device_cd text,
  roll_type text,
  is_main boolean not null default false,
  raw_metadata jsonb not null default '{}'::jsonb,
  primary key (race_cd, wind_instrument_cd)
);

create table public.athlete_readings (
  id bigint generated always as identity primary key,
  race_cd text not null references public.races(race_cd) on delete cascade,
  team_cd text not null,
  team_name text,
  sail_no text,
  device_cd text,
  nationality text,
  captured_at_ms bigint not null,
  received_at_ms bigint,
  captured_at timestamptz generated always as
    (to_timestamp(captured_at_ms / 1000.0)) stored,
  sog_knots double precision,
  cog_degree double precision,
  latitude double precision,
  longitude double precision,
  relative_signed_degree double precision,
  relative_angle_degree double precision,
  upwind_vmg_knots double precision,
  wind_reading_captured_at_ms bigint,
  phase text not null default 'recording',
  raw_runtime jsonb,
  created_at timestamptz not null default now(),
  unique (race_cd, team_cd, captured_at_ms),
  foreign key (race_cd, team_cd)
    references public.teams(race_cd, team_cd) on delete cascade
);

create index athlete_readings_race_time_idx
  on public.athlete_readings(race_cd, captured_at_ms desc);
create index athlete_readings_team_time_idx
  on public.athlete_readings(race_cd, team_cd, captured_at_ms desc);

create table public.wind_readings (
  id bigint generated always as identity primary key,
  race_cd text not null references public.races(race_cd) on delete cascade,
  wind_instrument_cd text not null,
  wind_instrument_name text,
  device_cd text,
  roll_type text,
  captured_at_ms bigint not null,
  received_at_ms bigint,
  captured_at timestamptz generated always as
    (to_timestamp(captured_at_ms / 1000.0)) stored,
  speed_knots double precision,
  direction_degree double precision,
  latitude double precision,
  longitude double precision,
  phase text not null default 'recording',
  raw_runtime jsonb,
  created_at timestamptz not null default now(),
  unique (race_cd, wind_instrument_cd, captured_at_ms),
  foreign key (race_cd, wind_instrument_cd)
    references public.wind_instruments(race_cd, wind_instrument_cd) on delete cascade
);

create index wind_readings_race_time_idx
  on public.wind_readings(race_cd, captured_at_ms desc);

create table public.race_events (
  id bigint generated always as identity primary key,
  race_cd text not null references public.races(race_cd) on delete cascade,
  event_type text not null,
  captured_at timestamptz not null,
  phase text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.collector_runs (
  id uuid primary key default gen_random_uuid(),
  race_cd text not null references public.races(race_cd) on delete cascade,
  state public.collector_state not null default 'idle',
  phase_source text,
  started_at timestamptz,
  stopped_at timestamptz,
  last_message_at timestamptz,
  last_error text,
  messages_received bigint not null default 0,
  normalized_readings bigint not null default 0,
  reconnects integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collector_status (
  race_cd text primary key references public.races(race_cd) on delete cascade,
  run_id uuid references public.collector_runs(id) on delete set null,
  state public.collector_state not null default 'idle',
  websocket_connected boolean not null default false,
  sailfish_status text,
  phase_source text,
  last_message_at timestamptz,
  last_error text,
  messages_received bigint not null default 0,
  normalized_readings bigint not null default 0,
  reconnects integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.live_athlete_state (
  race_cd text not null,
  team_cd text not null,
  reading_id bigint not null references public.athlete_readings(id) on delete cascade,
  captured_at_ms bigint not null,
  sog_knots double precision,
  cog_degree double precision,
  latitude double precision,
  longitude double precision,
  relative_signed_degree double precision,
  relative_angle_degree double precision,
  upwind_vmg_knots double precision,
  updated_at timestamptz not null default now(),
  primary key (race_cd, team_cd),
  foreign key (race_cd, team_cd)
    references public.teams(race_cd, team_cd) on delete cascade
);

create table public.live_wind_state (
  race_cd text not null,
  wind_instrument_cd text not null,
  reading_id bigint not null references public.wind_readings(id) on delete cascade,
  captured_at_ms bigint not null,
  speed_knots double precision,
  direction_degree double precision,
  latitude double precision,
  longitude double precision,
  updated_at timestamptz not null default now(),
  primary key (race_cd, wind_instrument_cd),
  foreign key (race_cd, wind_instrument_cd)
    references public.wind_instruments(race_cd, wind_instrument_cd) on delete cascade
);

create table public.raw_messages (
  id bigint generated always as identity primary key,
  race_cd text not null,
  topic text,
  phase text not null,
  payload jsonb not null,
  received_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index raw_messages_expiry_idx on public.raw_messages(expires_at);
create index raw_messages_race_time_idx on public.raw_messages(race_cd, received_at desc);

create table public.data_quality_events (
  id bigint generated always as identity primary key,
  race_cd text,
  event_type text not null,
  severity text not null check (severity in ('info', 'warning', 'error')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  race_cd text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid());
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.update_live_athlete_state()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.live_athlete_state (
    race_cd, team_cd, reading_id, captured_at_ms, sog_knots, cog_degree,
    latitude, longitude, relative_signed_degree, relative_angle_degree,
    upwind_vmg_knots, updated_at
  ) values (
    new.race_cd, new.team_cd, new.id, new.captured_at_ms, new.sog_knots, new.cog_degree,
    new.latitude, new.longitude, new.relative_signed_degree, new.relative_angle_degree,
    new.upwind_vmg_knots, now()
  )
  on conflict (race_cd, team_cd) do update set
    reading_id = excluded.reading_id,
    captured_at_ms = excluded.captured_at_ms,
    sog_knots = excluded.sog_knots,
    cog_degree = excluded.cog_degree,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    relative_signed_degree = excluded.relative_signed_degree,
    relative_angle_degree = excluded.relative_angle_degree,
    upwind_vmg_knots = excluded.upwind_vmg_knots,
    updated_at = now()
  where excluded.captured_at_ms >= live_athlete_state.captured_at_ms;
  return new;
end;
$$;

create trigger athlete_reading_updates_live
  after insert or update on public.athlete_readings
  for each row execute function public.update_live_athlete_state();

create or replace function public.update_live_wind_state()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.live_wind_state (
    race_cd, wind_instrument_cd, reading_id, captured_at_ms,
    speed_knots, direction_degree, latitude, longitude, updated_at
  ) values (
    new.race_cd, new.wind_instrument_cd, new.id, new.captured_at_ms,
    new.speed_knots, new.direction_degree, new.latitude, new.longitude, now()
  )
  on conflict (race_cd, wind_instrument_cd) do update set
    reading_id = excluded.reading_id,
    captured_at_ms = excluded.captured_at_ms,
    speed_knots = excluded.speed_knots,
    direction_degree = excluded.direction_degree,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    updated_at = now()
  where excluded.captured_at_ms >= live_wind_state.captured_at_ms;
  return new;
end;
$$;

create trigger wind_reading_updates_live
  after insert or update on public.wind_readings
  for each row execute function public.update_live_wind_state();

create or replace function public.cleanup_expired_raw_messages()
returns bigint
language plpgsql security definer set search_path = public
as $$
declare deleted_count bigint;
begin
  delete from public.raw_messages where expires_at < now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.race_classes enable row level security;
alter table public.races enable row level security;
alter table public.teams enable row level security;
alter table public.devices enable row level security;
alter table public.wind_instruments enable row level security;
alter table public.athlete_readings enable row level security;
alter table public.wind_readings enable row level security;
alter table public.race_events enable row level security;
alter table public.collector_runs enable row level security;
alter table public.collector_status enable row level security;
alter table public.live_athlete_state enable row level security;
alter table public.live_wind_state enable row level security;
alter table public.raw_messages enable row level security;
alter table public.data_quality_events enable row level security;
alter table public.audit_logs enable row level security;

create policy "members read own profile" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "admins update profiles" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "members read matches" on public.matches
  for select to authenticated using (public.is_member());
create policy "members read classes" on public.race_classes
  for select to authenticated using (public.is_member());
create policy "members read races" on public.races
  for select to authenticated using (public.is_member());
create policy "members read teams" on public.teams
  for select to authenticated using (public.is_member());
create policy "members read instruments" on public.wind_instruments
  for select to authenticated using (public.is_member());
create policy "members read athlete data" on public.athlete_readings
  for select to authenticated using (public.is_member());
create policy "members read wind data" on public.wind_readings
  for select to authenticated using (public.is_member());
create policy "members read race events" on public.race_events
  for select to authenticated using (public.is_member());
create policy "members read collector state" on public.collector_status
  for select to authenticated using (public.is_member());
create policy "members read live athletes" on public.live_athlete_state
  for select to authenticated using (public.is_member());
create policy "members read live wind" on public.live_wind_state
  for select to authenticated using (public.is_member());

create policy "admins read devices" on public.devices
  for select to authenticated using (public.is_admin());
create policy "admins read collector runs" on public.collector_runs
  for select to authenticated using (public.is_admin());
create policy "admins read quality events" on public.data_quality_events
  for select to authenticated using (public.is_admin());
create policy "admins read audit logs" on public.audit_logs
  for select to authenticated using (public.is_admin());
create policy "users create own audit entries" on public.audit_logs
  for insert to authenticated with check (actor_id = auth.uid());

-- raw_messages intentionally has no authenticated policy; only service_role can access it.

alter publication supabase_realtime add table public.collector_status;
alter publication supabase_realtime add table public.live_athlete_state;
alter publication supabase_realtime add table public.live_wind_state;
alter publication supabase_realtime add table public.data_quality_events;

