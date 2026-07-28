"use client";

import {FormEvent, useState} from "react";
import {Anchor, ArrowRight, ShieldCheck, Wind} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const {error} = await createClient().auth.signInWithPassword({email, password});
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }
    window.location.href = "/overview";
  }

  return (
    <main className="login-shell">
      <section className="login-visual">
        <div className="brand-mark"><Wind size={25}/></div>
        <p className="eyebrow">SAILFISH · ระบบวิเคราะห์การแข่งขัน</p>
        <h1>อ่านลม<br/>อ่านเกม<br/><em>ก่อนใคร</em></h1>
        <p className="login-intro">
          ระบบวิเคราะห์เส้นทาง ความเร็ว และมุมลมแบบวินาทีต่อวินาที
          สำหรับทีมที่ตัดสินใจจากข้อมูลจริง
        </p>
        <div className="ocean-grid" aria-hidden="true">
          <span className="wind-line line-one"/>
          <span className="wind-line line-two"/>
          <span className="wind-line line-three"/>
          <Anchor className="ocean-anchor"/>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={signIn}>
          <div className="secure-label"><ShieldCheck size={15}/> พื้นที่ส่วนตัวสำหรับสมาชิก</div>
          <h2>เข้าสู่ระบบ</h2>
          <p>เฉพาะสมาชิกทีมที่ได้รับอนุญาต</p>
          <label>อีเมล<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@team.com"/></label>
          <label>รหัสผ่าน<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"/></label>
          {message && <div className="form-error">{message}</div>}
          <button className="primary-button" disabled={loading}>
            {loading ? "กำลังตรวจสอบ..." : "เข้าสู่หน้าหลัก"} <ArrowRight size={18}/>
          </button>
          <small>ตำแหน่งนักกีฬาเป็นข้อมูลส่วนบุคคล การเข้าถึงถูกบันทึกไว้</small>
        </form>
      </section>
    </main>
  );
}
