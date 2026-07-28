export function number(value: number | null | undefined, digits = 1) {
  return value == null || Number.isNaN(value) ? "—" : value.toFixed(digits);
}

export function directionName(value: number | null | undefined) {
  if (value == null) return "—";
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(value / 45) % 8];
}

export function freshness(updatedAt: string | null | undefined) {
  if (!updatedAt) return {label: "offline", className: "offline"};
  const seconds = (Date.now() - new Date(updatedAt).getTime()) / 1000;
  if (seconds <= 5) return {label: "live", className: "live"};
  if (seconds <= 30) return {label: "stale", className: "stale"};
  return {label: "offline", className: "offline"};
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
