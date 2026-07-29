"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {
  Activity, CircleGauge, ClipboardCheck, Clock3,
  Database, Globe2, LogOut, Radio, Shield, SlidersHorizontal, Users, Wind,
} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {ThemeToggle} from "@/components/theme-toggle";

const navigation = [
  {href: "/overview", label: "ภาพรวม", icon: CircleGauge},
  {href: "/live", label: "การแข่งขันสด", icon: Radio},
  {href: "/history", label: "ผลการแข่งขันย้อนหลัง", icon: Clock3},
  {href: "/compare", label: "เปรียบเทียบนักกีฬา", icon: Users},
  {href: "/control", label: "ควบคุมการเก็บข้อมูล", icon: SlidersHorizontal, admin: true},
  {href: "/quality", label: "ตรวจสอบคุณภาพข้อมูล", icon: ClipboardCheck, admin: true},
  {href: "/settings", label: "เผยแพร่สู่สาธารณะ", icon: Globe2, admin: true},
];

export function DashboardShell({
  children,
  role,
  email,
}: {
  children: React.ReactNode;
  role: string;
  email?: string;
}) {
  const pathname = usePathname();
  async function logout() {
    await createClient().auth.signOut();
    window.location.href = "/login";
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><span><Wind size={22}/></span><div><b>SailFish</b><small>สมาคมเรือใบแห่งประเทศไทย</small></div></div>
        <nav>
          <p>เมนูหลัก</p>
          {navigation.filter((item) => !item.admin || role === "admin").map(({href, label, icon: Icon}) => (
            <Link className={pathname === href ? "active" : ""} href={href} key={href}><Icon size={18}/>{label}</Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="private-chip"><Shield size={14}/>{role === "admin" ? "ผู้ดูแล · ส่วนตัว" : "สมาชิก · ส่วนตัว"}</div>
          <button onClick={logout}><LogOut size={16}/><span>{email || "ออกจากระบบ"}</span></button>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="live-system"><span/> ระบบพร้อมใช้งาน</div>
          <div className="topbar-meta"><Database size={15}/> เก็บเวลาแบบสากล · แสดงเวลาไทย <Activity size={15}/><ThemeToggle/></div>
        </header>
        <main className="dashboard-content">{children}</main>
      </div>
    </div>
  );
}
