# สรุปงาน: SailFish Live Token Lifecycle และ Snapshot Fallback

วันที่: 2026-07-29
อ้างอิงแผน: `planned.md`
สถานะ: โค้ดพร้อม Review — **ยังไม่ commit ตามที่ร้องขอ**, ยังไม่ deploy ขึ้น `ai-brain`

## งานที่ 1 — ตรวจ `.git/info/exclude` และไฟล์ `.local`

- `.git/info/exclude` มีเพียงบรรทัดเดียวที่เกี่ยวข้อง: `/.local/`
- `.local/connections.md` มีอยู่จริงและไม่ติด Git (`git ls-files` ไม่พบไฟล์ใน
  `.local/` หรือ `.env` จริง มีแต่ `.env.example`)
- `backend/.env` และ `frontend/.env.local` มีอยู่จริงตามที่เอกสารระบุ
- **พบช่องว่าง**: `frontend/.env.local` (ไฟล์ที่สร้างจาก `Vercel CLI`)
  มีเฉพาะ `VERCEL_OIDC_TOKEN` และ `NEXT_PUBLIC_SUPABASE_ANON_KEY` — ขาด
  `NEXT_PUBLIC_SUPABASE_URL` และ `NEXT_PUBLIC_CONTROL_API_URL` ที่ทั้ง
  `connections.md` และ `frontend/.env.example` ระบุว่าจำเป็น ควรรัน
  `vercel env pull` ใหม่ หรือเพิ่มสองค่านี้ในโปรเจ็กต์ Vercel ก่อนพัฒนา
  Frontend ต่อ (ไม่ได้แก้ไฟล์นี้ให้ เพราะเป็นไฟล์ค่า secret เฉพาะเครื่อง)

## งานที่ 2 — ปรับระบบตาม `planned.md` (5 ระยะ)

### ข้อจำกัดสำคัญที่มีผลต่อทุกระยะ

ไม่ได้ Login เข้า SailFish จริงเพิ่มเติมในรอบนี้ เพราะการกรอก password
เป็นการกระทำที่ agent ทำแทนไม่ได้ (นโยบายความปลอดภัย) จึงใช้เฉพาะ
Capture ที่มีอยู่แล้วในเครื่อง (`sailfish-extension-log-*.json`) และเขียน
โค้ดแบบ Best-effort ที่ Swap กลยุทธ์ค้นหา token ได้ทันทีที่มีข้อมูลใหม่

### ระยะที่ 1 — Protocol discovery

รายละเอียดเต็มอยู่ใน `SAILFISH-LIVE-TOKEN-PROTOCOL-TH.md` (ไฟล์ใหม่)
สรุปคือ:

- ยืนยันได้: ทุก Capture เปิด WebSocket ด้วย pattern เดียวกันเสมอ (getRace
  → getRaceDatas → getRouteInfo → WebSocket) และไม่มี endpoint แยกสำหรับ
  ขอ token
- ยังไม่ยืนยัน: token มาจาก response ของ `getRace` จริงหรือไม่ เพราะ
  Inspector เดิมไม่ได้บันทึก body ของ request ประเภท `xhr` (จุดนี้คือ
  `getRace`) — ระบุขั้นตอนแก้ไว้ในเอกสารแล้ว
- ผลคือ `SailfishClient.get_live_token()` ใช้กลยุทธ์ตามลำดับที่ยืนยัน
  ปลอดภัยที่สุด: สแกน `getRace` → สแกน `get_admin_race` → คืน `None` ถ้าไม่พบ

### ระยะที่ 2 — Automatic token provider

ไฟล์ใหม่ `backend/app/live_token.py`:

- `LiveTokenProvider.get_valid_token()` / `refresh_token()` /
  `invalidate(reason)` / `expires_at` / `source` / `diagnostics()`
- ใช้ `asyncio.Lock` กันหลาย Collector Login/Refresh พร้อมกัน (ทดสอบด้วย
  `test_concurrent_callers_trigger_only_one_login`)
- Refresh ล่วงหน้า 60 วินาทีก่อนหมดอายุ (`SAILFISH_LIVE_TOKEN_REFRESH_SECONDS`)
  โดยอ่าน `exp` จาก JWT แบบไม่ verify signature (Backend ไม่ใช่ผู้ออก token)
- ลำดับ fallback: automatic → `SAILFISH_LIVE_TOKEN` (environment) →
  unavailable
- `diagnostics()` ไม่คืนค่า token จริงเด็ดขาด (มีเทสต์ยืนยัน)

แก้ `backend/app/sailfish.py`:

- เพิ่ม `get_live_token(race_cd)` ตามลำดับกลยุทธ์ข้างต้น
- เปลี่ยน `websocket_url(race)` เป็น `websocket_url(token)` รับ token
  จาก `LiveTokenProvider` โดยตรง แทนที่จะอ่านจาก `settings` หรือเดาใน
  race dict เอง

แก้ `backend/app/config.py`: เพิ่ม `SAILFISH_LIVE_TOKEN_REFRESH_SECONDS`
(default 60), `SAILFISH_SNAPSHOT_FALLBACK_ENABLED` (default true),
`SAILFISH_SNAPSHOT_FALLBACK_SECONDS` (default 1.0)

### ระยะที่ 3 — Collector recovery และ Snapshot fallback

แก้ `backend/app/collector.py`:

- `RaceCollector`/`CollectorManager` ใช้ `LiveTokenProvider` ร่วมกันหนึ่ง
  ตัวต่อ process (สร้างใน `CollectorManager.__init__`)
- ทุกครั้งที่ `_consume()` เชื่อมต่อหรือหลุด (exception ใดก็ตาม) จะเรียก
  `token_provider.invalidate(...)` ก่อน propagate exception ต่อ — เนื่องจาก
  ยังไม่ยืนยัน close code ที่แท้จริงเมื่อ token หมดอายุ (ระยะที่ 1) จึงเลือก
  invalidate แบบระมัดระวังทุกครั้งที่หลุด (ต้นทุนต่ำ แค่ REST call เดิม)
- แยกฟิลด์ error ออกเป็น 3 ทาง ไม่ให้ล้างกันเอง:
  - `last_error` — ข้อผิดพลาดร้ายแรงระดับ bootstrap เท่านั้น
  - `websocket_last_error` / `websocket_last_error_at` — เฉพาะ WebSocket
    เคลียร์เฉพาะตอนเชื่อมต่อและ subscribe สำเร็จจริงเท่านั้น
  - `last_status_poll_error` / `last_status_poll_error_at` — เฉพาะ status
    poll เคลียร์เฉพาะตอน poll ครั้งถัดไปสำเร็จ
  - มีเทสต์ regression ตรงตามที่ระบุใน `planned.md`:
    `test_status_poll_success_does_not_clear_websocket_error`
- Backoff เป็น exponential พร้อม jitter (`self._backoff`, สูงสุด 60 วิ),
  Reset กลับเป็น 1 วินาทีทันทีที่ subscribe ครบ 3 topics สำเร็จ
- Snapshot fallback: เมื่อ WebSocket หลุดระหว่างสถานะ `RECORDING`
  (`50`) จะเริ่ม poll `getRaceDatas` ทุก
  `SAILFISH_SNAPSHOT_FALLBACK_SECONDS` วินาที ผ่าน `_fallback_loop`,
  Normalize ด้วยฟังก์ชันร่วม `_store_snapshot_readings` (ใช้ทั้ง bootstrap
  และ fallback), ติด `source="snapshot_fallback"`, สร้าง
  `data_quality_events` แบบ "engaged/recovered" ครั้งเดียวต่อรอบ (ไม่สแปม
  ทุก poll), และ dedupe อัตโนมัติผ่าน on_conflict key เดิม
  (`race_cd,team_cd,captured_at_ms` และ
  `race_cd,wind_instrument_cd,captured_at_ms`)

### ระยะที่ 4 — Admin diagnostics + API

- `backend/app/schemas.py`: เพิ่ม `token_source`, `token_expires_at`,
  `last_token_refresh_at`, `websocket_last_connected_at`,
  `websocket_last_disconnected_at`, `websocket_last_error(_at)`,
  `transport_mode` (`TransportMode` enum), `last_status_poll_error(_at)`
  ลงใน `CollectorStatus` — ไม่มีฟิลด์ใดเก็บค่า token จริง
- `backend/app/main.py`: `/diagnostics/{race_cd}` เพิ่ม `live_token` จาก
  `LiveTokenProvider.diagnostics()` (ระดับรวมของทุกรอบ) ส่วน
  `/collectors` และ `/collectors/{race_cd}` ส่งฟิลด์ใหม่ทั้งหมดผ่าน
  `CollectorStatus` โดยอัตโนมัติ (response_model เดิม)
- ปุ่ม "ลองเชื่อมต่อใหม่" มีอยู่แล้วที่ `POST /collectors/{race_cd}/retry`
  (stop แล้ว arm ใหม่) — ตรงกับสิ่งที่แผนต้องการ ไม่ต้องเพิ่ม endpoint ใหม่
- Frontend (`frontend/src/types/dashboard.ts`,
  `frontend/src/components/race-dashboard.tsx`): เพิ่ม field ใน type
  `Collector` และแสดง "ที่มาของ Live token" กับ "ช่องทางข้อมูล"
  (WebSocket/Snapshot สำรอง) ในสองแผง Admin ที่มีอยู่แล้ว
  (`PreparedLiveRace` และแผงควบคุมหลัก) — หน้า `app/public/page.tsx` ไม่ได้
  แตะต้อง จึงไม่มีการรั่วไหลของสถานะนี้ไปหน้า Public
  - รัน `npm run typecheck` ผ่านแล้ว ไม่ได้เปิด browser จริงเพราะไม่มี
    Backend/Supabase ข้อมูลจริงให้ทดสอบ interaction

### ระยะที่ 5 — Staging และ Production (ยังไม่ execute)

งานนี้ไม่ได้ SSH เข้า `ai-brain`, ไม่ได้รัน Docker หรือแก้ Supabase จริง
เพราะเป็นการกระทำต่อระบบ Production ที่ต้องขอความยินยอมจากผู้ใช้ก่อนเสมอ
รายการที่ต้องทำก่อน Deploy จริงมีดังนี้:

1. **ต้องรัน Migration ก่อน** — ไฟล์ใหม่
   `supabase/migrations/202607290009_live_token_and_snapshot_fallback.sql`
   เพิ่มคอลัมน์ `source` ใน `athlete_readings`/`wind_readings` และ
   คอลัมน์ diagnostics ใหม่ใน `collector_status`/`collector_runs`
   **หากยังไม่รัน Migration นี้ Backend ใหม่จะ upsert ไม่สำเร็จ**
   (PostgREST จะปฏิเสธคอลัมน์ที่ไม่มีอยู่จริง) ต้อง apply ก่อน
   `docker compose up -d --build`
2. Review โค้ดที่แก้ทั้งหมด (`git diff`) แล้วค่อย commit เอง
3. Deploy ไปที่ `ai-brain` ตามขั้นตอนใน `.local/connections.md`
   (`git pull` → apply migration → `docker compose up -d --build`)
4. ทดสอบกับรอบฝึกจริง 1 รอบ: ยืนยันว่า
   - Collector เข้า `waiting_for_start` ก่อน Start ได้โดยไม่ต้องตั้ง
     `SAILFISH_LIVE_TOKEN` เอง (ตราบใดที่ระยะที่ 1 ยืนยัน endpoint จริงแล้ว
     — ถ้ายังไม่ยืนยัน endpoint ให้ตั้ง `SAILFISH_LIVE_TOKEN` เป็น
     emergency fallback ไว้ก่อนตามเดิม)
   - `token_source` ในหน้า Admin ตรงกับที่คาด (`automatic` หรือ
     `environment`)
   - บังคับ token ผิด/ปิด WebSocket ชั่วคราว แล้วดูว่า `transport_mode`
     เปลี่ยนเป็น `snapshot_fallback` และมี `data_quality_events`
     `snapshot_fallback_engaged`/`recovered`
   - Restart `docker compose up -d --force-recreate` แล้วเชื่อมกลับได้เอง
5. เฝ้าดู log และ Data Quality ตลอดการแข่งขันจริงหนึ่งรอบ ก่อนประกาศว่า
   ใช้งาน Production ได้เต็มรูปแบบ

## ไฟล์ที่แก้ไข/เพิ่มใหม่ทั้งหมด

```text
backend/app/config.py            (แก้)
backend/app/sailfish.py          (แก้)
backend/app/live_token.py        (ใหม่)
backend/app/collector.py         (แก้)
backend/app/schemas.py           (แก้)
backend/app/main.py              (แก้)
backend/tests/test_collector.py  (แก้ + เทสต์ใหม่)
backend/tests/test_sailfish.py   (แก้ + เทสต์ใหม่)
backend/tests/test_live_token.py (ใหม่)
frontend/src/types/dashboard.ts        (แก้)
frontend/src/components/race-dashboard.tsx (แก้)
supabase/migrations/202607290009_live_token_and_snapshot_fallback.sql (ใหม่)
SAILFISH-LIVE-TOKEN-PROTOCOL-TH.md (ใหม่)
SAILFISH-LIVE-TOKEN-IMPLEMENTATION-SUMMARY-TH.md (ใหม่, ไฟล์นี้)
```

## การทดสอบที่รันแล้ว

- `cd backend && .venv/Scripts/python.exe -m pytest -q` → **29 ผ่านทั้งหมด**
  (13 เดิม + 16 ใหม่ ครอบคลุม `LiveTokenProvider`, snapshot fallback,
  การแยก error field, `get_live_token`, `websocket_url`)
- `cd frontend && npm run typecheck` → ผ่าน ไม่มี type error

ไม่ได้รัน Integration test กับ SailFish จริงหรือเปิด Browser ทดสอบ UI
เพราะต้องใช้ Login จริงและ Backend ที่ต่อ Supabase จริง ซึ่งอยู่นอกเหนือ
สิ่งที่ทำได้ในรอบนี้

## สิ่งที่ยังไม่เสร็จ / ต้องให้ผู้ใช้ทำต่อ

1. แก้ Userscript ให้จับ body ของ `xhr` request แล้วยืนยัน endpoint ออก
   token จริง (ระยะที่ 1 เต็มรูปแบบ) — ดู
   `SAILFISH-LIVE-TOKEN-PROTOCOL-TH.md`
2. เพิ่ม `NEXT_PUBLIC_SUPABASE_URL` และ `NEXT_PUBLIC_CONTROL_API_URL` ใน
   `frontend/.env.local`
3. Apply migration `202607290009_...sql` ก่อน deploy
4. Review + commit การเปลี่ยนแปลงเอง (ตามที่ร้องขอไม่ให้ agent commit)
5. Deploy และทดสอบตามเช็คลิสต์ระยะที่ 5 ด้านบน
