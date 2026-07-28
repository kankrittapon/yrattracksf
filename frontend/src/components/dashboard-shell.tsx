"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {
  Activity, Anchor, BarChart3, CircleGauge, ClipboardCheck, Clock3,
  Database, LogOut, Radio, Settings, Shield, SlidersHorizontal, Users, Wind,
} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

const navigation = [
  {href: "/overview", label: "Overview", icon: CircleGauge},
  {href: "/live", label: "Live Race", icon: Radio},
  {href: "/history", label: "Races & History", icon: Clock3},
  {href: "/compare", label: "Athlete Compare", icon: Users},
  {href: "/control", label: "Collector Control", icon: SlidersHorizontal, admin: true},
  {href: "/quality", label: "Data Quality", icon: ClipboardCheck, admin: true},
  {href: "/settings", label: "Settings", icon: Settings, admin: true},
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
        <div className="sidebar-brand"><span><Wind size={22}/></span><div><b>SailFish</b><small>RACE INTELLIGENCE</small></div></div>
        <nav>
          <p>WORKSPACE</p>
          {navigation.filter((item) => !item.admin || role === "admin").map(({href, label, icon: Icon}) => (
            <Link className={pathname === href ? "active" : ""} href={href} key={href}><Icon size={18}/>{label}</Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="private-chip"><Shield size={14}/>{role === "admin" ? "ADMIN · PRIVATE" : "MEMBER · PRIVATE"}</div>
          <button onClick={logout}><LogOut size={16}/><span>{email || "ออกจากระบบ"}</span></button>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="live-system"><span/> SYSTEM ONLINE</div>
          <div className="topbar-meta"><Database size={15}/> UTC storage · Bangkok display <Activity size={15}/></div>
        </header>
        <main className="dashboard-content">{children}</main>
      </div>
    </div>
  );
}
