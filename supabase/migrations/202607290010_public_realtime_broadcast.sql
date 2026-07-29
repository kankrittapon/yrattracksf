-- ลด delay ของหน้า /live และ /public จาก polling (2-4 วินาที) เหลือ Realtime แบบเกือบทันที
--
-- 1) เพิ่ม wind_readings เข้า publication supabase_realtime
--    เพื่อให้หน้า /live (สมาชิกที่ login แล้ว ผ่าน RLS "members read wind data" เดิม)
--    subscribe postgres_changes บนตารางลมดิบได้ แทนการ poll ทุก 2 วินาที
alter publication supabase_realtime add table public.wind_readings;

-- 2) หน้า /public เป็น anon และไม่มีสิทธิ์ select ตารางจริงโดยตรง (อ่านผ่าน RPC security definer
--    ที่ mask พิกัด/คอลัมน์อยู่แล้ว) จึงใช้ postgres_changes ตรงๆ ไม่ได้ — ใช้วิธี "Broadcast from
--    Database" แทน: trigger จะส่ง broadcast แบบ public (private = false, ไม่ต้องมี RLS บน
--    realtime.messages) ไปยัง topic "public:race:<race_cd>" เฉพาะตอนที่รอบนั้นเปิดสาธารณะอยู่จริง
--    เท่านั้น และ payload ไม่มีพิกัด/ความเร็วดิบ เป็นแค่สัญญาณให้ฝั่ง client เรียก RPC ที่ mask
--    ข้อมูลแล้วซ้ำอีกที (เร็วกว่ารอ poll รอบถัดไปมาก แต่ยังคงมาตรฐานการปิดบังข้อมูลเดิมทุกประการ)

create or replace function public.is_race_publicly_live(p_race_cd text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.races r
    join public.matches m on m.match_cd = r.match_cd
    join public.race_classes c on c.level_cd = r.level_cd
    where r.race_cd = p_race_cd
      and m.is_public
      and c.public_live_enabled
      and r.sailfish_status = '50'
  );
$$;

create or replace function public.broadcast_public_live_athlete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.is_race_publicly_live(new.race_cd) then
    perform realtime.send(
      jsonb_build_object('race_cd', new.race_cd, 'team_cd', new.team_cd, 'captured_at_ms', new.captured_at_ms),
      'athlete_update',
      'public:race:' || new.race_cd,
      false
    );
  end if;
  return new;
end;
$$;

drop trigger if exists broadcast_public_live_athlete_trigger on public.live_athlete_state;
create trigger broadcast_public_live_athlete_trigger
  after insert or update on public.live_athlete_state
  for each row execute function public.broadcast_public_live_athlete();

create or replace function public.broadcast_public_live_wind()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.is_race_publicly_live(new.race_cd) then
    perform realtime.send(
      jsonb_build_object('race_cd', new.race_cd, 'captured_at_ms', new.captured_at_ms),
      'wind_update',
      'public:race:' || new.race_cd,
      false
    );
  end if;
  return new;
end;
$$;

drop trigger if exists broadcast_public_live_wind_trigger on public.live_wind_state;
create trigger broadcast_public_live_wind_trigger
  after insert or update on public.live_wind_state
  for each row execute function public.broadcast_public_live_wind();
