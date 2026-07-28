# ใช้ SailFish Network Inspector บน iPhone

ไฟล์: `sailfish-network-inspector.user.js`

ใช้กับ Safari Userscripts extension หรือ userscript manager ที่รองรับ `@run-at document-start`

## วิธีเก็บข้อมูล

1. เปิดสคริปต์ก่อนเข้า `saill.cn`
2. ที่หน้า Login กด **1 Login** แล้ว Login ตามปกติ
3. ที่หน้าเลือกรายการแข่งขัน กด **2 รายการ** แล้วเลือกรายการหนึ่ง
4. เมื่อหน้าแสดงประเภทเรือ/กลุ่ม กด **3 ประเภท** แล้วเลือก ILCA4 หรือประเภทที่ต้องการ
5. ก่อนเปิดหน้า Live/Replay กด **4 Track**
6. รอให้หน้าดึงข้อมูลครบอย่างน้อย 15 วินาที แล้วกด **Export JSON**
7. หาก Safari คัดลอกได้ ให้วาง JSON ส่งกลับมา หากคัดลอกไม่ได้ ระบบจะดาวน์โหลดไฟล์ `.json`

เวอร์ชัน 1.2 ถอด `getRaceDatas.result` แบบ LZ-String/Base64 อัตโนมัติและใส่ข้อมูลที่ถอดแล้วไว้ใน `decodedResult`

สคริปต์ปิดบังค่า password, cookie, authorization, token, session และรหัสยืนยันก่อนบันทึก รวมถึงตัดรูปแผนที่ CSS และ Font ที่ไม่เกี่ยวข้องออก

> หมายเหตุ: อย่าปิด Private Browsing หรือเคลียร์ข้อมูลเว็บไซต์ระหว่างเก็บ เพราะ log ถูกเก็บใน localStorage ของ `saill.cn`
