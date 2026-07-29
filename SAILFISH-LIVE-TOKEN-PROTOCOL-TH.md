# SailFish Live Token — ผลค้นหา Protocol (ระยะที่ 1)

อัปเดต: 2026-07-29
แหล่งข้อมูล: ไฟล์ `sailfish-extension-log-*.json` 5 ไฟล์ (บันทึกจาก
`tools/sailfish-network-inspector.user.js` ระหว่าง 2026-07-28) และ
`HANDOFF-SAILFISH-COLLECTOR-TH.md`

ข้อจำกัดของรอบนี้: งานนี้ไม่ได้ Login เข้า SailFish จริงเพิ่มเติม (ต้องกรอก
password ซึ่งเป็นการกระทำที่ต้องห้ามสำหรับ agent) จึงใช้เฉพาะ Capture
ที่มีอยู่แล้วในเครื่อง มาวิเคราะห์ซ้ำ

## สิ่งที่ยืนยันได้จาก Capture ที่มีอยู่

- ทั้ง 5 ไฟล์ log พบรูปแบบคำขอก่อนเปิด WebSocket เหมือนกันทุกครั้ง:
  1. `GET /sf-admin/api/app-api/match/race/getRace?pageName=open_trac&raceCd=...`
     (type `xhr`)
  2. `GET https://www.saill.cn/.../match/race/live2/getRaceDatas` หรือ
     `replay2/getRaceDatas` (type `fetch`)
  3. `GET https://www.saill.cn/.../match/race/getRouteInfo?raceCd=...`
     (type `fetch`)
- WebSocket handshake ที่จับได้ 2 ครั้ง (ไฟล์ `...1867742` และ
  `...2362750`) เปิดด้วย
  `GET wss://www.saill.cn/sailfish-ntwss?token=[REDACTED]` เสมอ — ตัว
  Inspector ปิดบังค่า token ไว้ตามที่ออกแบบไว้ ไม่มีค่าจริงหลงเหลือในไฟล์
- ไม่พบ endpoint แยกต่างหากสำหรับ "ขอ Live token" (เช่น
  `getWsToken`, `getLiveTicket`) ใน capture ทั้ง 5 ไฟล์ — มีแค่ 3
  endpoint ข้างต้นที่เกิดขึ้นก่อน WebSocket ทุกครั้ง
- Response ของ `getRouteInfo` และ `live2/getRaceDatas` ที่จับได้ครบ
  ไม่มี field ชื่อ token/livetoken/wstoken ปรากฏอยู่

## จุดที่ยังไม่ยืนยัน (ช่องว่างของ Capture เดิม)

- คำขอ `getRace` เป็น type `xhr` และ Inspector เดิมไม่ได้บันทึก
  `responseText` ของ request ประเภทนี้ (เห็นแต่ `null`) ในขณะที่
  `fetch` request ถูกบันทึกครบ — **นี่คือจุดที่มีความเป็นไปได้สูงสุดว่า
  token ฝังอยู่ใน response ของ `getRace`** แต่ยังพิสูจน์ไม่ได้จนกว่าจะ
  จับ body ของ XHR ได้จริง
- ยังไม่ยืนยันว่า token เป็น JWT หรือ opaque (ค่าในไฟล์ถูก redact ไว้
  ทั้งหมด จึงตรวจ `exp`/schema ไม่ได้จาก capture ที่มี)
- ยังไม่เห็นเหตุการณ์ token หมดอายุ/ถูกปฏิเสธ ใน capture ชุดนี้ จึงไม่ทราบ
  close code ที่แน่ชัด
- ยังไม่ยืนยันว่า token ผูกกับ race เดียวหรือใช้ร่วมข้ามรอบได้

## ขั้นต่อไปที่ต้องทำโดยผู้ใช้ (ต้องมี Login จริง จึงทำแทนไม่ได้)

1. แก้ `tools/sailfish-network-inspector.user.js` ให้บันทึก
   `responseText` ของ request type `xhr` ด้วย (ปัจจุบันน่าจะจับเฉพาะ
   `fetch`) แล้วเปิดหน้า
   `sf-admin/html/race/live/open_trac.html?raceCd=...` อีกครั้งเพื่อดูว่า
   `getRace` คืน field token กลับมาหรือไม่
2. หากพบ token ใน `getRace` ให้ยืนยัน field name ที่แท้จริง (ปัจจุบัน
   `SailfishClient.find_live_token` เดารายชื่อ key ไว้ล่วงหน้าเป็น
   `token`, `livetoken`, `wstoken`, `websockettoken`)
3. หากไม่พบใน `getRace` ให้ตรวจ `document.cookie`, `localStorage`,
   `sessionStorage` และ JS bundle ของหน้า Live ว่ามี token หรือฟังก์ชัน
   สร้าง token หรือไม่ (ตามลำดับวิธีค้นหาข้อ 3-4 ใน `planned.md`)
4. เปิดหน้า Live ทิ้งไว้จนกว่า token จะหมดอายุ (หรือจนกว่าจะพบรอบที่
   WebSocket หลุดเอง) แล้วบันทึก close code กับเวลาที่ผ่านไปนับจาก
   handshake เพื่อประมาณอายุ token

## ผลต่อการออกแบบ Backend (ระยะที่ 2)

เนื่องจากยังไม่ยืนยัน endpoint ที่แท้จริง โค้ดที่เพิ่มในระยะนี้
(`LiveTokenProvider`, `SailfishClient.get_live_token`) ใช้กลยุทธ์แบบ
Best-effort ตามลำดับที่ปลอดภัยที่สุดเท่าที่ยืนยันได้วันนี้:

1. เรียก `get_race()` (และ `get_admin_race()` เป็น fallback) แล้วสแกน
   หา token ด้วย `find_live_token` (วิธีที่ 3 ใน `planned.md`)
2. หากหาไม่พบ ใช้ `SAILFISH_LIVE_TOKEN` จาก environment เป็น
   emergency fallback (`token_source=environment`)
3. หากไม่มีทั้งคู่ ระบบรายงาน `token_source=unavailable` ให้ Admin เห็น
   โดยไม่ throw ค่า token หรือ URL เต็มออกไปที่ log

เมื่อพบ endpoint ที่แท้จริงจากขั้นตอนข้างต้น ให้เพิ่ม branch ใหม่ใน
`SailfishClient.get_live_token` ก่อน branch ปัจจุบัน โดยไม่ต้องแก้
`LiveTokenProvider` (ออกแบบให้ swap กลยุทธ์การค้นหาได้โดยไม่กระทบ cache/
lock/refresh loop)
