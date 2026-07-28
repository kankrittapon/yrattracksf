# Backend — ai-brain

## Development

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[test]"
Copy-Item .env.example .env
pytest
uvicorn app.main:app --reload
```

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` และ SailFish credentials ต้องตั้งใน
`.env` จริง ห้ามส่งค่าเหล่านี้ไป Frontend

## Deploy ด้วย Docker

```bash
cp .env.example .env
# เติม secret ด้วย editor บน ai-brain
docker compose up -d --build
docker compose ps
docker compose logs -f sailfish-collector
```

Container bind Uvicorn ที่ `127.0.0.1:8000` ผ่าน host network เพื่อไม่เปิดพอร์ต
บน LAN/public interface

## Tailscale Serve

บน `ai-brain`:

```bash
sudo tailscale serve --bg localhost:8000
tailscale serve status
```

จากนั้นใช้ URL HTTPS ที่ Tailscale แสดงเป็น `NEXT_PUBLIC_CONTROL_API_URL` บน
Vercel ห้ามใช้ Funnel เพราะ Funnel เปิด service สู่อินเทอร์เน็ต

กำหนด Tailnet grants/ACL ให้เฉพาะกลุ่มผู้ดูแลเข้าถึง `ai-brain:443`

## Admin authorization

Backend ตรวจ JWT จาก Supabase แล้วอ่าน role จาก `public.profiles` ผ่าน
service-role key ทุก control request ไม่เชื่อ `user_metadata`

ตั้ง Admin ครั้งแรกใน Supabase SQL editor:

```sql
update public.profiles
set role = 'admin'
where email = 'admin@example.com';
```

## Live token

Collector พยายามค้น token ใน response ของ `getRace` ก่อน หาก SailFish ไม่ส่ง field
ที่ตรวจพบ ให้ตั้ง `SAILFISH_LIVE_TOKEN` ชั่วคราว แต่ token อาจหมดอายุ จึงต้องจับ
endpoint ออก token เพื่อทำ refresh อัตโนมัติก่อน Production

## Operational checks

```bash
curl http://127.0.0.1:8000/health
docker inspect --format '{{json .State.Health}}' sailfish_collector
tailscale serve status --json
```
