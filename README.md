# SailFish Race Intelligence

ระบบเก็บและวิเคราะห์ข้อมูลการแข่งขันเรือใบ ประกอบด้วย:

- `frontend/` — Next.js Dashboard สำหรับ Vercel
- `backend/` — FastAPI Collector สำหรับ `ai-brain`
- `supabase/` — PostgreSQL schema, RLS, Realtime และ raw-retention cleanup
- `sailfish-inspector-extension/` — Chrome/Edge diagnostic extension

## Data flow

```text
SailFish REST/WebSocket → ai-brain Collector → Supabase
                                                ↑
Vercel Dashboard ────────────────────────────────┘
        └── Admin control → Tailscale Serve → ai-brain
```

Backend ไม่มี public ingress และไม่ใช้ Cloudflare Tunnel หน้าเว็บอ่าน normalized
telemetry จาก Supabase ด้วย RLS ส่วนเมนูควบคุมเรียก Tailscale HTTPS จาก browser
ของ Admin โดยตรง

## เริ่มติดตั้ง

1. สร้าง Supabase project แล้วรัน
   `supabase/migrations/202607280001_initial_schema.sql`
2. เปิด Cron integration แล้วรัน `supabase/cleanup.sql`
3. สร้าง user ผ่าน Supabase Auth และกำหนด `profiles.role='admin'`
4. ตั้งค่าและ deploy `backend/` บน `ai-brain`
5. ตั้งค่า Tailscale Serve ให้ reverse proxy ไป `127.0.0.1:8000`
6. ตั้งค่าและ deploy `frontend/` บน Vercel

รายละเอียดอยู่ใน README ของแต่ละส่วน

## Security invariants

- ห้าม commit `.env`, SailFish credentials, access token หรือ service-role key
- Supabase service-role key อยู่บน `ai-brain` เท่านั้น
- Frontend ใช้เฉพาะ anon key ซึ่งปลอดภัยเมื่อเปิด RLS ครบ
- Control API ตรวจ Supabase JWT และ role จาก `profiles`
- Raw WebSocket payload ไม่เปิด policy ให้ authenticated users
- พิกัดนักกีฬาอยู่หลัง Login และใช้สำหรับสมาชิกที่ได้รับอนุญาตเท่านั้น

## ข้อจำกัดที่ยังต้องยืนยันจากการแข่งขันจริง

- `status=10` ยังไม่ถูกตีความว่า Start จนกว่าจะจับ `RACE_CONTROL`
- Live binary frame เก็บ raw และระบุ entity ID ได้แล้ว แต่ field mapping เต็มของ
  `SAIL_DATA_P`/`BUOY_DATA` ต้องยืนยันด้วย fixture เพิ่ม
- Wind direction ต้องเทียบกับหน้าจอ SailFish เพื่อยืนยันว่าเป็น `from` หรือ `to`

ระบบออกแบบให้ Arm และเก็บ raw ช่วง `pre_start` ได้ทันที จึงไม่ทำข้อมูลต้นฉบับหาย
ระหว่างที่ decoder กำลังพัฒนา
