import {useCallback, useEffect, useRef} from "react";

// รวม call ที่มาถี่ๆ ในช่วง delayMs ให้เหลือครั้งเดียว (trailing) — ใช้กันกรณี broadcast/realtime
// event ยิงเข้ามาหลายครั้งติดกัน (เช่น นักกีฬาหลายคนอัปเดตพร้อมกัน) ไม่ให้ยิง refetch ซ้ำถี่เกินไป
export function useDebouncedCallback(callback: () => void, delayMs: number) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current != null) window.clearTimeout(timer.current);
  }, []);

  return useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      callbackRef.current();
    }, delayMs);
  }, [delayMs]);
}
