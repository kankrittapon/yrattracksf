-- Schema for the archive Postgres instance running on ai-brain
-- (backend/docker-compose.yml service "sailfish-archive-postgres").
--
-- Holds athlete_readings/wind_readings older than the retention window once
-- they've been moved out of Supabase by app.archive.ArchiveManager. Plain
-- tables only - no RLS/auth/triggers, since this data is immutable history
-- read only by the backend's own /archive endpoints (see app/main.py).
--
-- Run once against a fresh database:
--   psql "$ARCHIVE_DATABASE_URL" -f archive_schema.sql

create table if not exists athlete_readings (
  id bigint primary key,
  race_cd text not null,
  team_cd text not null,
  team_name text,
  sail_no text,
  device_cd text,
  nationality text,
  captured_at_ms bigint not null,
  received_at_ms bigint,
  sog_knots double precision,
  cog_degree double precision,
  latitude double precision,
  longitude double precision,
  relative_signed_degree double precision,
  relative_angle_degree double precision,
  upwind_vmg_knots double precision,
  vmc_knots double precision,
  wind_reading_captured_at_ms bigint,
  phase text,
  created_at timestamptz
);

create index if not exists athlete_readings_race_team_time_idx
  on athlete_readings (race_cd, team_cd, captured_at_ms);

create table if not exists wind_readings (
  id bigint primary key,
  race_cd text not null,
  wind_instrument_cd text not null,
  wind_instrument_name text,
  device_cd text,
  roll_type text,
  captured_at_ms bigint not null,
  received_at_ms bigint,
  speed_knots double precision,
  direction_degree double precision,
  latitude double precision,
  longitude double precision,
  phase text,
  created_at timestamptz
);

create index if not exists wind_readings_race_time_idx
  on wind_readings (race_cd, captured_at_ms);
