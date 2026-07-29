import {useEffect, useRef} from "react";

// เหมือน setInterval ปกติ แต่หยุดยิงเมื่อแท็บไม่ได้อยู่ตรงหน้า (document.visibilityState !== "visible")
// และรีเฟรชทันทีเมื่อกลับมาที่แท็บ เพื่อลด request ที่ไม่จำเป็นตอนผู้ใช้สลับแท็บ/พับหน้าจอ
export function useVisibleInterval(callback: () => void, delayMs: number) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") callbackRef.current();
    };
    const timer = window.setInterval(tick, delayMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [delayMs]);
}
