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
