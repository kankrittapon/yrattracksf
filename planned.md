# แผนปรับระบบ SailFish Live Token และการเก็บข้อมูลสด

อัปเดตล่าสุด: 2026-07-29

## เป้าหมาย

ปรับ Backend บน `ai-brain` ให้เชื่อม SailFish WebSocket และต่ออายุ
`SAILFISH_LIVE_TOKEN` ได้อัตโนมัติ โดยผู้ดูแลไม่ต้องแก้ `.env`
และ Restart Docker ทุกครั้งที่ token เปลี่ยนหรือหมดอายุ

ผลลัพธ์ที่ต้องการ:

- Backend Login SailFish และขอ Live token เอง
- Collector ที่กดเตรียมข้อมูลสามารถเชื่อม WebSocket ตั้งแต่ก่อน Start
- เมื่อ token หมดอายุ ระบบขอ token ใหม่และเชื่อมต่อกลับเอง
- การแข่งขันหลายประเภทใช้ token provider ร่วมกันโดยไม่ Login ซ้ำพร้อมกัน
- ไม่ส่ง token ไป Frontend, Supabase, log หรือ GitHub
- หาก WebSocket ใช้งานไม่ได้ ระบบมี Snapshot fallback เพื่อลดโอกาสข้อมูลหาย
- Admin เห็นสถานะความพร้อมและสาเหตุที่เชื่อมต่อไม่ได้โดยไม่เห็นค่า token

## สถานะปัจจุบัน

- SailFish REST Login ด้วย username/password ทำงานแล้ว
- Backend อ่านสถานะการแข่งขัน `10`, `50` และ `99` ได้
- ตัวตรวจ Track/GPS จาก Snapshot ทำงานก่อนเริ่มการแข่งขัน
- Collector ทั้ง 5 ประเภทสามารถเข้าสถานะ `waiting_for_start`
- WebSocket ยังเชื่อมต่อไม่ได้เมื่อ `SAILFISH_LIVE_TOKEN` ว่าง
- `getRace` ปัจจุบันไม่ส่ง Live token กลับมา
- ระบบพยายาม reconnect แต่ยังไม่มีขั้นตอนขอ token ใหม่
- Status polling ล้าง `last_error` เร็วเกินไป ทำให้หน้า Admin ไม่เห็นสาเหตุ
- `.env` รองรับ token แบบกำหนดเอง แต่เป็นเพียงวิธีชั่วคราว

## ขอบเขตข้อมูลที่ต้องค้นหาก่อน

### 1. จับขั้นตอนสร้าง WebSocket ของ SailFish

ใช้ Chrome DevTools หรือ Inspector รุ่นที่ไม่บันทึก secret ลง log:

1. Login หน้า SailFish
2. เปิดหน้าติดตามการแข่งขัน
3. เปิด Network และเลือก `WS`
4. บันทึก Request URL ของ `sailfish-ntwss`
5. ตรวจ request ที่เกิดก่อน WebSocket เพื่อหา endpoint ออก token
6. ตรวจว่า token มาจาก response, JavaScript state, cookie หรือ access token
7. บันทึกเฉพาะชื่อ endpoint, method, header และ schema โดย redact ค่าจริง

สิ่งที่ต้องยืนยัน:

- Live token เป็น JWT หรือ opaque token
- มี `exp` หรืออายุใช้งานเท่าใด
- token ผูกกับ user, tenant, match, race หรือ browser session หรือไม่
- token เดียวใช้พร้อมกันหลายรอบได้หรือไม่
- token เปลี่ยนหลัง Login ใหม่หรือ Refresh หน้าหรือไม่
- WebSocket ปิดด้วย status/code ใดเมื่อ token หมดอายุ

### 2. ลำดับวิธีค้นหา token

ให้ใช้วิธีที่เสถียรและเบาที่สุดตามลำดับ:

1. ใช้ token จาก REST Login response หาก SailFish ใช้ token เดียวกัน
2. เรียก endpoint สำหรับออก WebSocket token โดยตรง
3. อ่าน token จาก metadata endpoint ที่หน้า Live เรียก
4. จำลองขั้นตอน JavaScript ที่สร้าง token หากเป็นอัลกอริทึมฝั่ง client
5. ใช้ headless browser บน `ai-brain` เป็น fallback สุดท้ายเท่านั้น

ไม่ควรใช้การคัดลอก token ด้วยมือเป็นวิธี Production หลัก

## การออกแบบ Backend

### 3. สร้าง `LiveTokenProvider`

เพิ่ม component กลางใน Backend เช่น:

```text
LiveTokenProvider
  ├─ get_valid_token()
  ├─ refresh_token()
  ├─ invalidate(reason)
  ├─ expires_at
  └─ diagnostics()
```

หน้าที่:

- เก็บ token ใน memory เท่านั้น
- ตรวจอายุ token ก่อนคืนค่า
- Refresh ล่วงหน้าก่อนหมดอายุประมาณ 60 วินาที
- ใช้ `asyncio.Lock` ป้องกัน Collector หลายตัว Login/Refresh พร้อมกัน
- Cache token ให้ทุกการแข่งขันใช้ร่วมกันเมื่อ protocol อนุญาต
- แยก SailFish access token ออกจาก WebSocket token ชัดเจน
- ไม่คืนค่า token ใน diagnostics หรือ exception

### 4. ปรับ `SailfishClient`

- แยก `login()` สำหรับ REST access token
- เพิ่ม `get_live_token()` ตาม protocol ที่ค้นพบ
- เพิ่มการ refresh REST session เมื่อได้ HTTP `401`
- เพิ่มการ invalidate Live token เมื่อ WebSocket ตอบปฏิเสธ
- ให้ `websocket_url()` รับ token จาก `LiveTokenProvider`
- เก็บ `SAILFISH_LIVE_TOKEN` เป็น optional emergency fallback
- ระบุแหล่ง token เป็น `automatic`, `environment` หรือ `unavailable`
  โดยไม่บันทึกค่าจริง

### 5. ปรับวงจร Collector

ขั้นตอนใหม่:

```text
Admin กดเตรียมข้อมูล
  ↓
Collector bootstrap Snapshot และ metadata
  ↓
LiveTokenProvider ขอ token ที่ใช้ได้
  ↓
เชื่อม WebSocket และ subscribe 3 topics
  ↓
status 10 = waiting_for_start และรับ pre-start raw
  ↓
status 50 = recording และเขียน normalized readings
  ↓
token หมดอายุ/WS หลุด
  ↓
invalidate → refresh token → reconnect → resubscribe
  ↓
status 99 = finishing → completed
```

ปรับ error handling:

- แยก `last_websocket_error` ออกจาก status polling error
- ห้าม status poll ล้าง WebSocket error หากยังไม่ reconnect สำเร็จ
- บันทึก reconnect reason, close code และเวลาที่เกิด
- Reset backoff หลังเชื่อมและ subscribe สำเร็จ
- ใช้ exponential backoff พร้อม jitter
- ป้องกันข้อความซ้ำด้วย unique key เดิม

### 6. Snapshot fallback

หากขอ token หรือเชื่อม WebSocket ไม่สำเร็จระหว่างสถานะ `50`:

- Poll `getRaceDatas` ทุกประมาณ 1 วินาที
- Normalize Athlete และ Wind ด้วย decoder เดียวกัน
- เขียนลง time-series และ latest-state tables
- ใส่ source เป็น `snapshot_fallback`
- สร้าง Data Quality event ว่าอยู่ใน degraded mode
- เมื่อ WebSocket กลับมา ให้หยุด fallback และกลับสู่โหมดปกติ
- Deduplicate ด้วย `race_id + entity_id + captured_at`

Snapshot fallback ไม่ทดแทน `RACE_CONTROL` และ raw WebSocket ทั้งหมด
แต่ช่วยรักษา SOG, COG, ลม และตำแหน่งเมื่อช่องทางสดมีปัญหา

## การตั้งค่า

### 7. Environment variables

คงค่าเดิม:

```env
SAILFISH_BASE_URL=https://www.saill.cn
SAILFISH_TENANT_ID=139
SAILFISH_USERNAME=...
SAILFISH_PASSWORD=...
```

เปลี่ยนบทบาทของ:

```env
SAILFISH_LIVE_TOKEN=
```

ให้เป็น emergency fallback เท่านั้น ไม่ใช่ค่าบังคับ

เพิ่มค่าที่จำเป็นเมื่อ protocol ยืนยันแล้ว เช่น:

```env
SAILFISH_LIVE_TOKEN_REFRESH_SECONDS=60
SAILFISH_SNAPSHOT_FALLBACK_ENABLED=true
SAILFISH_SNAPSHOT_FALLBACK_SECONDS=1
```

ห้ามเพิ่ม token ลง Frontend หรือ Vercel environment

## ฐานข้อมูลและ Diagnostics

### 8. ปรับสถานะ Collector

เพิ่มหรือบันทึกข้อมูลต่อไปนี้:

- `token_source` — `automatic`, `environment`, `unavailable`
- `token_expires_at` — แสดงเวลาได้แต่ไม่แสดง token
- `websocket_last_connected_at`
- `websocket_last_disconnected_at`
- `websocket_last_error`
- `transport_mode` — `websocket` หรือ `snapshot_fallback`
- `last_token_refresh_at`

ข้อมูลเหล่านี้ให้ Admin อ่านได้เท่านั้น

### 9. หน้า Admin

หน้าการแข่งขันสดและหน้าควบคุมควรแสดง:

- REST Login: พร้อม/ไม่พร้อม
- Live token: พร้อม/ใกล้หมดอายุ/หาไม่ได้
- WebSocket: เชื่อมต่อ/กำลัง reconnect/ไม่เชื่อมต่อ
- Transport: WebSocket หรือ Snapshot fallback
- Collector: รอเริ่ม/กำลังเก็บ/จบแล้ว
- ข้อความล่าสุดและเวลาที่ได้รับ
- ปุ่ม “ลองเชื่อมต่อใหม่” สำหรับ Admin

หน้า Public ต้องไม่แสดง:

- token source
- token expiry
- WebSocket error
- เลข Track
- สถานะรายอุปกรณ์

## ความปลอดภัย

### 10. กฎการจัดการ Secret

- ห้าม log WebSocket URL เต็ม
- Redact query parameter `token`
- Redact Authorization, Cookie, access token และ refresh token
- ไม่เก็บ Live token ใน Supabase
- หากจำเป็นต้องเก็บข้าม restart ให้เข้ารหัสด้วย `TOKEN_ENCRYPTION_KEY`
- จำกัด endpoint refresh/reconnect ให้ role `admin` ผ่าน Tailscale
- Audit การกด retry หรือ refresh token โดยไม่บันทึกค่า secret
- เพิ่ม automated test ตรวจว่า log และ API response ไม่มี token

## การทดสอบ

### 11. Unit tests

- token cache ยังไม่หมดอายุ
- refresh ก่อนหมดอายุ
- token หมดอายุและ refresh สำเร็จ
- Collector หลายตัวขอ token พร้อมกันแต่ Login เพียงครั้งเดียว
- refresh ล้มเหลวแล้วใช้ environment fallback
- WebSocket `401/403` ทำให้ invalidate token
- reconnect สำเร็จแล้ว resubscribe ครบ 3 topics
- log redaction ไม่เผย token
- Snapshot fallback deduplicate ข้อมูล

### 12. Integration tests

- Login และขอ Live token จาก SailFish จริง
- เชื่อม WebSocket ขณะการแข่งขันยัง status `10`
- ยืนยัน greeting `CONNECTED`
- subscribe:
  - `SAIL_DATA_P`
  - `BUOY_DATA`
  - `RACE_CONTROL`
- เปิด Collector พร้อมกันทุกประเภท
- บังคับ token หมดอายุหรือใช้ token ผิด
- ยืนยันว่า Backend ขอ token ใหม่และกลับมาเชื่อมได้
- Restart Docker แล้วกลับมาเชื่อมได้โดยไม่แก้ `.env`
- ปิด WebSocket ชั่วคราวและตรวจ Snapshot fallback

### 13. การทดสอบหน้างาน

ก่อน Start:

- ทุกประเภทขึ้น `waiting_for_start`
- WebSocket เป็น “เชื่อมต่อแล้ว”
- จำนวนข้อความเพิ่มขึ้น
- ไม่มี secret ใน log

หลัง Start:

- สถานะเปลี่ยนเป็น `recording`
- Athlete และ Wind readings เพิ่มทุกประมาณ 1 วินาที
- หน้า Admin และ Public อัปเดตภายในประมาณ 2 วินาที
- เลือกนักกีฬาแล้วเห็น SOG, COG, ลม, มุมเทียบลม และกราฟ

หลัง Finish:

- สถานะเปลี่ยนเป็น `completed`
- หยุด Public Live
- ตั้งคิวนำเข้าย้อนหลัง
- History แสดงข้อมูลตรงกับช่วง Live

## ลำดับการดำเนินงาน

### ระยะที่ 1 — Protocol discovery (เร่งด่วน)

- จับ WebSocket handshake และ request ก่อนหน้า
- ยืนยันแหล่ง token และอายุ token
- สร้าง fixture ที่ redact secret
- สรุป protocol ในเอกสาร Backend

### ระยะที่ 2 — Automatic token provider

- เพิ่ม `LiveTokenProvider`
- เชื่อมกับ `SailfishClient`
- เพิ่ม refresh, cache, lock และ redaction
- เพิ่ม unit tests

### ระยะที่ 3 — Collector recovery

- เพิ่ม invalidate/reconnect/resubscribe
- แยก WebSocket error จาก status poll
- เพิ่ม diagnostics และ Data Quality events
- เพิ่ม Snapshot fallback

### ระยะที่ 4 — Admin UI

- แสดง token readiness โดยไม่เปิดเผย secret
- แสดง transport mode และ WebSocket error
- เพิ่มปุ่ม retry สำหรับ Admin
- ปรับข้อความให้ผู้ใช้งานทั่วไปเข้าใจง่าย

### ระยะที่ 5 — Staging และ Production

- ทดสอบกับรอบฝึกก่อน
- Arm หลายประเภทพร้อมกัน
- จำลอง token expiry และ Docker restart
- Deploy `ai-brain`
- เฝ้าดู log และ Data Quality ตลอดการแข่งขันหนึ่งรอบ

## เกณฑ์รับงาน

งานถือว่าเสร็จเมื่อ:

- ไม่ต้องกำหนด `SAILFISH_LIVE_TOKEN` ด้วยมือในการทำงานปกติ
- Backend restart แล้วขอ token และ reconnect เอง
- Collector ทุกประเภทเชื่อมก่อน Start ได้
- token หมดอายุระหว่างแข่งแล้วข้อมูลกลับมาภายใน 30 วินาที
- หาก WebSocket ล้มเหลว Snapshot fallback เก็บ SOG, COG และลมต่อได้
- ไม่มี token ปรากฏใน Frontend, Supabase, log, audit หรือ Git
- หน้าสถานะ Admin บอกสาเหตุและ transport mode ได้
- เก็บการแข่งขันครบตั้งแต่ `10 → 50 → 99`
- Public Live และ History แสดงข้อมูลตรงกับฐานข้อมูล

## ความเสี่ยงและข้อจำกัด

- หาก SailFish ไม่มี endpoint ออก token และสร้าง token ภายใน browser เท่านั้น
  อาจต้องใช้ headless browser ซึ่งเพิ่มภาระ Docker และการดูแล
- หาก token ผูกกับ race อาจต้อง cache แยกตาม `race_cd`
- หาก SailFish จำกัดจำนวน WebSocket ต่อ token ต้องจัด connection strategy ใหม่
- Snapshot fallback อาจไม่มี Race Control event และ raw binary ครบทั้งหมด
- การเปลี่ยน protocol ฝั่ง SailFish ต้องมี alert และ fixture เพื่อค้นพบเร็ว
