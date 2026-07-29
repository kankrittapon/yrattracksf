import Link from "next/link";
import {Anchor, ArrowRight} from "lucide-react";

export default function NotFound() {
  return (
    <main className="boundary-shell">
      <div className="empty-state">
        <Anchor/>
        <h2>ไม่พบหน้านี้</h2>
        <p>URL ที่เปิดอาจพิมพ์ผิด หรือหน้านี้ถูกย้าย/ลบไปแล้ว</p>
        <Link className="empty-action" href="/overview">กลับหน้าหลัก <ArrowRight/></Link>
      </div>
    </main>
  );
}
