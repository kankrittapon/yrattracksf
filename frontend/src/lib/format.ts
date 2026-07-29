export function number(value: number | null | undefined, digits = 1) {
  return value == null || Number.isNaN(value) ? "—" : value.toFixed(digits);
}

export function directionName(value: number | null | undefined) {
  if (value == null) return "—";
  const names = ["เหนือ", "ตะวันออกเฉียงเหนือ", "ตะวันออก", "ตะวันออกเฉียงใต้", "ใต้", "ตะวันตกเฉียงใต้", "ตะวันตก", "ตะวันตกเฉียงเหนือ"];
  return names[Math.round(value / 45) % 8];
}

export function freshness(updatedAt: string | null | undefined) {
  if (!updatedAt) return {label: "ไม่มีข้อมูล", className: "offline"};
  const seconds = (Date.now() - new Date(updatedAt).getTime()) / 1000;
  if (seconds <= 5) return {label: "ข้อมูลปัจจุบัน", className: "live"};
  if (seconds <= 30) return {label: "ข้อมูลล่าช้า", className: "stale"};
  return {label: "ไม่มีข้อมูล", className: "offline"};
}

export function bangkokTime(value: string | number | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

// เหมือน bangkokTime แต่แสดงวันที่กำกับด้วยเมื่อค่าห่างจากตอนนี้เกิน 1 วัน กันสับสนว่าเป็นข้อมูลของวันนี้
export function bangkokDateTime(value: string | number | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  const dayMs = 24 * 60 * 60 * 1000;
  const needsDate = Math.abs(Date.now() - date.getTime()) >= dayMs;
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    ...(needsDate ? {day: "numeric", month: "short"} : {}),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

const errorMessageMap: Array<[RegExp, string]> = [
  [/failed to fetch|networkerror|load failed/i, "เชื่อมต่อเครือข่ายไม่ได้ กรุณาตรวจสอบ Tailscale และลองใหม่"],
  [/abort/i, "คำขอใช้เวลานานเกินไป กรุณาลองใหม่"],
  [/http 401|unauthorized/i, "การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่"],
  [/http 403|forbidden/i, "ไม่มีสิทธิ์ทำรายการนี้"],
  [/http 404|not found/i, "ไม่พบข้อมูลที่ร้องขอ"],
  [/http 5\d\d/i, "ระบบปลายทางขัดข้อง กรุณาลองใหม่ภายหลัง"],
];

function rawMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof (error as {message?: unknown}).message === "string") {
    return (error as {message: string}).message;
  }
  return String(error);
}

// แปล error ดิบจาก fetch/Supabase (รวม PostgrestError ที่ไม่ใช่ instanceof Error) ให้เป็นข้อความไทยที่ผู้ใช้เข้าใจ พร้อม log ต้นฉบับไว้ debug
export function mapErrorMessage(error: unknown): string {
  console.error(error);
  const raw = rawMessageOf(error);
  for (const [pattern, message] of errorMessageMap) {
    if (pattern.test(raw)) return message;
  }
  return "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่";
}
