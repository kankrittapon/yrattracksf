import {redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {createClient} from "@/lib/supabase/server";

export default async function Layout({children}: {children: React.ReactNode}) {
  const supabase = await createClient();
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const {data: profile} = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return <DashboardShell role={profile?.role || "viewer"} email={user.email}>{children}</DashboardShell>;
}
