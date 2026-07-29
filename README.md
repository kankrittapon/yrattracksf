# YRAT Track SF — SailFish Race Intelligence

ระบบเก็บ แสดง และเล่นย้อนหลังข้อมูลการแข่งขันเรือใบจาก SailFish
Repository นี้มีระบบหลัก 3 ส่วน ได้แก่ Frontend, Backend Collector และ Supabase

## ภาพรวมระบบ

```text
                               อ่านข้อมูลสด/ย้อนหลัง
ผู้ชมและสมาชิก ───────────────→ Vercel Frontend ───────────────→ Supabase
                                      │                            ↑
                                      │ คำสั่ง Admin               │ บันทึกข้อมูล
                                      │ (Browser ต้องต่อ Tailscale) │
                                      ↓                            │
                             Tailscale Serve HTTPS                 │
                                      ↓                            │
                              ai-brain FastAPI ────────────────────┘
                                      │
                                      ├─ SailFish REST
                                      └─ SailFish WebSocket
```

- Frontend อ่านข้อมูลจาก Supabase โดยตรง
- คำสั่งควบคุมถูกส่งจาก Browser ของ Admin ไป `ai-brain` ผ่าน Tailscale
- Vercel Server ไม่ได้เชื่อมเข้า private network และไม่ได้เรียก Backend แทน Browser
- Backend ติดต่อ SailFish และ Supabase แบบขาออก และไม่เปิดพอร์ตสู่อินเทอร์เน็ต
- หน้า `/public` อ่านเฉพาะข้อมูลที่อนุญาตผ่าน Supabase RPC และไม่แสดงพิกัดเรือ

## ส่วนไหนใช้งานอยู่

| ตำแหน่ง | สถานะ | หน้าที่ |
|---|---|---|
| `frontend/` | ใช้งานหลัก | Next.js + TypeScript Dashboard สำหรับ Vercel |
| `backend/` | ใช้งานหลัก | FastAPI Collector และตัวนำเข้าข้อมูลย้อนหลังบน `ai-brain` |
| `supabase/` | ใช้งานหลัก | PostgreSQL schema, RLS, RPC สาธารณะ และ Cron cleanup |
| `sailfish-inspector-extension/` | เครื่องมือวิเคราะห์ | Chrome/Edge Extension สำหรับจับ REST/WebSocket และค้นหา protocol |
| `tools/sailfish-network-inspector.user.js` | เครื่องมือสำรอง | Userscript สำหรับจับ network จาก DevTools/หน้า SailFish |
| `tools/USERSCRIPT-IPHONE.md` | เอกสารเครื่องมือ | วิธีใช้ Userscript บนอุปกรณ์ที่รองรับ |
| `EXAMPLE-ILCA4-RUNTIME-SCHEMA-TH.md` | เอกสารอ้างอิง | ตัวอย่างโครงสร้างข้อมูลที่จับได้ |
| `HANDOFF-SAILFISH-COLLECTOR-TH.md` | เอกสารอ้างอิง | บันทึกการส่งต่องาน Collector และ protocol |

## ส่วนไหนไม่ใช้ในระบบใหม่

| ตำแหน่ง/บริการ | สถานะ |
|---|---|
| `old-extension/` | Extension รุ่นเก่า เก็บไว้เปรียบเทียบ ไม่ใช้กับ Collector ปัจจุบัน |
| `oldgs/` | งาน Google Apps Script เดิม ไม่ใช่ส่วนของระบบใหม่ และไม่ได้ commit ใน repository |
| Google Apps Script URL เดิม | ไม่อยู่ใน data flow ใหม่ |
| Cloudflare Tunnel | ไม่ใช้เชื่อม Vercel กับ Backend |
| Tailscale Funnel | ไม่ใช้ เพราะจะเปิด Backend สู่อินเทอร์เน็ต |
| `device_cd` เป็นรหัสนักกีฬา | ไม่ใช้เป็นตัวระบุคน เพราะอุปกรณ์หนึ่งชิ้นอาจผูกกับหลายทีม |
| Raw payload บน Frontend | ไม่เปิดให้สมาชิกหรือบุคคลทั่วไปอ่าน |

Extension และ Userscript ไม่ต้องเปิดค้างไว้ในวันใช้งานจริง เมื่อ Backend decoder
รองรับข้อมูลนั้นแล้ว เครื่องมือเหล่านี้ใช้เฉพาะตอนค้นหา schema หรือแก้ protocol
ที่ SailFish เปลี่ยนแปลง

## หน้าเว็บทำอะไร

### หน้าที่ต้องเข้าสู่ระบบ

| URL | ชื่อหน้า | ผู้ใช้ | หน้าที่ |
|---|---|---|---|
| `/login` | เข้าสู่ระบบ | ทุกคน | Login ด้วย Supabase Auth |
| `/overview` | ภาพรวมการแข่งขัน | Viewer/Admin | รอบที่กำลังใช้งาน ลมล่าสุด จำนวนนักกีฬา และสถานะ Collector |
| `/live` | การแข่งขันสด | Viewer/Admin | แผนที่ ตารางลม และตารางทิศของนักกีฬา |
| `/history` | ผลการแข่งขันย้อนหลัง | Viewer/Admin | เลือกรายการ/ประเภท/รอบ, สั่งนำเข้ารายรอบหรือหลายรอบ และเล่นข้อมูลย้อนหลัง |
| `/compare` | เปรียบเทียบนักกีฬา | Viewer/Admin | เปรียบเทียบ SOG, COG, มุมเทียบลม และ VMG |
| `/control` | ควบคุมการเก็บข้อมูล | Admin | เลือกรายการ, Sync หารอบใหม่, Filter ประเภท, เปิด/ปิด Public ตามตัวกรอง และ Arm/Start/Stop/Retry รายรอบ |
| `/quality` | ตรวจสอบคุณภาพข้อมูล | Admin | ข้อมูลล่าช้า ข้อมูลขาด reconnect decoder error และอุปกรณ์ซ้ำ |
| `/settings` | ตั้งค่าระบบ | Admin | เปิดหรือปิด Public ระดับรายการ และดูสถานะประเภท/รอบ |

### หน้าสาธารณะ

| URL | การเข้าถึง | หน้าที่ |
|---|---|---|
| `/public` | ไม่ต้อง Login | ดูทุกประเภทในรายการที่ Admin เปิด Public โดยไม่มีพิกัดเรือ |

หน้า Live ทั้งแบบสมาชิกและสาธารณะมีสองตาราง:

1. ตารางลมและทิศ เลือกช่วง **เวลาจริง, 3 นาที, 5 นาที หรือ 10 นาที**
2. ตารางนักกีฬา แสดง **เลขใบเรือ, ชื่อ, COG, SOG และทิศทุ่น − COG**

ค่าทิศของนักกีฬาที่แสดงคำนวณดังนี้:

```text
ทิศทุ่น − COG = wrapTo180(wind_from_direction - COG)
```

ผลลัพธ์อยู่ระหว่าง `-180°` ถึง `180°` เพื่อแสดงด้านของแนวลม ส่วน COG
คือทิศทางการเคลื่อนที่เหนือพื้น ไม่ใช่ทิศหัวเรือ

## ลำดับการทำงานของการแข่งขัน

1. Admin เปิดหน้า **ควบคุมการเก็บข้อมูล**
2. กดค้นหารายการจาก SailFish
3. เลือกรายการแล้วกด Sync รอบการแข่งขัน
4. Backend บันทึกรอบทุกสถานะลง Supabase โดยยังไม่เริ่มเก็บข้อมูล
5. เลือก **ทุกประเภท** หรือเลือกประเภทเรือ แล้วกดปุ่ม Public ที่อยู่ข้างตัวกรอง ปุ่มนี้ควบคุมทุกประเภทที่กำลังแสดงอยู่
6. รอบสถานะ `10` แสดงเป็น **รอเริ่มการแข่งขัน**
7. เมื่อเจ้าของสนามกด Start ใน SailFish แล้ว Admin กดตรวจสถานะอีกครั้ง
8. Admin กดเตรียมเก็บในรอบที่ต้องการ; รอบสถานะ `50` จึงแสดงเป็น **กำลังแข่งขัน** และ Collector เก็บข้อมูล
9. รอบสถานะ `99` แสดงเป็น **จบการแข่งขันแล้ว** และหยุดแสดงข้อมูล Live ของรอบนั้น โดยหน้าสาธารณะรอรอบถัดไปของประเภทเดียวกัน
10. Admin ไปหน้า History เลือกรอบเดียวหรือหลายรอบที่จบแล้วและสั่งนำเข้า
11. เมื่อ import สำเร็จ รอบจึงพร้อมแสดงใน History; ระบบไม่นำเข้าอัตโนมัติหลัง Finish

Collector มีสถานะ:

```text
ยังไม่เริ่ม → เตรียมพร้อม → รอเริ่ม → กำลังเก็บ → กำลังจบ → เสร็จแล้ว/ผิดพลาด
```

เมื่อ WebSocket หลุด Collector จะ reconnect แบบ exponential backoff,
subscribe ใหม่ และใช้ unique keys ป้องกันข้อความซ้ำหลัง restart

## ข้อมูลที่เก็บ

### Metadata

- `matches` — รายการการแข่งขัน
- `race_classes` — ประเภทเรือ
- `races` — รอบการแข่งขัน
- `teams` — นักกีฬา/ทีม/เลขใบเรือ
- `devices` — อุปกรณ์
- `wind_instruments` — ทุ่นหรือเครื่องวัดลม

### ข้อมูลตามเวลา

- `athlete_readings` — SOG, COG, พิกัด และค่าที่คำนวณรายคน
- `wind_readings` — ความเร็วลม ทิศลม และตำแหน่งทุ่น
- `race_events` — เหตุการณ์ Start/Finish และเหตุการณ์ควบคุม

### สถานะล่าสุด

- `live_athlete_state` — ค่าล่าสุดของนักกีฬาแต่ละคน
- `live_wind_state` — ค่าล่าสุดของลม
- `collector_status` — สถานะ Collector
- `collector_runs` — ประวัติการรัน Collector
- `history_imports` — งานนำเข้าข้อมูลย้อนหลัง

### ตรวจสอบและวินิจฉัย

- `raw_messages` — payload ต้นฉบับ เก็บ 30 วัน
- `data_quality_events` — ปัญหาคุณภาพข้อมูล
- `audit_logs` — การสั่งงานและการเข้าถึงที่ต้องตรวจสอบ

Unique key ของนักกีฬาคือ `race_cd + team_cd + captured_at_ms` และของลมคือ
`race_cd + wind_instrument_cd + captured_at_ms`

## การเชื่อมต่อและความปลอดภัย

### Supabase

- ใช้ PostgreSQL, Auth และ Realtime
- เปิด RLS ทุกตาราง
- `viewer` อ่าน normalized data ตามสิทธิ์
- `admin` ควบคุมระบบ ตั้งค่าการเผยแพร่ ตรวจ diagnostics และ export
- Backend ใช้ service-role key เพื่อเขียนข้อมูล
- Frontend ใช้เฉพาะ publishable/anon key
- หน้า Public ใช้ Security Definer RPC ที่คืนข้อมูลแบบตัดพิกัดและข้อมูลลับแล้ว

### Tailscale

- ใช้เฉพาะเส้นทางควบคุม Backend
- Browser ของ Admin ต้องอยู่ใน Tailnet
- Tailscale Serve proxy HTTPS ไป `127.0.0.1:8000`
- URL ของ Backend ถูกใส่ใน `NEXT_PUBLIC_CONTROL_API_URL`
- ไม่ใช้ Funnel

### Secrets

ห้าม commit:

- `.env` และ `.env.local`
- SailFish username/password/live token
- Supabase service-role key
- JWT secret
- token encryption key
- Authorization, Cookie หรือ session token

ปัจจุบัน SailFish access/refresh token อยู่ในหน่วยความจำของ process และยังไม่ได้เขียน
ลง disk ส่วน `TOKEN_ENCRYPTION_KEY` และ volume `sailfish_tokens` เตรียมไว้สำหรับ
การเก็บ token แบบเข้ารหัสในอนาคต แต่โค้ดปัจจุบันยังไม่ได้ใช้จริง ระบบไม่ log
request body หรือ Authorization header; explicit log-redaction middleware ยังเป็นงานที่ต้องเพิ่ม

## Backend API

ทุก endpoint ยกเว้น `/health` ต้องส่ง Supabase Bearer JWT ของผู้ใช้ role `admin`
และอุปกรณ์ต้องเชื่อม Tailscale

| Method | Endpoint | หน้าที่ |
|---|---|---|
| GET | `/health` | ตรวจว่า Backend ทำงาน |
| GET | `/races/discover` | ค้นหารายการแข่งขันจาก SailFish |
| POST | `/races/sync` | Sync metadata ของทุกรอบโดยไม่เริ่ม Collector |
| GET | `/collectors` | ดู Collector ทั้งหมดในหน่วยความจำ |
| GET | `/collectors/{raceCd}` | ดู Collector ของรอบ |
| POST | `/collectors/{raceCd}/arm` | เตรียมเก็บข้อมูล |
| POST | `/collectors/{raceCd}/start-override` | เริ่มด้วยตนเองพร้อมเหตุผล |
| POST | `/collectors/{raceCd}/stop` | หยุดด้วยตนเองพร้อมเหตุผล |
| POST | `/collectors/{raceCd}/retry` | หยุดและเริ่ม Collector ใหม่ |
| GET | `/history-imports` | ดูงานนำเข้าประวัติ |
| GET | `/history-imports/{raceCd}` | ดูงานนำเข้าของรอบ |
| POST | `/history-imports/{raceCd}/retry` | นำเข้าประวัติทันที |
| POST | `/history-imports/batch` | นำเข้าหลายรอบตามคิว |
| POST | `/matches/{matchCd}/visibility` | เปิดหรือปิด Public ทั้งรายการ |
| POST | `/matches/{matchCd}/public-scope` | เปิดหรือปิด Public ทุกประเภทหรือเฉพาะประเภทตามตัวกรอง |
| POST | `/race-classes/{levelCd}/visibility` | API เดิมเพื่อ compatibility; UI ใหม่ไม่ใช้ |
| GET | `/diagnostics/{raceCd}` | ดูข้อมูลวินิจฉัย |

## Supabase migrations

ให้รันตามลำดับ:

1. `supabase/migrations/202607280001_initial_schema.sql`
   - ตารางหลัก, trigger, RLS และ policy
2. `supabase/migrations/202607280002_public_history.sql`
   - `history_imports` และ RPC สำหรับหน้าสาธารณะ/History
3. `supabase/migrations/202607290001_public_wind_history.sql`
   - RPC ตารางลมสาธารณะช่วงเวลาจริง/3/5/10 นาที
4. `supabase/migrations/202607290002_match_control_and_public.sql`
   - การเลือกเก็บรายรอบ, Public ระดับรายการ และกติกาหยุด Live หลัง Finish
5. `supabase/migrations/202607290003_contextual_public_visibility.sql`
   - เปิด Public ตามประเภทที่เลือก และใช้รอบที่จบเป็นสถานะรอรอบถัดไปโดยไม่ส่งข้อมูล Live
6. `supabase/cleanup.sql`
   - pg_cron ลบ raw payload ที่หมดอายุ

Supabase ต้องเปิด extension `pg_cron` ก่อนรัน cleanup

## Environment variables

### Backend: `backend/.env`

เริ่มจาก `backend/.env.example`

| ตัวแปร | ใช้ทำอะไร |
|---|---|
| `ENVIRONMENT` | ชื่อ environment |
| `LOG_LEVEL` | ระดับ log |
| `CORS_ORIGINS` | Vercel production/preview domains ที่อนุญาต |
| `SUPABASE_URL` | URL ของ Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | เขียนฐานข้อมูลและตรวจ role ใช้เฉพาะ Backend |
| `SUPABASE_JWT_SECRET` | ตรวจ Supabase JWT |
| `SAILFISH_BASE_URL` | URL หลักของ SailFish |
| `SAILFISH_TENANT_ID` | Tenant ของบัญชี SailFish |
| `SAILFISH_USERNAME` | ชื่อผู้ใช้ SailFish |
| `SAILFISH_PASSWORD` | รหัสผ่าน SailFish |
| `SAILFISH_LIVE_TOKEN` | token Live ชั่วคราวเมื่อค้นจาก response ไม่ได้ |
| `TOKEN_ENCRYPTION_KEY` | สำรองไว้สำหรับการเก็บ token แบบเข้ารหัส; โค้ดปัจจุบันยังไม่ใช้ |
| `RACE_STATUS_POLL_SECONDS` | รอบตรวจสถานะ SailFish |
| `HISTORY_IMPORT_DELAY_MINUTES` | ค่าเดิมเพื่อ compatibility; การนำเข้าใหม่รอคำสั่ง Admin |
| `HISTORY_IMPORT_RETRY_MINUTES` | เวลารอก่อนลอง import ใหม่ |
| `HISTORY_SCHEDULER_INTERVAL_SECONDS` | รอบทำงานของ scheduler |
| `RAW_RETENTION_DAYS` | จำนวนวันที่เก็บ raw payload |
| `WIND_FRESHNESS_SECONDS` | เวลาสูงสุดที่จับคู่ลมกับนักกีฬา |

### Frontend: Vercel หรือ `frontend/.env.local`

เริ่มจาก `frontend/.env.example`

| ตัวแปร | ใช้ทำอะไร |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL ของ Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable/anon key สำหรับ Browser |
| `NEXT_PUBLIC_CONTROL_API_URL` | Tailscale Serve HTTPS URL ของ `ai-brain` |
| `NEXT_PUBLIC_APP_NAME` | ชื่อแอป |

ตัวแปรที่ขึ้นต้น `NEXT_PUBLIC_` ถูกส่งไป Browser ห้ามใส่ service-role key,
SailFish password หรือ secret ใด ๆ

## ติดตั้ง Backend บน ai-brain

```bash
git clone https://github.com/kankrittapon/yrattracksf.git
cd yrattracksf/backend
cp .env.example .env
# ใส่ค่าจริงลง .env
docker compose up -d --build
docker compose ps
docker compose logs -f sailfish-collector
curl http://127.0.0.1:8000/health
```

ตั้ง Tailscale Serve:

```bash
sudo tailscale set --operator="$USER"
tailscale serve --bg http://127.0.0.1:8000
tailscale serve status
```

Docker ใช้ `network_mode: host`, Uvicorn bind ที่ `127.0.0.1:8000`
และตั้ง `restart: unless-stopped` ส่วน Docker volume `sailfish_tokens`
ถูกประกาศเตรียมไว้ แต่โค้ดปัจจุบันยังไม่ได้เขียน token ลง volume

## ติดตั้ง Frontend บน Vercel

1. Import GitHub repository เข้า Vercel
2. ตั้ง Root Directory เป็น `frontend`
3. ใส่ Frontend environment variables
4. Deploy
5. หลังจากนั้นทุก commit ที่ push เข้า `main` จะ deploy อัตโนมัติ

พัฒนาในเครื่อง:

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

## ทดสอบ

Frontend:

```powershell
cd frontend
npm run typecheck
npm run build
```

Backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[test]"
pytest -q
```

## งานที่ยังต้องตรวจเมื่อ SailFish เปลี่ยน protocol

- ยืนยัน field mapping ของ binary `SAIL_DATA_P` และ `BUOY_DATA` ด้วย fixture จริง
- เทียบทิศลมบนหน้า SailFish ว่าเป็นทิศ “ลมพัดมาจาก” อย่างสม่ำเสมอ
- ตรวจ Start/Finish จาก `RACE_CONTROL` หาก SailFish เปลี่ยนค่า status
- ตรวจวิธี refresh Live token อัตโนมัติเมื่อ token หมดอายุ

หากข้อมูลหายหรือ decoder ไม่รู้จัก payload ให้ใช้
`sailfish-inspector-extension/` จับ log ใหม่ แล้วเพิ่ม fixture/test ก่อนแก้ decoder
Production
