"use client";

import {useEffect} from "react";
import Link from "next/link";
import {Anchor, ArrowRight, RefreshCw} from "lucide-react";

export default function ErrorBoundary({error, reset}: {error: Error & {digest?: string}; reset: () => void}) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="boundary-shell">
      <div className="empty-state">
        <Anchor/>
        <h2>เกิดข้อผิดพลาดที่ไม่คาดคิด</h2>
        <p>ระบบพบปัญหาระหว่างแสดงหน้านี้ กรุณาลองใหม่ หรือกลับไปหน้าหลัก</p>
        <button className="empty-action" onClick={reset}><RefreshCw size={16}/> ลองใหม่</button>
        <Link className="empty-action secondary" href="/overview">กลับหน้าหลัก <ArrowRight/></Link>
      </div>
    </main>
  );
}
