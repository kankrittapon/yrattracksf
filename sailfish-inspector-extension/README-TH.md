# SailFish Network Inspector Extension

เวอร์ชัน 1.2.0 รองรับ XHR ที่ใช้ `responseType="json"` และ Chrome Debugger
Network capture สำหรับ WebSocket ที่สร้างจาก Worker

## ติดตั้งบน Chrome หรือ Edge

1. เปิด `chrome://extensions` หรือ `edge://extensions`
2. เปิด **Developer mode**
3. กด **Load unpacked**
4. เลือกโฟลเดอร์ `sailfish-inspector-extension`
5. ปิดหน้า SailFish เดิมทั้งหมด แล้วเปิดใหม่

## เก็บข้อมูล

1. เข้า `https://www.saill.cn`
2. เปิดหน้า Live Track ที่ต้องการ
3. กดไอคอน Extension แล้วกด **เริ่มจับ WebSocket**
4. อนุญาต Debugger หาก Chrome ถาม จากนั้น Reload หน้า Track
5. รอรับข้อมูลอย่างน้อย 1–2 นาที
6. กดไอคอน Extensionและตรวจว่าจำนวนรายการเพิ่มขึ้น
7. กด **หยุดจับ WebSocket**
8. กด **Export JSON**

Extension ปิดบัง password, Authorization และ token ก่อนบันทึก แต่ควรตรวจไฟล์อีกครั้งก่อนส่ง

Log ที่ต้องการเห็น:

```text
collector-installed
hook-installed
websocket-open
websocket-send
websocket-message
cdp-websocket-open
cdp-websocket-send
cdp-websocket-message
```
