# วิเคราะห์ Frontend — SailFish Dashboard (Next.js)

ขอบเขตที่ตรวจสอบ: `frontend/src/app/**`, `frontend/src/components/race-dashboard.tsx`,
`frontend/src/components/dashboard-shell.tsx`, `frontend/src/lib/**`, `frontend/src/app/globals.css`

บริบท: เป็นแดชบอร์ดติดตามการแข่งขันเรือใบสด (real-time) + หน้าควบคุมการเก็บข้อมูล + หน้าสาธารณะ
โค้ด UI เกือบทั้งหมดกระจุกอยู่ในไฟล์เดียว (`race-dashboard.tsx` ~1,350 บรรทัด) และ CSS แบบ hand-written
ไฟล์เดียว (`globals.css` ~40 บรรทัดยาวมาก ไม่มี Tailwind/design system)

> **หมายเหตุ**: รายงานนี้เป็นการวิเคราะห์เท่านั้น ไม่มีการแก้โค้ดหรือ commit ใดๆ

---

## ปัญหาที่พบ

### 1. ไม่มี Next.js error/loading boundaries ระดับ route
ไม่พบไฟล์ `error.tsx`, `not-found.tsx`, หรือ `loading.tsx` ที่ไหนใน `frontend/src/app` เลย
- หาก component ใน client-side โยน exception (เช่น response จาก Supabase ผิดรูปแบบ) ผู้ใช้จะเห็นหน้าจอขาว/error overlay ของ Next.js ทันที ไม่มี fallback UI ที่เป็นมิตร
- ไม่มีหน้า 404 ที่ออกแบบเอง — พิมพ์ URL ผิดจะเจอหน้า Next.js default
- การสลับหน้า (เช่น overview → live) ไม่มี route-level Suspense skeleton ต้องรอ client component mount + fetch เสร็จ (มี `LoadingState` ในบาง section แต่ไม่ใช่ทุกที่ ดูข้อ 2)

### 2. Loading state ไม่ครอบคลุมทุก workspace
`RaceDashboard` (section overview/live/compare/quality) มี `LoadingState` ระหว่างโหลดข้อมูลแรกเข้า
แต่ `MatchControlWorkspace`, `HistoryWorkspace`, `PublishingWorkspace` (control/history/settings)
เริ่มต้นด้วย state ว่างเปล่าแล้ว render ทันที — ทำให้ผู้ใช้เห็น empty state ("ยังไม่มีรายการ") กระพริบสั้นๆ
ก่อนข้อมูลจริงมา ซึ่งดูเหมือนระบบว่างเปล่าจริงๆ ทั้งที่กำลังโหลดอยู่ (`race-dashboard.tsx:352-380, 517-537, 703-716`)

### 3. Error message ดิบเกินไป ไม่เป็นมิตรกับผู้ใช้
เกือบทุก catch block แสดง `${String(error)}` ตรงๆ ปนกับข้อความภาษาไทย เช่น
```
setNotice(`เชื่อมต่อไม่ได้ — กรุณาเชื่อม Tailscale (${String(error)})`);
```
ข้อความจาก fetch/Supabase (มักเป็นภาษาอังกฤษ, เช่น `TypeError: Failed to fetch` หรือ Postgres error code)
จะโผล่มาปนในประโยคไทย ดูไม่เป็นมืออาชีพและผู้ใช้ทั่วไปอ่านไม่รู้เรื่อง
(พบใน `control`, `importHistoryNow`, `discoverMatches`, `syncMatch`, `roundAction`,
`togglePublicScope`, `importRaces`, `toggleHistoryPublic`, `saveVisibility` เป็นต้น)

### 4. ปุ่มควบคุมข้อมูลจริง (arm/start/stop) ไม่ล็อกระหว่างส่งคำขอ
ใน component `Control` (ใช้ในบาง flow ของ control) ปุ่ม arm/start-override/retry/stop
ไม่มีการ disable ระหว่างรอ response — ผู้ใช้กดซ้ำได้ระหว่างรอเครือข่าย Tailscale ตอบกลับ
เสี่ยงยิงคำสั่งซ้ำไปยัง collector จริง (ต่างจาก `MatchControlWorkspace.roundAction` ที่มี
`disabled={busy === race.race_cd}` ถูกต้องแล้ว — จุดนี้ implement ไม่สอดคล้องกันระหว่างสอง component)

### 5. หน้า "เปรียบเทียบนักกีฬา" ไม่มีกลไกเลือกนักกีฬาจริง
`Compare` component (`race-dashboard.tsx:1050-1070`) ทำแค่ `athletes.slice(0, 4)` —
หยิบ 4 คนแรกตามลำดับข้อมูลที่ query กลับมาโดยอัตโนมัติ ไม่มี UI ให้ผู้ใช้เลือกว่าจะเปรียบเทียบใครกับใคร
ทั้งที่ชื่อฟีเจอร์และ label หน้าคือ "เปรียบเทียบนักกีฬา" — ฟังก์ชันหลักของหน้านี้ยังไม่สมบูรณ์

### 6. ช่องควบคุมการเก็บข้อมูล (`/control`) ไม่มีการกันสิทธิ์ในฝั่ง UI
เมนู sidebar ซ่อนลิงก์ control/quality/settings จาก role ที่ไม่ใช่ admin ก็จริง แต่หน้า `/control`
เข้าถึงได้ตรงๆ ผ่าน URL และปุ่ม arm/start-override/retry/stop ใน `MatchControlWorkspace`
**ไม่มีการเช็ก `data.role === "admin"` เลย** (ต่างจาก `HistoryWorkspace` และ `PublishingWorkspace`
ที่เช็ก role ก่อนแสดงปุ่มอย่างถูกต้อง) ผู้ใช้ role "viewer" ที่ login แล้วเดา URL `/control` สามารถกด
เริ่ม/หยุดการเก็บข้อมูลจริงได้จาก UI แม้ backend ควรต้องตรวจสิทธิ์ซ้ำอีกชั้น
แต่ frontend ควรป้องกันตั้งแต่ระดับ UI ด้วยเช่นกัน (defense in depth)

### 7. ตัวหนังสือเล็กเกินไปจำนวนมาก (Accessibility)
พบ `font-size: 8px` และ `9px` กระจายอยู่หลายสิบจุดใน `globals.css` (label, metric sub-text,
table head, badge, timestamp ฯลฯ) ต่ำกว่ามาตรฐานอ่านง่ายทั่วไป (ควร ≥ 12px) มีผลกับผู้ใช้สูงอายุ/สายตาไม่ดี
และขัด WCAG ด้านความสามารถในการอ่าน

### 8. ปุ่มไอคอนล้วนไม่มี accessible name
ปุ่มควบคุม replay เช่น
```jsx
<button onClick={() => setCursor(0)}><RotateCcw/></button>
<button className="play" onClick={...}>{playing ? <Square/> : <Play/>}</button>
```
ไม่มี `aria-label` — screen reader จะอ่านแค่ "button" ไม่รู้ว่าใช้ทำอะไร
เกิดปัญหาเดียวกันในปุ่ม icon-only อื่นๆ กระจายทั่วไฟล์

### 9. ไม่มี visible focus style ที่กำหนดเอง
มีการ custom `:focus` แค่จุดเดียว (`login-card input:focus`) ปุ่ม, ลิงก์ nav, select ฯลฯ ที่เหลือ
ทั้งระบบไม่มีการรับประกันว่า focus ring จะมองเห็นชัดเจนบนพื้นหลัง navy เข้ม — ผู้ใช้ keyboard
จะกะลำบากว่ากำลัง focus อยู่ที่อะไร โดยเฉพาะหน้าที่มีปุ่มเยอะ (control, history)

### 10. Realtime subscription ยิง full reload ทุกครั้งที่มี event
```js
.on("postgres_changes", {event: "*", ...}, () => void load())
```
ทุก INSERT/UPDATE ของ `live_athlete_state`, `live_wind_state`, `collector_status` (ซึ่งระหว่างแข่งจริง
อาจมาถี่ระดับวินาที) จะเรียก `load()` ใหม่ทั้งหมด (races + teams + athletes + wind + collector +
quality + profile + import — 7 query พร้อมกัน) แทนที่จะอัปเดตเฉพาะ state ที่เปลี่ยน
ทำให้เปลืองทรัพยากรและอาจเห็น UI กระตุก/loading กระพริบระหว่างแข่งขันช่วงคนดูเยอะ

### 11. Polling ทำงานต่อเนื่องแม้ tab ไม่ได้โฟกัส
`MatchControlWorkspace` (ทุก 5 วิ), `HistoryWorkspace` (ทุก 5 วิ), `PublishingWorkspace` (ทุก 10 วิ)
และหน้า public (ทุก 2 วิ) ใช้ `setInterval` ธรรมดา ไม่เช็ก `document.visibilityState`
เปิดแท็บทิ้งไว้เบื้องหลังก็ยังยิง request ต่อเนื่อง สิ้นเปลือง bandwidth/battery โดยเฉพาะบนมือถือ

### 12. เวลาแสดงผลไม่มีวันที่กำกับ
`bangkokTime()` แสดงแค่ `HH:mm:ss` ไม่มีวันที่ ("ข้อมูลล่าสุด 14:32:10") ถ้าเป็นข้อมูลเก่าข้ามวัน
(เช่น collector ล่าสุดที่เชื่อมสำเร็จเมื่อวานนี้) ผู้ใช้จะเข้าใจผิดว่าเป็นเวลาเมื่อครู่นี้ของวันนี้

### 13. ใช้ `window.prompt()` สำหรับกรอกเหตุผลคำสั่งควบคุม
การ "เริ่มด้วยตนเอง" / "หยุด" เก็บข้อมูล ใช้ browser-native `window.prompt("กรุณาระบุเหตุผล", "")`
ซึ่งไม่ตรงกับดีไซน์ระบบที่เหลือ (custom dark theme UI), ปรับแต่ง styling ไม่ได้, ประสบการณ์ต่างกันมากในมือถือ/บราวเซอร์ต่างค่าย
และ validate เหตุผลขั้นต่ำ 3 ตัวอักษร "หลัง" popup ปิดไปแล้วเท่านั้น (ไม่มี inline validation ระหว่างพิมพ์)

### 14. ไม่มีโหมดสว่าง/high-contrast ทั้งที่ใช้งานกลางแจ้งริมน้ำ
ระบบเป็น dark theme เท่านั้นทั้งแอป โดยบริบทการใช้งานจริงคือเจ้าหน้าที่ควบคุมสนามและโค้ชอยู่ริมน้ำ/กลางแดด
บนแท็บเล็ต/มือถือ ซึ่ง dark UI คอนทราสต์ต่ำมักอ่านยากมากภายใต้แสงแดดจ้า ไม่มีทางเลือก light mode เลย

### 15. JSON ดิบโผล่ในหน้า Quality
```jsx
<small>รายละเอียดสำหรับผู้ดูแล: {JSON.stringify(item.details)}</small>
```
แสดง raw JSON string ตรงๆ ให้ admin อ่าน ไม่มีการจัดรูปแบบหรือแปลเป็นข้อความอ่านง่าย

### 16. Athlete table บน Overview ตัดที่ 7 แถวตายตัวโดยไม่มีทางดูต่อ
`athletes.slice(0, 7)` ใน `Overview` — ถ้ามีนักกีฬามากกว่า 7 คนในรอบ จะไม่มีลิงก์/ปุ่ม "ดูทั้งหมด"
ให้ไปดูคนที่เหลือจากหน้า Overview (ต้องข้ามไปหน้า Live เอง โดยไม่มี hint ชัดเจนว่ามีข้อมูลถูกซ่อนอยู่)

---

## สิ่งที่ควรปรับปรุง (เรียงตามความสำคัญ)

### สูง (กระทบการใช้งานจริง/ความปลอดภัยของข้อมูล)
1. **เพิ่ม role check ในฝั่ง UI ของ `MatchControlWorkspace`** ก่อนแสดง/อนุญาตกดปุ่ม arm/start/stop (ข้อ 6)
2. **ล็อกปุ่มควบคุมระหว่างส่งคำขอ** ให้ครบทุก flow ที่ยิง command จริงไปยัง collector (ข้อ 4)
3. **เพิ่ม `error.tsx` และ `not-found.tsx`** ระดับ root/route group เพื่อกันหน้าขาวเวลาเกิด exception (ข้อ 1)
4. **ทำ UI เลือกนักกีฬาจริงในหน้า Compare** ให้ตรงกับชื่อฟีเจอร์ (ข้อ 5)
5. **แปลง error message ให้เป็นภาษาที่ผู้ใช้เข้าใจ** ก่อนแสดง แยก technical detail ไว้ใน console/log แทน (ข้อ 3)

### กลาง (คุณภาพการใช้งาน/การเข้าถึง)
6. เพิ่ม `aria-label` ให้ปุ่ม icon-only ทั้งหมด (ข้อ 8)
7. เพิ่ม visible focus style ที่มองเห็นชัดบนพื้นหลังเข้ม (ข้อ 9)
8. ปรับ font-size ขั้นต่ำของ label/metadata text จาก 8-9px เป็นอย่างน้อย 11-12px (ข้อ 7)
9. เพิ่ม loading skeleton ให้ `MatchControlWorkspace`/`HistoryWorkspace`/`PublishingWorkspace` (ข้อ 2)
10. เปลี่ยน `window.prompt` เป็น modal/dialog ที่ออกแบบเอง พร้อม inline validation (ข้อ 13)
11. เพิ่มวันที่กำกับเวลาเมื่อข้อมูลอาจเก่าข้ามวัน (ข้อ 12)
12. หยุด/ลดความถี่ polling เมื่อ tab ไม่ได้โฟกัส ด้วย Page Visibility API (ข้อ 11)

### ต่ำ (พอมีเวลาค่อยทำ)
13. เปลี่ยน realtime handler ให้ patch เฉพาะ state ที่เปลี่ยน แทนการ `load()` ทั้งหมดทุกครั้ง (ข้อ 10)
14. เพิ่มปุ่ม "ดูนักกีฬาทั้งหมด" ในตาราง Overview ที่ถูกตัดที่ 7 แถว (ข้อ 16)
15. จัดรูปแบบ JSON details ในหน้า Quality ให้อ่านง่ายขึ้น (ข้อ 15)
16. พิจารณาเพิ่ม light/high-contrast theme สำหรับการใช้งานกลางแจ้ง (ข้อ 14)

---

## แนวทางแก้ไขเบื้องต้น

**1. Role check ใน MatchControlWorkspace**
ห่อปุ่ม arm/start-override/retry/stop ด้วยเงื่อนไข `data.role === "admin"` เหมือนที่ `HistoryWorkspace`
ทำไว้แล้ว และถ้า role ไม่ใช่ admin ให้แสดงข้อความอธิบายแทนปุ่ม (ไม่ใช่แค่ซ่อนเฉยๆ เพื่อบอกผู้ใช้ว่าทำไมกดไม่ได้)

**2. Lock ปุ่มระหว่างส่งคำขอ**
เพิ่ม state `busy` ใน component `Control` แบบเดียวกับที่ `MatchControlWorkspace.roundAction` ทำอยู่แล้ว
(`disabled={busy === race.race_cd}` หรือ `disabled={Boolean(busy)}`) แล้ว set/clear ใน try/finally ของ `onControl`

**3. error.tsx / not-found.tsx**
เพิ่ม `frontend/src/app/error.tsx` ("use client", รับ `error`/`reset` props) และ
`frontend/src/app/not-found.tsx` ใช้โทนสี/ฟอนต์เดียวกับระบบ (นำ `.empty-state` style เดิมมาใช้ซ้ำได้เลย)
พร้อมปุ่ม "ลองใหม่" (`reset()`) และลิงก์กลับหน้าแรก

**4. Compare — เพิ่มตัวเลือกนักกีฬา**
เพิ่ม multi-select (checkbox list หรือ dropdown 2-4 ช่อง) เหนือ `compare-grid` ให้ผู้ใช้เลือก team_cd
ที่ต้องการเทียบ เก็บใน state แล้ว filter `athletes` ตาม selection แทน `slice(0, 4)` ตรงๆ
ค่าเริ่มต้นยังใช้ 4 คนแรกได้ แต่ต้องมี UI ให้เปลี่ยนได้

**5. Error message ภาษาไทย**
สร้าง helper `mapErrorMessage(error: unknown): string` ใน `lib/format.ts` ที่ map เคสที่รู้จัก
(fetch failed, timeout, HTTP 401/403/500 ฯลฯ) เป็นประโยคไทยสั้นๆ และ fallback เป็น
"เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่" พร้อม `console.error(error)` เก็บ raw error ไว้ debug
แทนการยัด `String(error)` ใส่ UI ตรงๆ

**6. aria-label**
เพิ่ม `aria-label` ภาษาไทยสั้นๆ ให้ทุกปุ่ม icon-only (เช่น `aria-label="เล่นย้อนหลัง"`,
`aria-label="กลับไปจุดเริ่มต้น"`) โฟกัสที่ replay controls, tab toggles ในหน้า public, ปุ่ม logout

**7. Focus style**
เพิ่ม rule กลางใน `globals.css`:
```css
:focus-visible{outline:2px solid var(--mint);outline-offset:2px}
```
ใช้ `:focus-visible` แทน `:focus` ตรงๆ เพื่อไม่ให้ขึ้น outline ตอนคลิกด้วยเมาส์

**8. Font size ขั้นต่ำ**
ไล่แทนที่ `font-size:8px` และ `font-size:9px` ด้วยตัวแปร CSS ใหม่ เช่น
`--fs-micro:11px` (ใช้แทน 8-9px เดิม) ทำทีละกลุ่ม (metric label, table head, badge) แล้วเช็กว่า layout
ที่พึ่งความสูงคงที่ (เช่น `.topbar{height:58px}`) ไม่บวมจนล้น

**9. Loading skeleton ให้ workspace ที่เหลือ**
เพิ่ม state `loading` เริ่มต้น `true` ใน `MatchControlWorkspace`/`HistoryWorkspace`/`PublishingWorkspace`
เหมือน `RaceDashboard` แล้ว set `false` หลัง `reload()` ครั้งแรกเสร็จ ใช้ `LoadingState` component เดิมที่มีอยู่แล้วซ้ำได้เลย

**10. แทนที่ window.prompt ด้วย dialog เอง**
สร้าง component `ReasonDialog` (controlled modal เล็กๆ ใช้ CSS ที่มีอยู่แล้วปรับ) รับ `onConfirm(reason)`
validate ความยาวขั้นต่ำแบบ real-time ในช่อง input ก่อนกดยืนยัน แทนการเช็กหลัง prompt ปิด

**11. เวลา + วันที่**
เพิ่มฟังก์ชัน `bangkokDateTime()` ใน `lib/format.ts` ที่ใส่วันที่ด้วยเมื่อ diff จากวันนี้ ≥ 1 วัน
ใช้แทน `bangkokTime()` ในจุดที่ค่าอาจเก่าข้ามวันได้ (last_message_at, scheduled_for, created_at ของ quality event)

**12. Page Visibility API**
ห่อ `setInterval` ทั้งหมดด้วยเงื่อนไขเช็ก `document.visibilityState === "visible"` หรือ pause/resume
interval ผ่าน `visibilitychange` event listener — ลด request เวลาผู้ใช้สลับแท็บ/พับหน้าจอ
