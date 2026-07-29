# สรุปการแก้ไข Frontend — SailFish Dashboard

แก้ไขตาม `FRONTEND-SUGGESTIONS.md` ครบทั้ง 16 ข้อ พร้อมตัดโค้ดที่ตายแล้วออก และปรับเมนู/navigation
ตรวจสอบด้วย `tsc --noEmit` และ `next build` ผ่านทั้งคู่ (ดูหัวข้อ "การทดสอบ" ท้ายไฟล์)

**ไม่มีการ commit ใดๆ ทั้งสิ้น** — ทุกอย่างยังอยู่ใน working tree ให้รีวิวก่อน

---

## 1) ความปลอดภัย/สิทธิ์การเข้าถึง (สูงสุด)

### ข้อ 6 — `/control` ไม่มีการกันสิทธิ์ในฝั่ง UI
`MatchControlWorkspace` (`components/race-dashboard.tsx`) ตอนนี้เช็ก `data.role === "admin"` ก่อนแสดงปุ่ม
arm/start-override/retry/stop และปุ่มเปิด/ปิดหน้าสาธารณะ ผู้ใช้ role อื่นจะเห็นข้อความอธิบายแทนปุ่ม
("เฉพาะผู้ดูแลระบบ (admin) เท่านั้นที่สั่งเริ่ม/หยุดการเก็บข้อมูลได้") ไม่ใช่แค่ซ่อนเฉยๆ
เช่นเดียวกับ `PublishingWorkspace` (หน้า "เผยแพร่สู่สาธารณะ") ที่เพิ่ม role-notice แบบเดียวกัน
(`HistoryWorkspace` เช็ก role อยู่แล้วตั้งแต่เดิม)

> หมายเหตุ: backend ควรตรวจสิทธิ์ซ้ำอีกชั้นเสมอ (ไฟล์นี้แก้เฉพาะฝั่ง frontend/UI)

### ข้อ 4 — ปุ่มควบคุมไม่ล็อกระหว่างส่งคำขอ
เพิ่ม `disabled={busy === race.race_cd}` ให้ปุ่ม start-override / retry / stop ใน `MatchControlWorkspace`
(เดิมมีแค่ปุ่ม arm ที่ disable ถูกต้อง) ป้องกันการกดซ้ำยิงคำสั่งซ้ำไปยัง collector จริงระหว่างรอ Tailscale ตอบกลับ

---

## 2) Error/Loading Boundary (สูง)

### ข้อ 1 — ไม่มี error.tsx / not-found.tsx
เพิ่ม `frontend/src/app/error.tsx` และ `frontend/src/app/not-found.tsx` ใช้โทน/สไตล์เดียวกับระบบ
(reuse `.empty-state`) พร้อมปุ่ม "ลองใหม่" (`reset()`) และ "กลับหน้าหลัก"
**ทดสอบแล้วจริง**: ปิด Supabase env แล้วเข้าหน้า `/overview` ระบบ error boundary จับ error จาก
`(dashboard)/layout.tsx` และแสดงหน้า error ที่ออกแบบเองแทนหน้าขาว/overlay ของ Next.js ได้ถูกต้อง
เช่นเดียวกับเข้า URL ที่ไม่มีจริง → เจอหน้า not-found ที่ออกแบบเอง

### ข้อ 2 — Loading state ไม่ครอบคลุมทุก workspace
`MatchControlWorkspace`, `HistoryWorkspace`, `PublishingWorkspace` เพิ่ม state `loading` เริ่มต้น `true`
และ render `<LoadingState/>` (component เดิมที่มีอยู่แล้ว) จนกว่า `reload()` ครั้งแรกจะเสร็จ
ไม่เห็น empty state กระพริบหลอกว่า "ยังไม่มีรายการ" ระหว่างรอข้อมูลจริงอีกต่อไป

---

## 3) ฟีเจอร์ที่ไม่สมบูรณ์ (สูง)

### ข้อ 5 — หน้าเปรียบเทียบนักกีฬาไม่มี UI เลือก
`Compare` component เพิ่ม panel "เลือกนักกีฬาที่จะเปรียบเทียบ" เป็น checkbox grid ให้เลือกได้สูงสุด 4 คน
(ตรงกับ layout การ์ด 2×2 เดิม) ค่าเริ่มต้นยังเป็น 4 คนแรกเหมือนเดิม แต่ผู้ใช้เปลี่ยนได้แล้ว
ถ้าเลือกครบ 4 คน checkbox ที่เหลือจะ disable ไว้จนกว่าจะถอนตัวเลือกออก

---

## 4) Error message และ UX (สูง/กลาง)

### ข้อ 3 — Error message ดิบปนภาษาอังกฤษ
เพิ่ม `mapErrorMessage(error)` ใน `lib/format.ts` — map error ที่พบบ่อย (fetch failed, timeout, 401/403/404/5xx,
รวมถึง Supabase `PostgrestError` ที่ไม่ใช่ `instanceof Error`) เป็นประโยคไทยสั้นๆ, fallback เป็น
"เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่", และ `console.error(error)` เก็บ raw error ไว้ debug เสมอ
แทนที่ `String(error)` ทุกจุดใน `race-dashboard.tsx` และ `public/page.tsx`

### ข้อ 13 — ใช้ window.prompt() สำหรับกรอกเหตุผล
สร้าง `components/reason-dialog.tsx` — modal ที่ออกแบบเองตามธีมระบบ พร้อม inline validation
(เช็กความยาวขั้นต่ำ 3 ตัวอักษรแบบ real-time ไม่ต้องรอปิด popup) ใช้แทน `window.prompt` ใน
`MatchControlWorkspace.roundAction` สำหรับ action "เริ่มด้วยตนเอง"/"หยุด" ที่ต้องระบุเหตุผล

---

## 5) Accessibility (กลาง)

### ข้อ 7 — ตัวหนังสือเล็กเกินไป
แทนที่ `font-size:8px` และ `font-size:9px` ทั้งหมด **48 จุด** ใน `globals.css` ด้วยตัวแปร
`--fs-micro: 11px` ตัวเดียว ตรวจแล้วว่า container ที่มี fixed height (เช่น `.table-head{height:34px}`,
`.direction-table-head{height:36px}`) ยังพอดี ไม่ล้น

### ข้อ 8 — ปุ่มไอคอนล้วนไม่มี accessible name
เพิ่ม `aria-label` ให้ปุ่ม replay controls (`กลับไปจุดเริ่มต้น`, `เล่นย้อนหลัง`/`หยุดชั่วคราว`),
timeline slider, ตัวเลือกความเร็ว, และปุ่มปิด dialog ใน `ReasonDialog` — ตรวจสอบทั้งไฟล์แล้วไม่พบ
ปุ่ม icon-only ที่เหลือที่ยังไม่มี accessible name

### ข้อ 9 — ไม่มี visible focus style
เพิ่ม `:focus-visible{outline:2px solid var(--mint);outline-offset:2px}` เป็น rule กลางใน `globals.css`
ใช้ `:focus-visible` ไม่ใช่ `:focus` เพื่อไม่ให้ขึ้น outline ตอนคลิกด้วยเมาส์

---

## 6) ประสิทธิภาพ (กลาง/ต่ำ)

### ข้อ 11 — Polling ไม่หยุดตอนแท็บไม่ active
สร้าง hook `lib/use-visible-interval.ts` (`useVisibleInterval`) — เหมือน `setInterval` แต่หยุดยิงเมื่อ
`document.visibilityState !== "visible"` และรีเฟรชทันทีเมื่อกลับมาที่แท็บ ใช้แทน `window.setInterval` ใน:
`MatchControlWorkspace` (5s), `HistoryWorkspace` (5s), `PublishingWorkspace` (10s), `LiveRace` wind polling (2s),
และหน้า public ทั้ง 3 จุด (race data / wind / athlete series, 2s ทั้งหมด)
(ไม่แตะ replay timer ใน `History` component เพราะเป็นแค่ animation ฝั่ง client ไม่มี network request)

### ข้อ 10 — Realtime handler ยิง full reload ทุกครั้ง
เดิม `postgres_changes` event ทุกตัว (live_athlete_state / live_wind_state / collector_status) เรียก `load()`
เดียวกันที่ query ทั้ง 6 ตารางพร้อมกัน ตอนนี้แยกเป็น `reloadAthletes` / `reloadWind` / `reloadCollector`
เฉพาะทาง แต่ละ event จะ fetch แค่ตารางที่เปลี่ยนจริง ลดภาระตอนแข่งจริงที่ event มาถี่ระดับวินาที

---

## 7) รายละเอียดปลีกย่อย (ต่ำ)

### ข้อ 12 — เวลาไม่มีวันที่กำกับ
เพิ่ม `bangkokDateTime()` ใน `lib/format.ts` — เหมือน `bangkokTime()` แต่ใส่วันที่กำกับด้วยเมื่อค่าห่างจาก
ตอนนี้ ≥ 1 วัน ใช้แทนที่ `bangkokTime()` ในจุดที่ค่าอาจเก่าข้ามวันได้: `collector.last_message_at`
(Overview + PreparedLiveRace), เวลาเริ่มรอบใน `MatchControlWorkspace`, เวลาจบรอบใน `HistoryWorkspace`,
และเวลาของ quality event (จุดที่เป็นข้อมูลสด/อัปเดตทุกไม่กี่วินาทียังใช้ `bangkokTime()` เหมือนเดิม)

### ข้อ 16 — ตาราง Overview ตัดที่ 7 แถวไม่มีทางดูต่อ
เพิ่มลิงก์ "ดูนักกีฬาทั้งหมด N คน →" ท้ายตารางใน `Overview` เมื่อมีนักกีฬามากกว่า 7 คน ลิงก์ไปหน้า `/live`

### ข้อ 15 — JSON ดิบในหน้า Quality
เพิ่ม `formatDetails()` แปลง object เป็น `key: value · key2: value2` อ่านง่ายกว่า `JSON.stringify` ดิบ

### ข้อ 14 — ไม่มีโหมดสว่าง
เพิ่ม light theme ผ่าน CSS variables (`:root[data-theme="light"]`) และปุ่มสลับธีม (`ThemeToggle`
component ใหม่) ในแถบ topbar ของ dashboard บันทึกค่าไว้ที่ `localStorage` และมี script เล็กๆ
(`next/script strategy="beforeInteractive"`) ตั้งค่า `data-theme` ก่อน hydrate กันจอกระพริบ (FOUC)
เหมาะกับการใช้งานกลางแจ้ง/แสงแดดจ้าตามที่ suggestion ระบุ

---

## 8) เมนู/Navigation ที่ปรับ

- **"ตั้งค่าระบบ" → "เผยแพร่สู่สาธารณะ"** (ทั้ง sidebar label และ page title): เดิม title/description
  ("ตั้งค่าทุ่นลม เวลา การเก็บข้อมูล และสิทธิ์การเผยแพร่") อ้างอิงถึง `SettingsPanel` ที่เป็นโค้ดตาย
  (ไม่เคยถูก render จริง — หน้า `/settings` render `PublishingWorkspace` เสมอ) เปลี่ยนชื่อเมนู/หัวข้อให้
  ตรงกับสิ่งที่หน้านี้ทำจริง คือเปิด/ปิดการเผยแพร่รายการแข่งขันและประเภทเรือให้บุคคลทั่วไปดู
  เปลี่ยนไอคอนจาก `Settings` เป็น `Globe2` ให้สื่อความหมายมากขึ้นด้วย
- เพิ่มปุ่มสลับธีมสว่าง/มืดในแถบบนของ dashboard (ดูข้อ 14 ด้านบน)
- ไม่มีการเปลี่ยนโครงสร้างเมนูอื่น — เมนูที่เหลือ (ภาพรวม/การแข่งขันสด/ผลย้อนหลัง/เปรียบเทียบ/ควบคุม/คุณภาพข้อมูล)
  ยังตรงกับสิ่งที่แต่ละหน้าทำจริง ไม่พบปัญหาเพิ่มเติม

---

## 9) โค้ดที่ตัดทิ้ง (ใช้วิจารณญาณตามที่อนุญาต)

พบว่า `race-dashboard.tsx` มี component และ state จำนวนมากที่ไม่เคย render/เรียกใช้จริงเลย
(เขียนไว้แต่ route ปัจจุบันไม่เคยพาไปถึง) — ตัดออกทั้งหมด ลดไฟล์จาก ~1,360 บรรทัด เหลือ ~1,150 บรรทัด:

- **`Control` component** (~90 บรรทัด) — เขียนไว้สำหรับหน้าควบคุมแบบเก่า แต่ route `/control` ปัจจุบัน
  render `MatchControlWorkspace` เสมอ ไม่เคยเรียก `Control` เลย
- **`CollectorSetup` component** (~110 บรรทัด) — เช่นเดียวกัน ไม่เคยถูก import/render จากที่ไหน
- **`SettingsPanel` component** (~50 บรรทัด) — หน้า `/settings` render `PublishingWorkspace` เสมอ
  ไม่เคยเรียก `SettingsPanel` เลย (เป็นที่มาของ title/description ที่ผิดในข้อ "เมนู" ด้านบนด้วย)
- **state/ฟังก์ชันที่พึ่งพา component เหล่านี้เท่านั้น**: `notice`/`setNotice`, `historyImport`/`setHistoryImport`,
  ฟังก์ชัน `control()` และ `importHistoryNow()` ใน `RaceDashboard`, query `history_imports` ใน `load()`
- **import ที่ไม่ได้ใช้แล้ว**: `Settings2`, `RaceClass` ใน `race-dashboard.tsx`; `Anchor`, `BarChart3` ใน
  `dashboard-shell.tsx` (เป็น dead import อยู่แล้วตั้งแต่ต้น ไม่เกี่ยวกับงานนี้ แต่เจอระหว่างแก้ไขเลยเก็บกวาดให้)
- **`load()` ใน `RaceDashboard`**: เดิมยิง query 6-7 ตารางเต็มๆ ทุกครั้งที่เข้าเพจ **แม้แต่หน้า
  `/control`, `/history`, `/settings`** ทั้งที่ 3 หน้านี้ใช้ `MatchControlWorkspace`/`HistoryWorkspace`/
  `PublishingWorkspace` ที่โหลดข้อมูลของตัวเองอยู่แล้ว — เพิ่มเงื่อนไข skip การ query ทั้งหมดสำหรับ
  3 section นี้ ลด request ที่ไม่จำเป็นออกไป

---

## ไฟล์ที่แก้ไข/เพิ่มใหม่

**แก้ไข:**
- `frontend/src/components/race-dashboard.tsx` — เนื้อหาหลักของการแก้ไขเกือบทั้งหมด
- `frontend/src/components/dashboard-shell.tsx` — rename เมนู, เพิ่ม ThemeToggle, ตัด dead import
- `frontend/src/lib/format.ts` — เพิ่ม `mapErrorMessage`, `bangkokDateTime`
- `frontend/src/app/globals.css` — font-size, focus-visible, light theme, style ของ component ใหม่
- `frontend/src/app/layout.tsx` — เพิ่ม theme-init script (กัน FOUC)
- `frontend/src/app/public/page.tsx` — ใช้ `useVisibleInterval` + `mapErrorMessage`

**ไฟล์ใหม่:**
- `frontend/src/app/error.tsx`
- `frontend/src/app/not-found.tsx`
- `frontend/src/components/reason-dialog.tsx`
- `frontend/src/components/theme-toggle.tsx`
- `frontend/src/lib/use-visible-interval.ts`

---

## การทดสอบ

- `npx tsc --noEmit` — ผ่าน ไม่มี type error
- `npx next build` — build production ผ่านทุก route (13 หน้า) รวมทั้งหน้าที่แก้ทั้งหมด
- เปิด dev server จริงและตรวจผ่าน browser:
  - `/error` boundary: ปิด Supabase env แล้วเข้า `/overview` → เห็นหน้า error ที่ออกแบบเอง (ไม่ใช่หน้าขาว) ✅
  - `/not-found`: เข้า URL ที่ไม่มีจริง → เห็นหน้า not-found ที่ออกแบบเอง ✅
  - `/login`: render ปกติ ไม่มี console error/warning ✅
- **ข้อจำกัด**: environment นี้ไม่มี Supabase URL/Key จริง จึงไม่สามารถ login และทดสอบหน้าที่ต้อง auth
  แบบ end-to-end ได้ (role gating ใน `/control`, Compare picker, ReasonDialog, ปุ่มสลับธีม ฯลฯ)
  — ส่วนเหล่านี้ตรวจสอบผ่าน type-check + build + code review แทน แนะนำให้ลอง manual test
  อีกครั้งกับ Supabase project จริงก่อน merge
