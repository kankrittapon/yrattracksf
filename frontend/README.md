# Frontend — Vercel

## Local development

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_CONTROL_API_URL` — Tailscale Serve HTTPS URL ของ `ai-brain`

ค่าทั้งสามถูกส่งถึง browser จึงห้ามใส่ service-role key หรือ SailFish token

## Vercel

ตั้ง Root Directory เป็น `frontend` แล้วเพิ่ม environment variables สำหรับ
Production และ Preview ก่อน deploy

เมนูอ่านข้อมูลใช้ Supabase โดยตรง ส่วน Collector Control ต้องเปิดจากอุปกรณ์ที่:

1. Login Dashboard แล้ว
2. เชื่อม Tailnet
3. ได้รับสิทธิ์ ACL เข้า `ai-brain`
4. มี role `admin` ใน Supabase `profiles`

ถ้าไม่ได้เชื่อม Tailscale หน้า Control จะแจ้งว่าเชื่อม `ai-brain` ไม่ได้ แต่เมนู
อ่านข้อมูลยังทำงานผ่าน Supabase ได้ตามปกติ

## Privacy

- ทุก route ยกเว้น `/login` ถูก middleware ป้องกัน
- Supabase RLS เป็นขอบเขตสิทธิ์จริง ไม่พึ่งการซ่อนเมนู
- Browser ไม่ได้รับ raw payload หรือ backend secrets
- Export และการดูพิกัดควรเรียก audit insert ก่อนเปิดใช้ใน Production
