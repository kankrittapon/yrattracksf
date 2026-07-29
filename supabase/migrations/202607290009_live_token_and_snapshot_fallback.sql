alter table public.athlete_readings
  add column if not exists source text not null default 'websocket';
alter table public.wind_readings
  add column if not exists source text not null default 'websocket';

alter table public.collector_status
  add column if not exists token_source text,
  add column if not exists token_expires_at timestamptz,
  add column if not exists last_token_refresh_at timestamptz,
  add column if not exists websocket_last_connected_at timestamptz,
  add column if not exists websocket_last_disconnected_at timestamptz,
  add column if not exists websocket_last_error text,
  add column if not exists websocket_last_error_at timestamptz,
  add column if not exists transport_mode text not null default 'websocket',
  add column if not exists last_status_poll_error text,
  add column if not exists last_status_poll_error_at timestamptz;

alter table public.collector_runs
  add column if not exists token_source text,
  add column if not exists websocket_last_error text,
  add column if not exists transport_mode text not null default 'websocket';
