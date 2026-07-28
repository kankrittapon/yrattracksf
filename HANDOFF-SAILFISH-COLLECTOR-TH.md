# SailFish Collector — สรุปการสนทนา แนวคิด และผลการวิเคราะห์

วันที่สรุป: 28 กรกฎาคม 2026  
ผู้ใช้งานหลัก: บัญชี SailFish tenant `THA`  
เครื่อง Backend ที่เลือก: `ai-brain` (`100.68.88.63` ผ่าน Tailscale)

## 1. เป้าหมายโครงการ

สร้างระบบเก็บและแสดงข้อมูลการแข่งขันเรือใบ โดย:

- เลือกรายการแข่งขันจากบัญชี Admin ของ SailFish
- ดึงประเภทเรือและรอบภายในรายการ เช่น ILCA4, ILCA6, ILCA7 และ OPTIMIST
- เก็บค่าลมจากทุ่นลม
- เก็บ SOG/COG ของนักกีฬาแต่ละคน
- แยกข้อมูลตามรายการ ประเภทเรือ รอบ และนักกีฬา
- เปิดดูข้อมูลย้อนหลังได้
- Frontend deploy บน Vercel
- Backend/Collector ทำงานตลอดเวลาบน `ai-brain`
- ฐานข้อมูลใช้ Supabase PostgreSQL
- ไม่ใช้ Playwright หากเรียก REST API/WebSocket โดยตรงได้

## 2. สถาปัตยกรรมที่ตกลง

```text
Vercel Frontend
  - Login ผู้ดูแล
  - เลือกรายการแข่งขัน
  - เลือกประเภทและรอบ
  - เริ่ม/หยุด Collector
  - Dashboard สดและย้อนหลัง
          |
          | HTTPS + JWT
          v
Cloudflare Tunnel
          |
          v
ai-brain FastAPI Backend
  - SailFish Admin Client
  - Public Race API Client
  - WebSocket Collectors
  - Background jobs
  - Queue/retry/deduplication
          |
          v
Supabase PostgreSQL
```

ข้อกำหนดด้านความปลอดภัย:

- ห้ามใส่ SailFish password, access token, refresh token หรือ Supabase service-role key ใน Frontend
- Secrets อยู่ใน `.env` บน `ai-brain` เท่านั้น
- FastAPI ไม่เปิดพอร์ตตรงสู่อินเทอร์เน็ต ให้ผ่าน Cloudflare Tunnel
- จำกัด CORS เฉพาะ Vercel domain
- Control endpoints ต้องตรวจ JWT และสิทธิ์ Admin
- เก็บ Browser/Admin session และ token เป็นความลับ

## 3. โครงสร้างข้อมูล

```text
Match (matchCd)
  └── Class/Level (levelCd)
       └── Race (raceCd)
            ├── Athletes/Boats
            ├── Wind readings
            ├── SOG/COG readings
            └── Race control events
```

ตารางฐานข้อมูลเบื้องต้น:

### matches

- `id`
- `saill_match_cd` unique
- `name`
- `start_at`
- `end_at`
- `country`
- `city`
- `is_public`
- `synced_at`

### race_classes

- `id`
- `match_id`
- `saill_level_cd`
- `name`
- `logo_url`

### races

- `id`
- `match_id`
- `class_id`
- `saill_race_cd` unique
- `rounds`
- `group_name`
- `status`
- `wind_instrument_cd`
- `route_cd`
- `route_name`
- `started_at`
- `ended_at`

### athletes

- `id`
- `match_id`
- `class_id`
- `external_id`
- `sail_number`
- `name`
- `country`

### athlete_readings

- `id`
- `race_id`
- `athlete_id`
- `captured_at`
- `latitude`
- `longitude`
- `sog_knots`
- `cog_degree`
- unique key สำหรับป้องกันข้อมูลซ้ำ

### wind_readings

- `id`
- `race_id`
- `instrument_cd`
- `captured_at`
- `speed_knots`
- `direction_degree`
- unique key สำหรับป้องกันข้อมูลซ้ำ

### race_events

- `id`
- `race_id`
- `captured_at`
- `event_type`
- `payload` JSONB

## 4. SailFish Admin Authentication

ตรวจพบจาก Network Inspector:

### ตรวจ CAPTCHA

```http
GET /sf-admin/api/admin-api/infra/config/getCaptchaEnabled
tenant-id: 139
```

ผลในการตรวจครั้งนี้: CAPTCHA ปิดอยู่

### หา Tenant

```http
GET /sf-admin/api/admin-api/system/tenant/get-id-by-name?name=THA
```

ผล:

```json
{"data": 139}
```

### Login

```http
POST /sf-admin/api/admin-api/system/auth/login
Content-Type: application/json;charset=utf-8
tenant-id: 139
```

```json
{
  "username": "THA",
  "password": "<SECRET>"
}
```

Response มี:

- `userId`
- `accessToken`
- `refreshToken`
- `expiresTime`
- `tenantId`

ทุก Admin request ใช้:

```http
Authorization: Bearer <accessToken>
tenant-id: 139
Accept-Language: en
```

ยังต้องจับและยืนยัน endpoint สำหรับ refresh token

## 5. API รายการแข่งขันจาก Admin

ต้อง Login Admin เพื่อค้นหารายการทั้งหมด/ล่าสุดของ tenant:

```http
GET /sf-admin/api/admin-api/match/match/page
    ?orderByColumn=matchStart
    &isAsc=descending
    &pageNo=1
    &pageSize=15
```

ข้อมูลสำคัญ:

- `matchCd`
- `matchName`
- `matchStart`
- `matchEnd`
- `country`
- `city`
- `isPublic`
- `seqId`

รายการที่ใช้วิเคราะห์:

```text
matchCd: b75c199814d24f3997ab90a30679e2ee
ชื่อ: ACDC International Sailing 2026
เมือง: Sattahip
tenantId: 139
```

รายละเอียดรายการแบบ Admin:

```http
GET /sf-admin/api/admin-api/match/match/get?matchCd=<matchCd>
```

## 6. Public Match/Race APIs

เมื่อทราบ `matchCd` แล้ว API ต่อไปนี้เรียกจาก `ai-brain` ได้โดยไม่ใช้ Admin token:

```http
GET /sf-admin/api/admin-api/match/race/open/getMatch?matchCd=<matchCd>
```

```http
GET /sf-admin/api/admin-api/match/race/open/getRaceList
    ?pageSize=10000
    &pageNo=1
    &matchCd=<matchCd>
    &openFlag=1
```

ดังนั้น Admin Login จำเป็นเฉพาะการค้นหารายการในบัญชี ส่วนการดึงประเภทและรอบหลังทราบ `matchCd` แล้วใช้ Public API ได้

## 7. ประเภทและรอบที่ค้นพบ

รายการ `b75c199814d24f3997ab90a30679e2ee`:

| ประเภท | levelCd | raceCd | windInstruments |
|---|---|---|---|
| ILCA4 | `70c0d3f2ab5f40e29ed099b344633f9e` | `8986c74c9fcc48428adbce3e0911aa81` | `8fe09e46577c4b188e4896ac7e559546` |
| ILCA6 | `3166d977d291460593c4c75a9d10d378` | `c734c19750f54b99ab9b65e6eb012181` | `cb135b9b7d2b4a1a93f6c5cc34eae326` |
| ILCA7 | `58d591250b9e452bb0192412bef4b1fc` | `f16e500976c948e9b63b3a6bb8061b01` | `ae489dc4422143d49d76762ed9279fd5` |
| OPTIMIST | `9fdf612dad8b4c43a75f62ffe0fbb1ba` | `dbb9c95c6d7f47eb8e5225348f93b711` | `300c67c8dad24cc29859b12466546dfb` |
| OPTIMIST NEW | `eec87e691de44112a0ecf65e0cf5ec63` | `d6e0e31820c1465f982d648fa324acb1` | `4e45695425a9408aad60145acf1fc0f2` |

หน้าเลือกประเภท:

```text
https://www.saill.cn/sailingrule-web/training?matchCd=<matchCd>
```

หน้าข้อมูลประเภท:

```text
https://www.saill.cn/sailingrule-web/training/info?matchCd=<matchCd>&levelCd=<levelCd>
```

หน้าติดตาม:

```text
https://www.saill.cn/sf-admin/html/race/live/open_trac.html?raceCd=<raceCd>
```

## 8. Live Race APIs

ข้อมูลรายละเอียดรอบ:

```http
GET /sf-admin/api/app-api/match/race/getRace
    ?pageName=open_trac
    &raceCd=<raceCd>
```

ข้อมูลเริ่มต้น:

```http
GET /sf-admin/api/app-api/match/race/live2/getRaceDatas
    ?raceCd=<raceCd>
    &time=<unix-milliseconds>
```

Response:

```json
{
  "result": "N4Igtgpg...",
  "success": true,
  "flag": true
}
```

`result` มีลักษณะเป็นข้อมูล LZ-String แบบ Base64 ต้องทดสอบถอดด้วย `decompressFromBase64` และตรวจ schema จริง

ข้อมูลเส้นทาง:

```http
GET /sf-admin/api/app-api/match/race/getRouteInfo?raceCd=<raceCd>
```

## 9. Live WebSocket

Endpoint:

```text
wss://www.saill.cn/sailfish-ntwss?token=<LIVE_TOKEN>
```

หลังได้รับ:

```json
{"v":"CONNECTED","k":"CMD"}
```

ให้ Subscribe:

```json
{"subscribe":"/topic/SAIL_DATA_P_<raceCd>"}
```

```json
{"subscribe":"/topic/BUOY_DATA_<raceCd>"}
```

```json
{"subscribe":"/topic/RACE_CONTROL_<raceCd>"}
```

ความหมายที่คาด:

- `SAIL_DATA_P`: ตำแหน่งนักกีฬา/เรือ รวมข้อมูลที่ใช้คำนวณหรือแสดง SOG/COG
- `BUOY_DATA`: ข้อมูลทุ่นและลม
- `RACE_CONTROL`: สถานะและคำสั่งการแข่งขัน

ยังต้องเก็บตัวอย่าง message ขณะมีการแข่งขันจริงเพื่อยืนยัน schema

## 10. Collector Workflow

```text
1. Backend Login Admin
2. บันทึก access/refresh token ลง encrypted session store
3. ดึงรายการล่าสุด
4. Frontend ให้ผู้ใช้เลือก matchCd
5. Backend เรียก Public getMatch/getRaceList
6. Upsert ประเภทและรอบลง Supabase
7. สร้าง background collector แยกตาม raceCd
8. เรียก getRace/getRaceDatas เพื่อ bootstrap
9. ถอด LZ-String payload
10. เชื่อม WebSocket และ Subscribe 3 topics
11. Normalize และ batch insert ข้อมูล
12. Reconnect อัตโนมัติเมื่อ WebSocket หลุด
13. Frontendอ่านสถานะสดและประวัติจาก Backend/Supabase
```

## 11. API ของระบบเรา

```text
GET  /health
GET  /auth/status
POST /auth/login
POST /auth/refresh

GET  /matches
POST /matches/sync
GET  /matches/{matchCd}
GET  /matches/{matchCd}/races

POST /collectors/start
POST /collectors/stop
GET  /collectors/status
GET  /collectors/{raceCd}/status

GET  /history
GET  /history/{raceCd}
```

ตัวอย่างเริ่ม Collector:

```json
{
  "matchCd": "b75c199814d24f3997ab90a30679e2ee",
  "raceCds": [
    "8986c74c9fcc48428adbce3e0911aa81",
    "c734c19750f54b99ab9b65e6eb012181"
  ]
}
```

## 12. เครื่อง ai-brain

```text
Host: ai-brain
Tailscale IP: 100.68.88.63
SSH user: kanfullbuster
OS: Ubuntu 24.04.4 LTS
Docker: 29.6.1
RAM: 13 GiB
Available RAM ตอนตรวจ: ประมาณ 10 GiB
Disk: 232 GiB
Available disk ตอนตรวจ: 82 GiB
```

เครื่องมี Docker, n8n, PostgreSQL และ Cloudflare Tunnel อยู่แล้ว เหมาะกับ FastAPI/WebSocket Collector โดยไม่ต้องใช้ Chromium

## 13. Garmin API ที่ใช้เป็นต้นแบบ

ตำแหน่งบน `ai-brain`:

```text
/home/kanfullbuster/n8n-zort/garmin-api
```

รูปแบบ:

- FastAPI + Uvicorn
- Environment variables เก็บบัญชี
- Docker volume เก็บ token
- เริ่มจาก cached token
- Login ใหม่เมื่อ token หมดอายุ
- รองรับ MFA
- Restart policy `unless-stopped`
- API ทำงานเฉพาะ Docker network

SailFish จะใช้รูปแบบเดียวกัน แต่เปลี่ยนจาก `garminconnect` เป็น:

- `httpx` สำหรับ REST
- `websockets` สำหรับข้อมูลสด
- `lzstring` หรือ decoder ที่เข้ากันสำหรับ bootstrap payload

## 14. ไฟล์ที่สร้างระหว่างการวิเคราะห์

- `tools/sailfish-network-inspector.user.js`
  - Userscript สำหรับ iPhone/Safari
  - จับ fetch, XHR, WebSocket และ Resource Timing
  - ปิดบัง password, token, cookie และ authorization
- `tools/USERSCRIPT-IPHONE.md`
  - วิธีใช้งาน Inspector
- `old-extension/`
  - Extension SailFish Wind Tracker ตัวเดิมที่แตกจาก ZIP

## 15. สิ่งที่ยังต้องทำ

1. จับ WebSocket message จริงระหว่างมีข้อมูลส่งเข้ารอบแข่งขัน
2. ยืนยัน schema ของ `SAIL_DATA_P`
3. ยืนยัน schema ของ `BUOY_DATA`
4. หาแหล่งที่มาของ Live WebSocket token
5. ถอด `getRaceDatas.result`
6. หา API รายชื่อนักกีฬา/เรือและ mapping device-to-athlete
7. หา Admin refresh-token endpoint
8. ออกแบบ Supabase migrations และ RLS
9. เขียน FastAPI Collector
10. เขียน Dockerfile/Compose และเพิ่มใน `ai-brain`
11. เขียน Vercel Dashboard
12. ทดสอบ reconnect, deduplication และข้อมูลย้อนหลัง

## 16. ข้อสรุป

- ไม่ต้องใช้ Playwright สำหรับเส้นทางหลัก
- Admin Login ใช้เพื่อค้นหารายการแข่งขันล่าสุดและ Private matches
- เมื่อได้ `matchCd` แล้ว สามารถดึงประเภท/รอบผ่าน Public API
- Live data ใช้ REST bootstrap และ WebSocket
- Backend ควรอยู่บน `ai-brain`
- Frontend ควรอยู่บน Vercel
- Supabase เหมาะกับ Auth, PostgreSQL และ Dashboard data
- ห้ามส่ง SailFish credentials/token ไปยัง Frontend

