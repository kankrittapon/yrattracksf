# ตัวอย่างประเภทการแข่งขัน: ILCA4

เอกสารนี้บันทึกจากข้อมูลจริงที่ถอดได้ด้วย SailFish Network Inspector 1.2.0 เพื่อใช้เป็นตัวอย่างในการพัฒนา SailFish Collector

## ข้อมูลรายการและรอบ

```text
ชื่อรายการ: Training ILCA4
ประเภท: ILCA4
รอบ: R1
matchCd: da09162cbefb4022bda3eb09ebb9770c
levelCd: fa7d92205a854376b83c6c67db159d12
raceCd: 400cfbe4364b4d35a633ebe460c423c1
สถานะ: 99 (จบการแข่งขัน)
startTime: 1784961540000
endTime: 1784963889000
```

API สำหรับดึง Snapshot ย้อนหลัง:

```http
GET https://www.saill.cn/sf-admin/api/app-api/match/race/replay2/getRaceDatas
    ?raceCd=400cfbe4364b4d35a633ebe460c423c1
    &time=<unix-milliseconds>
```

Response:

```json
{
  "result": "<LZ-String Base64>",
  "success": true,
  "flag": true
}
```

ขั้นตอนถอด:

```text
result
  → LZ-String decompressFromBase64
  → JSON.parse
  → decodedResult
```

ข้อมูลที่ถอดในตัวอย่างนี้:

```text
Compressed: 8,807 characters
Decoded: 16,264 characters
Parsed JSON: true
จำนวนทีม/นักกีฬา: 13
จำนวนเครื่องวัดลม: 1
```

## Runtime Array ของนักกีฬา

ข้อมูลแต่ละทีมอยู่ใน `decodedResult.teamList` และมี metadata ที่อ่านชื่อได้โดยตรง:

- `teamCd`
- `teamName`
- `sailNo`
- `deviceCd`
- `nationality`
- `teamArea`
- `raceCd`
- `matchCd`
- `levelCd`
- `raceTeamColor`

ข้อมูลตำแหน่งและความเร็วอยู่ใน `runtime` แบบ positional array

| Index | ความหมาย | ตัวอย่าง |
|---:|---|---|
| `0` | Race ID | `400cfbe...` |
| `3` | Team ID | `0f1d12...` |
| `4` | Object type | `B` |
| `6` | Device ID | `E1582` |
| `10` | SOG หน่วย knots | `2.16048` |
| `11` | ค่าวิเคราะห์ความเร็ว/VMG เบื้องต้น | `1.6` |
| `16` | COG หน่วยองศา | `262.4` |
| `17` | Latitude | `12.6417938` |
| `18` | Longitude | `100.9132553` |
| `22` | เวลา GPS/อุปกรณ์ | `1784963889000` |
| `23` | เวลาที่ระบบรับข้อมูล | `1784963884473` |

> Index `10`, `16`, `17`, `18`, `22` มีความมั่นใจสูงจากการเทียบค่าหลายทีม ส่วน index อื่นควรตรวจเพิ่มกับข้อมูล Live และโค้ดของหน้า Track

## ตัวอย่างข้อมูลนักกีฬาที่ Normalize แล้ว

```json
{
  "raceCd": "400cfbe4364b4d35a633ebe460c423c1",
  "teamCd": "0f1d12a8485e4cc48772cf66afc1c5c0",
  "teamName": "ICE",
  "sailNo": "1",
  "deviceCd": "E1582",
  "nationality": "TH",
  "sogKnots": 2.16048,
  "cogDegree": 262.4,
  "latitude": 12.6417938,
  "longitude": 100.9132553,
  "capturedAt": 1784963889000,
  "receivedAt": 1784963884473
}
```

## รายชื่อนักกีฬา/เรือใน Snapshot ตัวอย่าง

| ชื่อ | Sail No. | Device ID |
|---|---|---|
| ICE | `1` | `E1582` |
| GIGI | `2` | `E1581` |
| พอตเตอร์ | `3` | `E1583` |
| แป๋ม | `ภ` | `E1584` |
| เอิก | `ถ` | `E1585` |
| ปิ่น | `6` | `E1588` |
| พังงา | `7` | `E1587` |
| ริว | `11` | `E1591` |
| อิคคิว | `77` | `E1592` |
| พลอย | `1111` | `E1593` |
| สอ.๑ | `677` | `E1594` |
| สอ.๒ | `ภถ` | `E1586` |
| Boing | `213123` | `E1594` |

พบว่า `E1594` ถูกผูกกับทั้ง `สอ.๑` และ `Boing` ใน Snapshot เดียวกัน ห้ามใช้ `deviceCd` เพียงตัวเดียวเป็น Primary Key ของนักกีฬา

Unique key ที่แนะนำสำหรับข้อมูลตำแหน่ง:

```text
raceCd + teamCd + capturedAt
```

## Runtime Array ของเครื่องวัดลม

เครื่องวัดลมอยู่ใน `decodedResult.windInstrumentList`

ข้อมูลตัวอย่าง:

```text
windInstrumentCd: 6fc69b45f54d4f7ca924a1c1f4597dc1
windInstrumentName: kj
deviceCd: F1039
rollType: main
```

| Index | ความหมาย | ค่า |
|---:|---|---:|
| `0` | Race ID | `400cfbe...` |
| `3` | Wind instrument ID | `6fc69b...` |
| `4` | Object type | `WD` |
| `6` | Device ID | `F1039` |
| `10` | ความเร็วลม knots | `3.5414147` |
| `16` | ทิศทางลมองศา | `195.90419` |
| `17` | Latitude | `12.66077` |
| `18` | Longitude | `100.911585` |
| `22` | เวลาอุปกรณ์ | `1784963889000` |
| `23` | เวลาที่ระบบรับข้อมูล | `1784963884504` |

## ตัวอย่างข้อมูลลมที่ Normalize แล้ว

```json
{
  "raceCd": "400cfbe4364b4d35a633ebe460c423c1",
  "windInstrumentCd": "6fc69b45f54d4f7ca924a1c1f4597dc1",
  "windInstrumentName": "kj",
  "deviceCd": "F1039",
  "speedKnots": 3.5414147,
  "directionDegree": 195.90419,
  "latitude": 12.66077,
  "longitude": 100.911585,
  "capturedAt": 1784963889000,
  "receivedAt": 1784963884504
}
```

Unique key ที่แนะนำ:

```text
raceCd + windInstrumentCd + capturedAt
```

## Navigation Marks

ข้อมูลทุ่นสนามอยู่ใน `decodedResult.navigationMark`

ประเภทที่พบ:

- `SW` — Start Windward/จุดหนึ่งของเส้น Start
- `SD` — Start/Finish/Mark อีกด้าน
- `FW` — Finish Windward/จุดหนึ่งของเส้น Finish

ตำแหน่งที่พบ:

- `startA`
- `startB`
- `finishA`
- `finishB`
- `point`

Navigation mark ใช้รูปแบบ `runtime` เดียวกัน โดยพิกัดอยู่ที่ index `17` และ `18`

## วิธีดึงข้อมูลย้อนหลัง

ระยะการแข่งขัน:

```text
1784961540000 → 1784963889000
รวมประมาณ 2,349 วินาที หรือ 39 นาที
```

แนวทาง:

```text
เริ่มที่ startTime
  → เรียก replay2/getRaceDatas
  → เพิ่ม time ทีละ 5 วินาที
  → ทำซ้ำจนถึง endTime
```

จำนวนโดยประมาณ:

```text
2,349 ÷ 5 ≈ 470 snapshots
470 × 13 ทีม ≈ 6,110 athlete readings
470 × 1 เครื่อง ≈ 470 wind readings
```

ก่อนใช้งานจริงต้องทดสอบว่า API คืน Snapshot ตาม `time` ทุกจุดหรือมีการ clamp/cache และควรกำหนด concurrency/rate limit เพื่อไม่สร้างภาระกับ SailFish

## Live กับ Replay

### Live

```http
GET /sf-admin/api/app-api/match/race/live2/getRaceDatas
```

จากนั้นรับข้อมูลต่อผ่าน WebSocket:

```text
wss://www.saill.cn/sailfish-ntwss?token=<LIVE_TOKEN>
```

Topics:

```text
/topic/SAIL_DATA_P_<raceCd>
/topic/BUOY_DATA_<raceCd>
/topic/RACE_CONTROL_<raceCd>
```

### Replay

```http
GET /sf-admin/api/app-api/match/race/replay2/getRaceDatas
```

ใช้ parameter `time` เพื่อขอ Snapshot ย้อนหลัง

## Mapping สำหรับ Backend

ตัวอย่าง Python:

```python
def normalize_team(team: dict) -> dict:
    runtime = team["runtime"]
    return {
        "race_cd": team["raceCd"],
        "team_cd": team["teamCd"],
        "team_name": team.get("teamName"),
        "sail_no": team.get("sailNo"),
        "device_cd": team.get("deviceCd"),
        "nationality": team.get("nationality"),
        "sog_knots": float(runtime[10]) if runtime[10] != "" else None,
        "cog_degree": float(runtime[16]) if runtime[16] != "" else None,
        "latitude": float(runtime[17]) if runtime[17] != "" else None,
        "longitude": float(runtime[18]) if runtime[18] != "" else None,
        "captured_at_ms": int(runtime[22]) if runtime[22] != "" else None,
        "received_at_ms": int(runtime[23]) if runtime[23] != "" else None,
    }
```

```python
def normalize_wind(instrument: dict) -> dict:
    runtime = instrument["runtime"]
    return {
        "race_cd": instrument["raceCd"],
        "wind_instrument_cd": instrument["windInstrumentCd"],
        "wind_instrument_name": instrument.get("windInstrumentName"),
        "device_cd": instrument.get("deviceCd"),
        "speed_knots": float(runtime[10]) if runtime[10] != "" else None,
        "direction_degree": float(runtime[16]) if runtime[16] != "" else None,
        "latitude": float(runtime[17]) if runtime[17] != "" else None,
        "longitude": float(runtime[18]) if runtime[18] != "" else None,
        "captured_at_ms": int(runtime[22]) if runtime[22] != "" else None,
        "received_at_ms": int(runtime[23]) if runtime[23] != "" else None,
    }
```

