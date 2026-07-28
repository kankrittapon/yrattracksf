-- Run once in Supabase SQL editor after enabling the Cron integration.
create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'sailfish-cleanup-raw-messages',
  '15 3 * * *',
  $$select public.cleanup_expired_raw_messages();$$
);

