"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  Activity, AlertTriangle, Anchor, ArrowRight, CheckCircle2, ChevronDown, ClipboardCheck,
  Clock3, Compass, Database, Gauge, LocateFixed, LockKeyhole, Play,
  Radio, RefreshCw, RotateCcw, Settings2, ShieldCheck, Square, Users, Wind,
} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {bangkokTime, directionName, freshness, number} from "@/lib/format";
import type {
  AthleteState, Collector, HistoryImport, Match, Race, RaceClass, Section, Team, WindState,
} from "@/types/dashboard";

interface QualityEvent {
  id: number;
  event_type: string;
  severity: string;
  details: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
}

interface SailFishMatch {
  matchCd: string;
  matchName?: string;
  matchStart?: string;
  matchEnd?: string;
  notFinishRaceCount?: number;
}

const titles: Record<Section, [string, string]> = {
  overview: ["ภาพรวมการแข่งขัน", "สถานะการแข่งขัน ลม และข้อมูลล่าสุด"],
  live: ["การแข่งขันสด", "ตำแหน่ง ลม และผลงานของนักกีฬาแบบวินาทีต่อวินาที"],
  history: ["ผลการแข่งขันย้อนหลัง", "เลือกดูและเล่นข้อมูลการแข่งขันที่ผ่านมา"],
  compare: ["เปรียบเทียบนักกีฬา", "เปรียบเทียบเส้นทาง ความเร็ว และมุมเทียบลม"],
  control: ["ควบคุมการเก็บข้อมูล", "เริ่ม หยุด และตรวจการเก็บข้อมูลผ่าน Tailscale"],
  quality: ["ตรวจสอบคุณภาพข้อมูล", "ตรวจข้อมูลล่าช้า ข้อมูลขาด และปัญหาการเชื่อมต่อ"],
  settings: ["ตั้งค่าระบบ", "ตั้งค่าทุ่นลม เวลา การเก็บข้อมูล และสิทธิ์การเผยแพร่"],
};

const collectorState: Record<string, string> = {
  idle: "ยังไม่เริ่ม",
  armed: "เตรียมพร้อม",
  waiting_for_start: "รอเริ่มการแข่งขัน",
  recording: "กำลังเก็บข้อมูล",
  finishing: "กำลังจบการเก็บข้อมูล",
  completed: "เก็บข้อมูลเสร็จแล้ว",
  error: "เกิดข้อผิดพลาด",
  pending: "รอดำเนินการ",
  running: "กำลังนำเข้าข้อมูล",
};

const actionName: Record<string, string> = {
  arm: "เตรียมเก็บข้อมูล",
  "start-override": "เริ่มเก็บข้อมูลด้วยตนเอง",
  stop: "หยุดเก็บข้อมูล",
  retry: "ลองใหม่",
};

const qualityEventName: Record<string, string> = {
  unknown_binary_frame: "พบข้อมูลที่ยังแปลไม่ได้",
  history_wind_unavailable: "บางช่วงไม่มีข้อมูลลมสำหรับคำนวณ",
  decoder_error: "แปลข้อมูลไม่สำเร็จ",
  timestamp_gap: "พบช่วงเวลาที่ข้อมูลขาด",
  duplicate_device: "พบอุปกรณ์ที่ผูกกับนักกีฬามากกว่าหนึ่งคน",
  websocket_reconnect: "ช่องรับข้อมูลสดเชื่อมต่อใหม่",
};

const raceStatusLabel: Record<string, string> = {
  "10": "รอเริ่มการแข่งขัน",
  "50": "กำลังแข่งขัน",
  "99": "จบการแข่งขันแล้ว",
};

export function RaceDashboard({section}: {section: Section}) {
  const [races, setRaces] = useState<Race[]>([]);
  const [raceCd, setRaceCd] = useState("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [athletes, setAthletes] = useState<AthleteState[]>([]);
  const [wind, setWind] = useState<WindState | null>(null);
  const [collector, setCollector] = useState<Collector | null>(null);
  const [quality, setQuality] = useState<QualityEvent[]>([]);
  const [role, setRole] = useState("viewer");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [historyImport, setHistoryImport] = useState<HistoryImport | null>(null);
  const [matchFilter, setMatchFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient();
    const {data: raceRows} = await supabase.from("races")
      .select("*,match:matches(name),race_class:race_classes(name)")
      .order("updated_at", {ascending: false});
    const allRaces = (raceRows || []) as unknown as Race[];
    const nextRaces = allRaces.filter((item) => {
      if (section === "history") {
        return item.sailfish_status === "99" && Boolean(item.history_imported_at);
      }
      if (section === "control" || section === "settings") return true;
      return item.sailfish_status === "50";
    });
    setRaces(nextRaces);
    const selected = nextRaces.some((item) => item.race_cd === raceCd)
      ? raceCd
      : nextRaces[0]?.race_cd || "";
    if (raceCd !== selected) setRaceCd(selected);
    if (!selected) {
      setLoading(false);
      return;
    }
    const {data: {user}} = await supabase.auth.getUser();
    const [teamResult, athleteResult, windResult, collectorResult, qualityResult, profileResult, importResult] = await Promise.all([
      supabase.from("teams").select("*").eq("race_cd", selected),
      supabase.from("live_athlete_state").select("*").eq("race_cd", selected).order("captured_at_ms", {ascending: false}),
      supabase.from("live_wind_state").select("*").eq("race_cd", selected).order("captured_at_ms", {ascending: false}).limit(1).maybeSingle(),
      supabase.from("collector_status").select("*").eq("race_cd", selected).maybeSingle(),
      supabase.from("data_quality_events").select("*").eq("race_cd", selected).order("created_at", {ascending: false}).limit(30),
      user ? supabase.from("profiles").select("role").eq("id", user.id).maybeSingle() : Promise.resolve({data: null}),
      supabase.from("history_imports").select("*").eq("race_cd", selected).maybeSingle(),
    ]);
    setTeams((teamResult.data || []) as Team[]);
    setAthletes((athleteResult.data || []) as AthleteState[]);
    setWind((windResult.data || null) as WindState | null);
    setCollector((collectorResult.data || null) as Collector | null);
    setQuality((qualityResult.data || []) as QualityEvent[]);
    setRole(profileResult.data?.role || "viewer");
    setHistoryImport((importResult.data || null) as HistoryImport | null);
    setLoading(false);
  }, [raceCd, section]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!raceCd) return;
    const supabase = createClient();
    const channel = supabase.channel(`live:${raceCd}`)
      .on("postgres_changes", {event: "*", schema: "public", table: "live_athlete_state", filter: `race_cd=eq.${raceCd}`}, () => void load())
      .on("postgres_changes", {event: "*", schema: "public", table: "live_wind_state", filter: `race_cd=eq.${raceCd}`}, () => void load())
      .on("postgres_changes", {event: "*", schema: "public", table: "collector_status", filter: `race_cd=eq.${raceCd}`}, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [raceCd, load]);

  const auditedRace = useRef("");
  useEffect(() => {
    if (section !== "live" || !raceCd || auditedRace.current === raceCd) return;
    auditedRace.current = raceCd;
    const supabase = createClient();
    void supabase.auth.getUser().then(({data: {user}}) => {
      if (!user) return;
      return supabase.from("audit_logs").insert({
        actor_id: user.id,
        action: "telemetry.view_live",
        race_cd: raceCd,
        metadata: {source: "dashboard"},
      });
    });
  }, [section, raceCd]);

  const race = races.find((item) => item.race_cd === raceCd);
  const matchOptions = useMemo(
    () => [...new Map(races.map((item) => [item.match_cd, item.match?.name || item.match_cd])).entries()],
    [races],
  );
  const classOptions = useMemo(
    () => [...new Map(races
      .filter((item) => !matchFilter || item.match_cd === matchFilter)
      .map((item) => [item.level_cd || "", item.race_class?.name || item.level_cd || "ไม่ระบุประเภท"])).entries()],
    [races, matchFilter],
  );
  const visibleRaces = races.filter((item) =>
    (!matchFilter || item.match_cd === matchFilter)
    && (!classFilter || item.level_cd === classFilter));
  useEffect(() => {
    if (section !== "history" || visibleRaces.some((item) => item.race_cd === raceCd)) return;
    setRaceCd(visibleRaces[0]?.race_cd || "");
  }, [classFilter, matchFilter, raceCd, section, visibleRaces]);
  const teamMap = useMemo(() => new Map(teams.map((team) => [team.team_cd, team])), [teams]);
  const liveCount = athletes.filter((item) => freshness(item.updated_at).className === "live").length;

  if (section === "control") {
    return <><SectionHeading section={section}/><MatchControlWorkspace/></>;
  }
  if (section === "history") {
    return <><SectionHeading section={section}/><HistoryWorkspace/></>;
  }
  if (section === "settings") {
    return <><SectionHeading section={section}/><PublishingWorkspace/></>;
  }

  async function control(action: "arm" | "start-override" | "stop" | "retry") {
    setNotice("กำลังเชื่อมต่อ ai-brain ผ่าน Tailscale…");
    const api = process.env.NEXT_PUBLIC_CONTROL_API_URL;
    if (!api) return setNotice("ยังไม่ได้ตั้งค่าที่อยู่ระบบควบคุม");
    const supabase = createClient();
    const {data: {session}} = await supabase.auth.getSession();
    if (!session) return setNotice("การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่");
    const reason = action === "arm" || action === "retry"
      ? "สั่งงานจากหน้าควบคุม"
      : window.prompt("กรุณาระบุเหตุผลในการสั่งงาน", "") || "";
    if ((action === "start-override" || action === "stop") && reason.length < 3) {
      return setNotice("ต้องระบุเหตุผลอย่างน้อย 3 ตัวอักษร");
    }
    try {
      const response = await fetch(`${api.replace(/\/$/, "")}/collectors/${raceCd}/${action}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({reason}),
      });
      if (!response.ok) throw new Error((await response.json()).detail || `HTTP ${response.status}`);
      setCollector(await response.json());
      setNotice(`${actionName[action]}สำเร็จ`);
    } catch (error) {
      setNotice(`เชื่อมต่อไม่ได้ — กรุณาเชื่อม Tailscale (${String(error)})`);
    }
  }

  async function importHistoryNow() {
    setNotice("กำลังสั่งนำเข้าข้อมูลย้อนหลังทันที…");
    const api = process.env.NEXT_PUBLIC_CONTROL_API_URL;
    const supabase = createClient();
    const {data: {session}} = await supabase.auth.getSession();
    if (!api || !session) return setNotice("ต้องเข้าสู่ระบบและเชื่อม Tailscale ก่อน");
    try {
      const response = await fetch(`${api.replace(/\/$/, "")}/history-imports/${raceCd}/retry`, {
        method: "POST",
        headers: {Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json"},
      });
      if (!response.ok) throw new Error((await response.json()).detail || `HTTP ${response.status}`);
      setNotice("เริ่มนำเข้าข้อมูลย้อนหลังแล้ว หน้านี้จะแสดงความคืบหน้า");
      await load();
    } catch (error) {
      setNotice(`สั่งนำเข้าไม่สำเร็จ — ${String(error)}`);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">ข้อมูลการแข่งขัน SAILFISH</p><h1>{titles[section][0]}</h1><span>{titles[section][1]}</span></div>
        <div className="race-picker">
          <label>เลือกรอบที่กำลังแข่ง</label>
          <select value={raceCd} onChange={(event) => setRaceCd(event.target.value)}>
            {!visibleRaces.length && <option value="">ยังไม่มีการแข่งขัน</option>}
            {visibleRaces.map((item) => <option value={item.race_cd} key={item.race_cd}>{item.name || item.race_cd} · {item.rounds || "—"} · {raceStatusLabel[item.sailfish_status || ""] || "ไม่ทราบสถานะ"}</option>)}
          </select>
          <ChevronDown size={16}/>
        </div>
      </div>

      {loading ? <LoadingState/> : !race ? <EmptyState/> : (
        <>
          {section === "overview" && <Overview race={race} collector={collector} wind={wind} athletes={athletes} liveCount={liveCount} teamMap={teamMap}/>}
          {section === "live" && <LiveRace race={race} collector={collector} wind={wind} athletes={athletes} teamMap={teamMap}/>}
          {section === "compare" && <Compare athletes={athletes} teamMap={teamMap}/>}
          {section === "quality" && <Quality collector={collector} quality={quality} athletes={athletes} teams={teams}/>}
        </>
      )}
    </>
  );
}

function SectionHeading({section}: {section: Section}) {
  return <div className="page-heading">
    <div><p className="eyebrow">ข้อมูลการแข่งขัน SAILFISH</p><h1>{titles[section][0]}</h1><span>{titles[section][1]}</span></div>
  </div>;
}

async function adminRequest(path: string, init?: RequestInit) {
  const api = process.env.NEXT_PUBLIC_CONTROL_API_URL;
  if (!api) throw new Error("ยังไม่ได้ตั้งค่าที่อยู่ระบบควบคุม");
  const supabase = createClient();
  const {data: {session}} = await supabase.auth.getSession();
  if (!session) throw new Error("การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่");
  const response = await fetch(`${api.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

interface WorkspaceData {
  matches: Match[];
  races: Race[];
  collectors: Collector[];
  imports: HistoryImport[];
  role: string;
}

async function loadWorkspaceData(): Promise<WorkspaceData> {
  const supabase = createClient();
  const {data: {user}} = await supabase.auth.getUser();
  const [matches, races, collectors, imports, profile] = await Promise.all([
    supabase.from("matches").select("*").order("synced_at", {ascending: false}),
    supabase.from("races").select("*,match:matches(name),race_class:race_classes(name,public_live_enabled,public_history_enabled)").order("updated_at", {ascending: false}),
    supabase.from("collector_status").select("*"),
    supabase.from("history_imports").select("*").order("updated_at", {ascending: false}),
    user ? supabase.from("profiles").select("role").eq("id", user.id).maybeSingle() : Promise.resolve({data: null}),
  ]);
  return {
    matches: (matches.data || []) as Match[],
    races: (races.data || []) as unknown as Race[],
    collectors: (collectors.data || []) as Collector[],
    imports: (imports.data || []) as HistoryImport[],
    role: profile.data?.role || "viewer",
  };
}

function classNameOf(race: Race) {
  return race.race_class?.name || race.name || race.level_cd || "ไม่ระบุประเภท";
}

function readableMatchName(matchCd: string, name: string | null | undefined, races: Race[]) {
  const normalized = (name || "").trim().replace(/\s+/g, " ");
  const opaque = !normalized || normalized === matchCd || /^[a-f0-9]{24,}$/i.test(normalized);
  if (!opaque) return normalized;
  const classes = [...new Set(races.filter((race) => race.match_cd === matchCd).map(classNameOf))];
  return classes.length ? `รายการเดิม · ${classes.slice(0, 3).join(" / ")}` : "รายการเดิมที่ยังไม่มีชื่อ";
}

function historyMatchName(match: Match, races: Race[]) {
  const readable = readableMatchName(match.match_cd, match.name, races);
  if (!readable.startsWith("รายการเดิม")) return readable;
  const matchRaces = races.filter((race) => race.match_cd === match.match_cd);
  const classCount = new Set(matchRaces.map((race) => race.level_cd).filter(Boolean)).size;
  const firstStart = matchRaces.map((race) => race.start_at).filter(Boolean).sort()[0];
  const date = firstStart ? new Intl.DateTimeFormat("th-TH", {
    day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Bangkok",
  }).format(new Date(firstStart)) : "";
  return `รายการย้อนหลัง · ${classCount} ประเภท${date ? ` · ${date}` : ""}`;
}

function MatchControlWorkspace() {
  const [data, setData] = useState<WorkspaceData>({matches: [], races: [], collectors: [], imports: [], role: "viewer"});
  const [discovered, setDiscovered] = useState<SailFishMatch[]>([]);
  const [matchCd, setMatchCd] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("เลือกหรือค้นหารายการแข่งขัน แล้ว Sync เพื่อดูประเภทเรือและรอบทั้งหมด");
  const [newRaces, setNewRaces] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    const next = await loadWorkspaceData();
    setData(next);
    setMatchCd((current) => {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem("sailfish-control-match") : "";
      return next.matches.some((item) => item.match_cd === current) ? current
        : next.matches.some((item) => item.match_cd === saved) ? saved!
        : next.matches[0]?.match_cd || current;
    });
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const timer = window.setInterval(() => void reload(), 5000);
    return () => window.clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    if (matchCd) window.localStorage.setItem("sailfish-control-match", matchCd);
    setClassFilter("");
  }, [matchCd]);

  const options = useMemo(() => {
    const map = new Map(data.matches.map((item) => [item.match_cd, readableMatchName(item.match_cd, item.name, data.races)]));
    discovered.forEach((item) => {
      const discoveredName = readableMatchName(item.matchCd, item.matchName, data.races);
      if (!map.has(item.matchCd) || !discoveredName.startsWith("รายการเดิม")) map.set(item.matchCd, discoveredName);
    });
    return [...map.entries()];
  }, [data.matches, data.races, discovered]);
  const matchRaces = data.races.filter((item) => item.match_cd === matchCd);
  const classOptions = [...new Map(matchRaces.map((item) => [item.level_cd || "", classNameOf(item)])).entries()];
  const visible = matchRaces.filter((item) => !classFilter || item.level_cd === classFilter);
  const groups = [...new Map(visible.map((item) => [item.level_cd || "", classNameOf(item)])).entries()];
  const collectorMap = new Map(data.collectors.map((item) => [item.race_cd, item]));
  const selectedMatch = data.matches.find((item) => item.match_cd === matchCd);
  const scopeRaces = classFilter ? matchRaces.filter((item) => item.level_cd === classFilter) : matchRaces;
  const scopeLabel = classFilter ? classOptions.find(([value]) => value === classFilter)?.[1] || "ประเภทที่เลือก" : "ทุกประเภท";
  const scopeEnabled = Boolean(selectedMatch?.is_public) && scopeRaces.length > 0
    && scopeRaces.every((item) => item.race_class?.public_live_enabled);

  async function discoverMatches() {
    setBusy("discover");
    try {
      const body = await adminRequest("/races/discover");
      const items = (body.items || []) as SailFishMatch[];
      setDiscovered(items);
      if (!matchCd) setMatchCd(items[0]?.matchCd || "");
      setNotice(items.length ? `พบ ${items.length} รายการแข่งขัน` : "ไม่พบรายการแข่งขันในบัญชี SailFish");
      await reload();
    } catch (error) {
      setNotice(`ค้นหาไม่สำเร็จ — ${String(error)}`);
    } finally { setBusy(""); }
  }

  async function syncMatch() {
    if (!matchCd) return;
    setBusy("sync");
    const before = new Set(matchRaces.map((item) => item.race_cd));
    try {
      const body = await adminRequest("/races/sync", {method: "POST", body: JSON.stringify({match_cd: matchCd})});
      const incoming = (body.items || []) as Array<{raceCd: string}>;
      setNewRaces(new Set(incoming.filter((item) => !before.has(item.raceCd)).map((item) => item.raceCd)));
      setNotice(`อัปเดตแล้ว ${incoming.length} รอบ · รอเริ่ม ${body.waiting?.length || 0} · กำลังแข่ง ${body.active?.length || 0} · จบแล้ว ${body.finished?.length || 0}`);
      await reload();
    } catch (error) {
      setNotice(`Sync ไม่สำเร็จ — ${String(error)}`);
    } finally { setBusy(""); }
  }

  async function roundAction(race: Race, action: "arm" | "start-override" | "stop" | "retry") {
    const needsReason = action === "start-override" || action === "stop";
    const reason = needsReason ? window.prompt("กรุณาระบุเหตุผล", "") || "" : "สั่งงานจากหน้าควบคุม";
    if (needsReason && reason.length < 3) return setNotice("ต้องระบุเหตุผลอย่างน้อย 3 ตัวอักษร");
    setBusy(race.race_cd);
    try {
      await adminRequest(`/collectors/${race.race_cd}/${action}`, {method: "POST", body: JSON.stringify({reason})});
      setNotice(`${actionName[action]} ${classNameOf(race)} ${race.rounds || ""} สำเร็จ`);
      await reload();
    } catch (error) {
      setNotice(`สั่งงานไม่สำเร็จ — ${String(error)}`);
    } finally { setBusy(""); }
  }

  async function togglePublicScope() {
    if (!matchCd || !matchRaces.length) return;
    setBusy("public");
    try {
      await adminRequest(`/matches/${matchCd}/public-scope`, {
        method: "POST",
        body: JSON.stringify({
          is_public: !scopeEnabled,
          level_cd: classFilter || null,
        }),
      });
      setNotice(`${!scopeEnabled ? "เปิด" : "ปิด"} หน้าสาธารณะ${classFilter ? `เฉพาะ ${scopeLabel}` : "ทุกประเภท"}แล้ว · รอบที่จบจะหยุดการถ่ายทอดสดและรอรอบถัดไป`);
      await reload();
    } catch (error) {
      setNotice(`ตั้งค่า Public ไม่สำเร็จ — ${String(error)}`);
    } finally { setBusy(""); }
  }

  return <div className="match-workspace">
    <section className="panel match-toolbar">
      <div className="control-lock"><LockKeyhole/><div><b>ควบคุมผ่าน TAILSCALE</b><span>เลือกรายการแข่งขันก่อน แล้วจัดการแต่ละรอบแยกกัน</span></div></div>
      <div className="match-picker-row">
        <label>รายการแข่งขัน<select value={matchCd} onChange={(event) => setMatchCd(event.target.value)}>
          {!options.length && <option value="">ยังไม่มีรายการ</option>}
          {options.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select></label>
        <button disabled={Boolean(busy)} onClick={discoverMatches}><Database/> ค้นหารายการ</button>
        <button className="primary-match-action" disabled={Boolean(busy) || !matchCd} onClick={syncMatch}><RefreshCw/> {busy === "sync" ? "กำลัง Sync…" : matchRaces.length ? "Sync หารอบใหม่" : "นำเข้ารายการ"}</button>
      </div>
      <div className="control-notice">{notice}</div>
    </section>
    {matchRaces.length > 0 && <>
      <div className="match-summary">
        <Metric label="ประเภทเรือ" value={String(classOptions.length)} sub="ประเภท" icon={<LayersIcon/>}/>
        <Metric label="รอบทั้งหมด" value={String(matchRaces.length)} sub="รอบ" icon={<Database/>}/>
        <Metric label="รอเริ่ม" value={String(matchRaces.filter((item) => item.sailfish_status === "10").length)} sub="รอบ" icon={<Clock3/>}/>
        <Metric label="กำลังแข่งขัน" value={String(matchRaces.filter((item) => item.sailfish_status === "50").length)} sub="รอบ" icon={<Radio/>}/>
      </div>
      <div className="class-filter-bar">
        <div className="class-filter">
          <button className={!classFilter ? "active" : ""} onClick={() => setClassFilter("")}>ทุกประเภท ({matchRaces.length})</button>
          {classOptions.map(([value, label]) => <button className={classFilter === value ? "active" : ""} key={value} onClick={() => setClassFilter(value)}>{label} ({matchRaces.filter((item) => item.level_cd === value).length})</button>)}
        </div>
        <div className="public-scope-action">
          <span><b>อนุญาตให้คนทั่วไปดู</b><small>ขอบเขต: {scopeLabel} · เมื่อจบรอบจะหยุดถ่ายทอดสดอัตโนมัติ</small></span>
          <button className={scopeEnabled ? "enabled" : ""} disabled={Boolean(busy)} onClick={togglePublicScope}>
            <ShieldCheck/> {scopeEnabled ? `ปิดหน้าสาธารณะ · ${scopeLabel}` : `เปิดหน้าสาธารณะ · ${scopeLabel}`}
          </button>
        </div>
      </div>
      {groups.map(([levelCd, label]) => <section className="panel class-race-group" key={levelCd}>
        <PanelTitle icon={<Users/>} title={label} meta={<span>{visible.filter((item) => (item.level_cd || "") === levelCd).length} รอบ</span>}/>
        {visible.filter((item) => (item.level_cd || "") === levelCd).map((race) => {
          const status = collectorMap.get(race.race_cd);
          const running = race.collection_enabled || Boolean(status && !["idle", "completed", "error"].includes(status.state));
          return <div className="round-control-row" key={race.race_cd}>
            <div><b>{race.rounds || race.name || "ไม่ระบุรอบ"}</b><span>{raceStatusLabel[race.sailfish_status || ""] || "ไม่ทราบสถานะ"} · {bangkokTime(race.start_at)}</span></div>
            <div className="round-badges">{newRaces.has(race.race_cd) && <i className="new-badge">รอบใหม่</i>}<i className={`race-status status-${race.sailfish_status}`}>{collectorState[status?.state || "idle"]}</i></div>
            <div className="round-actions">
              {race.sailfish_status !== "99" && !running && <button disabled={busy === race.race_cd} onClick={() => roundAction(race, "arm")}><Radio/> เตรียมเก็บข้อมูล</button>}
              {running && <><button onClick={() => roundAction(race, "start-override")}><Play/> เริ่มด้วยตนเอง</button><button onClick={() => roundAction(race, "retry")}><RefreshCw/> ลองใหม่</button><button className="danger" onClick={() => roundAction(race, "stop")}><Square/> หยุด</button></>}
              {race.sailfish_status === "99" && <span className="finished-copy">ไปหน้า “ผลย้อนหลัง” เพื่อนำเข้าข้อมูล</span>}
            </div>
          </div>;
        })}
      </section>)}
    </>}
  </div>;
}

function LayersIcon() {
  return <span aria-hidden="true">▦</span>;
}

function HistoryWorkspace() {
  const [data, setData] = useState<WorkspaceData>({matches: [], races: [], collectors: [], imports: [], role: "viewer"});
  const [matchCd, setMatchCd] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewRaceCd, setViewRaceCd] = useState("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    const next = await loadWorkspaceData();
    setData(next);
    setMatchCd((current) => next.matches.some((item) => item.match_cd === current)
      ? current
      : next.matches[0]?.match_cd || "");
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const timer = window.setInterval(() => void reload(), 5000);
    return () => window.clearInterval(timer);
  }, [reload]);
  const finished = data.races.filter((item) =>
    item.match_cd === matchCd
    && item.sailfish_status === "99"
    && Boolean(item.start_at)
    && Boolean(item.end_at));
  const matchOptions = data.matches;
  const classes = [...new Map(finished.map((item) => [item.level_cd || "", classNameOf(item)])).entries()];
  const visible = classFilter ? finished.filter((item) => item.level_cd === classFilter) : [];
  const importMap = new Map(data.imports.map((item) => [item.race_cd, item]));
  const importable = visible.filter((race) => {
    const job = importMap.get(race.race_cd);
    return !race.history_imported_at && job?.status !== "completed"
      && job?.status !== "running" && job?.status !== "pending";
  });
  const scopeLabel = classes.find(([value]) => value === classFilter)?.[1] || "ประเภทที่เลือก";
  const selectedMatch = data.matches.find((item) => item.match_cd === matchCd);
  const selectedClass = visible[0]?.race_class;
  const hasReadyHistory = visible.some((race) =>
    Boolean(race.history_imported_at) || importMap.get(race.race_cd)?.status === "completed");
  const historyPublicEnabled = Boolean(
    selectedMatch?.is_public && selectedClass?.public_history_enabled
  );
  const viewRace = data.races.find((item) => item.race_cd === viewRaceCd);
  useEffect(() => {
    if (!viewRaceCd) return setTeams([]);
    const supabase = createClient();
    void supabase.from("teams").select("*").eq("race_cd", viewRaceCd).then(({data: rows}) => setTeams((rows || []) as Team[]));
  }, [viewRaceCd]);

  async function importRaces(codes: string[]) {
    if (!codes.length) return;
    setBusy(true);
    try {
      const body = codes.length === 1
        ? await adminRequest(`/history-imports/${codes[0]}/retry`, {method: "POST"})
        : await adminRequest("/history-imports/batch", {method: "POST", body: JSON.stringify({race_cds: codes})});
      setNotice(codes.length === 1 ? "เพิ่มรอบเข้าคิวนำเข้าแล้ว" : `เพิ่มเข้าคิว ${body.accepted?.length || 0} รอบ · ข้าม ${body.skipped?.length || 0} รอบ`);
      setSelected(new Set());
      await reload();
    } catch (error) { setNotice(`นำเข้าไม่สำเร็จ — ${String(error)}`); }
    finally { setBusy(false); }
  }

  async function discoverMatches() {
    setBusy(true);
    try {
      const body = await adminRequest("/races/discover");
      setNotice(`โหลดรายการแข่งขันจาก SailFish แล้ว ${body.total ?? body.items?.length ?? 0} รายการ`);
      await reload();
    } catch (error) {
      setNotice(`โหลดรายการแข่งขันไม่สำเร็จ — ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function syncSelectedMatch() {
    if (!matchCd) return;
    setBusy(true);
    try {
      const body = await adminRequest("/races/sync", {
        method: "POST",
        body: JSON.stringify({match_cd: matchCd}),
      });
      setClassFilter("");
      setSelected(new Set());
      setNotice(`โหลดประเภทและรอบแล้ว ${body.items?.length || 0} รอบ · จบแล้ว ${body.finished?.length || 0} รอบ`);
      await reload();
    } catch (error) {
      setNotice(`โหลดประเภทและรอบไม่สำเร็จ — ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistoryPublic() {
    if (!matchCd || !classFilter || !selectedClass) return;
    setBusy(true);
    try {
      const nextEnabled = !historyPublicEnabled;
      if (nextEnabled && !selectedMatch?.is_public) {
        await adminRequest(`/matches/${matchCd}/visibility`, {
          method: "POST",
          body: JSON.stringify({is_public: true}),
        });
      }
      await adminRequest(`/race-classes/${classFilter}/visibility`, {
        method: "POST",
        body: JSON.stringify({
          public_live_enabled: Boolean(selectedClass.public_live_enabled),
          public_history_enabled: nextEnabled,
        }),
      });
      setNotice(nextEnabled
        ? `เปิดผลย้อนหลัง ${scopeLabel} ให้คนทั่วไปดูแล้ว`
        : `ปิดผลย้อนหลัง ${scopeLabel} จากหน้าสาธารณะแล้ว`);
      await reload();
    } catch (error) {
      setNotice(`ตั้งค่าหน้าสาธารณะไม่สำเร็จ — ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return <div className="history-workspace">
    <section className="panel match-toolbar">
      <div className="match-picker-row">
        <label>รายการแข่งขัน<select value={matchCd} onChange={(event) => {setMatchCd(event.target.value); setClassFilter(""); setSelected(new Set());}}>
          {!matchOptions.length && <option value="">กดโหลดรายการจาก SailFish ก่อน</option>}
          {matchOptions.map((item) => <option value={item.match_cd} key={item.match_cd}>{historyMatchName(item, data.races)}</option>)}
        </select></label>
        {data.role === "admin" && <button disabled={busy} onClick={discoverMatches}><Database/> โหลดรายการจาก SailFish</button>}
        {data.role === "admin" && <button className="primary-match-action" disabled={busy || !matchCd} onClick={syncSelectedMatch}><RefreshCw/> โหลดประเภทและรอบ</button>}
      </div>
      {notice && <div className="control-notice">{notice}</div>}
    </section>
    {!classFilter && classes.length > 0 && <section className="panel history-class-picker">
      <PanelTitle icon={<LayersIcon/>} title="เลือกประเภทเรือก่อน" meta={<span>{classes.length} ประเภทที่มีรอบจบแล้ว</span>}/>
      <div className="history-class-grid">
        {classes.map(([value, label]) => {
          const classRaces = finished.filter((item) => item.level_cd === value);
          const ready = classRaces.filter((race) => race.history_imported_at || importMap.get(race.race_cd)?.status === "completed").length;
          return <button key={value} onClick={() => {setClassFilter(value); setSelected(new Set());}}>
            <span><Users/><b>{label}</b></span>
            <small>{classRaces.length} รอบจบแล้ว · พร้อมดู {ready} รอบ</small>
            <i>เลือกประเภทนี้ →</i>
          </button>;
        })}
      </div>
    </section>}
    {classFilter && <section className="panel history-import-list">
      <button className="history-back-to-classes" onClick={() => {setClassFilter(""); setSelected(new Set());}}>← เลือกประเภทเรืออื่น</button>
      <div className={`history-public-action ${historyPublicEnabled ? "enabled" : ""}`}>
        <span><ShieldCheck/><span><b>ผลย้อนหลังบนหน้าสาธารณะ</b><small>{historyPublicEnabled ? `คนทั่วไปดู ${scopeLabel} ได้แล้ว` : `ข้อมูลพร้อมแล้ว แต่ยังไม่ได้อนุญาตให้คนทั่วไปดู`}</small></span></span>
        {data.role === "admin" && <button disabled={busy || !hasReadyHistory} onClick={toggleHistoryPublic}>
          {historyPublicEnabled ? "ปิดผลย้อนหลังสาธารณะ" : "เปิดผลย้อนหลังให้คนทั่วไปดู"}
        </button>}
      </div>
      <PanelTitle icon={<Clock3/>} title={`รอบที่จบแล้ว · ${scopeLabel}`} meta={data.role === "admin" ? <div className="history-batch-actions">
        <button className="text-button" disabled={busy || !importable.length} onClick={() => setSelected(new Set(importable.map((race) => race.race_cd)))}>
          เลือกทั้งหมด ({importable.length})
        </button>
        <button className="text-button primary" disabled={busy || (!selected.size && !importable.length)} onClick={() => importRaces(selected.size ? [...selected] : importable.map((race) => race.race_cd))}>
          {selected.size ? `นำเข้า ${selected.size} รอบที่เลือก` : `นำเข้าทั้ง ${scopeLabel}`}
        </button>
      </div> : <span>ดูได้เมื่อข้อมูลพร้อม</span>}/>
      {visible.map((race) => {
        const job = importMap.get(race.race_cd);
        const ready = Boolean(race.history_imported_at) || job?.status === "completed";
        const selectable = data.role === "admin" && !["running", "pending"].includes(job?.status || "") && !ready;
        const label = ready ? "พร้อมดูย้อนหลัง" : job?.status === "running" ? `กำลังนำเข้า ${number(job.progress_percent, 0)}%` : job?.status === "pending" ? "รอดำเนินการ" : job?.status === "error" ? "นำเข้าไม่สำเร็จ" : "ยังไม่ได้นำเข้า";
        return <div className="history-import-row" key={race.race_cd}>
          <label>{selectable && <input type="checkbox" checked={selected.has(race.race_cd)} onChange={(event) => setSelected((current) => {const next = new Set(current); event.target.checked ? next.add(race.race_cd) : next.delete(race.race_cd); return next;})}/>}<span><b>{classNameOf(race)} · {race.rounds || "ไม่ระบุรอบ"}</b><small>{bangkokTime(race.end_at)}</small></span></label>
          <i className={`import-status ${job?.status || (ready ? "completed" : "idle")}`}>{label}</i>
          <div>{ready ? <button onClick={() => setViewRaceCd(race.race_cd)}>เปิดดูย้อนหลัง</button> : data.role === "admin" && <button disabled={busy || job?.status === "running"} onClick={() => importRaces([race.race_cd])}>{job?.status === "error" ? "ลองนำเข้าใหม่" : "นำเข้ารอบนี้"}</button>}</div>
        </div>;
      })}
      {!visible.length && <div className="table-empty">ยังไม่มีรอบที่จบในประเภทนี้</div>}
    </section>}
    {matchCd && !classes.length && <section className="panel"><div className="table-empty">รายการนี้ยังไม่มีรอบที่จบแล้ว หรือยังไม่ได้กด “โหลดประเภทและรอบ”</div></section>}
    {!matchOptions.length && <section className="panel"><div className="table-empty">กด “โหลดรายการจาก SailFish” เพื่อแสดงรายการแข่งขันทั้งหมด</div></section>}
    {viewRace && <History race={viewRace} teams={teams} role={data.role}/>}
  </div>;
}

function PublishingWorkspace() {
  const [data, setData] = useState<WorkspaceData>({matches: [], races: [], collectors: [], imports: [], role: "viewer"});
  const [matchCd, setMatchCd] = useState("");
  const [notice, setNotice] = useState("");
  const reload = useCallback(async () => {
    const next = await loadWorkspaceData();
    setData(next);
    setMatchCd((current) => next.matches.some((item) => item.match_cd === current) ? current : next.matches[0]?.match_cd || "");
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const timer = window.setInterval(() => void reload(), 10000);
    return () => window.clearInterval(timer);
  }, [reload]);
  const match = data.matches.find((item) => item.match_cd === matchCd);
  const races = data.races.filter((item) => item.match_cd === matchCd);
  const imports = new Map(data.imports.map((item) => [item.race_cd, item]));
  const groups = [...new Map(races.map((item) => [item.level_cd || "", classNameOf(item)])).entries()];
  async function toggle() {
    if (!match) return;
    try {
      await adminRequest(`/matches/${match.match_cd}/visibility`, {method: "POST", body: JSON.stringify({is_public: !match.is_public})});
      setNotice(!match.is_public ? "เปิดเผยรายการและทุกประเภทเรือแล้ว" : "ปิดเผยแพร่รายการแล้ว");
      await reload();
    } catch (error) { setNotice(`บันทึกไม่สำเร็จ — ${String(error)}`); }
  }
  return <div className="publishing-workspace">
    <section className="panel match-toolbar">
      <div className="match-picker-row"><label>รายการแข่งขัน<select value={matchCd} onChange={(event) => setMatchCd(event.target.value)}>{data.matches.map((item) => <option value={item.match_cd} key={item.match_cd}>{item.name}</option>)}</select></label></div>
    </section>
    {match && <section className="panel publishing-master">
      <div><ShieldCheck/><span><b>{match.name}</b><small>เมื่อเปิด ทุกประเภทเรือในรายการนี้จะเผยแพร่โดยอัตโนมัติ</small></span></div>
      <button className={match.is_public ? "enabled" : ""} disabled={data.role !== "admin"} onClick={toggle}>{match.is_public ? "กำลังเผยแพร่ · กดเพื่อปิด" : "เปิดเผยรายการนี้"}</button>
    </section>}
    {notice && <div className="control-notice">{notice}</div>}
    {groups.map(([levelCd, label]) => <section className="panel class-race-group" key={levelCd}>
      <PanelTitle icon={<Users/>} title={label} meta={<span>แสดงสถานะเท่านั้น</span>}/>
      {races.filter((item) => (item.level_cd || "") === levelCd).map((race) => {
        const job = imports.get(race.race_cd);
        return <div className="settings-status-row" key={race.race_cd}><b>{race.rounds || race.name || "ไม่ระบุรอบ"}</b><i className={`race-status status-${race.sailfish_status}`}>{raceStatusLabel[race.sailfish_status || ""] || "ไม่ทราบสถานะ"}</i><span>{race.history_imported_at ? "พร้อมดูย้อนหลัง" : job?.status === "running" ? `กำลังนำเข้า ${number(job.progress_percent, 0)}%` : race.sailfish_status === "99" ? "รอนำเข้าข้อมูลย้อนหลัง" : "ข้อมูลสดตามสถานะรอบ"}</span></div>;
      })}
    </section>)}
  </div>;
}

function CollectorSetup({races, onSynced}: {races: Race[]; onSynced: () => void}) {
  const [matches, setMatches] = useState<SailFishMatch[]>([]);
  const [matchCd, setMatchCd] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "เริ่มจากค้นหารายการแข่งขันในบัญชี SailFish"
  );

  async function request(path: string, init?: RequestInit) {
    const api = process.env.NEXT_PUBLIC_CONTROL_API_URL;
    if (!api) throw new Error("ยังไม่ได้ตั้งค่าที่อยู่ระบบควบคุม");
    const supabase = createClient();
    const {data: {session}} = await supabase.auth.getSession();
    if (!session) throw new Error("การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่");
    const response = await fetch(`${api.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async function discover() {
    setBusy(true);
    setMessage("กำลังเชื่อม ai-brain ผ่าน Tailscale และค้นหารายการ…");
    try {
      const body = await request("/races/discover");
      const items = (body.items || []) as SailFishMatch[];
      setMatches(items);
      setMatchCd(items[0]?.matchCd || "");
      setMessage(items.length
        ? `พบ ${items.length} รายการ เลือกรายการแล้วกดเชื่อมรอบที่กำลังแข่ง`
        : "ไม่พบรายการแข่งขันในบัญชี SailFish");
    } catch (error) {
      setMessage(`ค้นหาไม่สำเร็จ — ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    if (!matchCd) return;
    setBusy(true);
    setMessage("กำลังตรวจรอบที่เจ้าของสนามกดเริ่ม และเปิดระบบเก็บข้อมูล…");
    try {
      const body = await request("/races/sync", {
        method: "POST",
        body: JSON.stringify({match_cd: matchCd}),
      });
      const count = Array.isArray(body.items) ? body.items.length : 0;
      if (!count) {
        setMessage("รายการนี้ยังไม่มีรอบการแข่งขันให้ติดตาม");
        return;
      }
      setMessage(`พบทั้งหมด ${count} รอบ · รอเริ่ม ${body.waiting?.length || 0} · กำลังแข่ง ${body.active?.length || 0} · จบแล้ว ${body.finished?.length || 0}`);
      onSynced();
    } catch (error) {
      setMessage(`เชื่อมข้อมูลไม่สำเร็จ — ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="control-layout setup-layout">
      <section className="panel control-main">
        <div className="control-lock">
          <LockKeyhole/>
          <div><b>ตั้งค่าผ่านเครือข่ายส่วนตัว TAILSCALE</b><span>คำสั่งส่งจากเครื่องนี้ไปยัง ai-brain โดยตรง</span></div>
        </div>
        <h2>เชื่อมรายการจาก SailFish</h2>
        <p className="setup-copy">โหลดประเภทเรือและทุกรอบมาเตรียมไว้ก่อนได้ ระบบจะเริ่มเก็บข้อมูลเองเมื่อเจ้าของสนามกดเริ่มใน SailFish</p>
        <div className="setup-actions">
          <button className="arm" disabled={busy} onClick={discover}>
            <Database/> {busy ? "กำลังทำงาน…" : "ค้นหารายการแข่งขัน"}
          </button>
          {matches.length > 0 && (
            <>
              <label htmlFor="match-picker">รายการแข่งขัน</label>
              <select id="match-picker" value={matchCd} onChange={(event) => setMatchCd(event.target.value)}>
                {matches.map((item) => (
                  <option value={item.matchCd} key={item.matchCd}>
                    {item.matchName || item.matchCd}
                  </option>
                ))}
              </select>
              <button className="status-refresh" disabled={busy || !matchCd} onClick={sync}>
                <RefreshCw/> ตรวจสถานะรอบ
              </button>
            </>
          )}
        </div>
        <div className="control-notice">{message}</div>
        {races.length > 0 && <div className="synced-race-list">
          <div className="synced-race-head"><b>รอบที่เชื่อมไว้แล้ว</b><span>{races.length} รอบ</span></div>
          {races.map((item) => <div className="synced-race-row" key={item.race_cd}>
            <span><b>{item.race_class?.name || item.name || "ไม่ระบุประเภท"}</b><small>{item.rounds || "ไม่ระบุรอบ"}</small></span>
            <i className={`race-status status-${item.sailfish_status}`}>{raceStatusLabel[item.sailfish_status || ""] || "ไม่ทราบสถานะ"}</i>
          </div>)}
        </div>}
      </section>
    </div>
  );
}

function Overview({race, collector, wind, athletes, liveCount, teamMap}: {
  race: Race; collector: Collector | null; wind: WindState | null; athletes: AthleteState[];
  liveCount: number; teamMap: Map<string, Team>;
}) {
  const windFresh = freshness(wind?.updated_at);
  return (
    <>
      <section className="hero-status">
        <div><div className="status-kicker"><span className="pulse"/> {collectorState[collector?.state || "idle"]}</div><h2>{race.name || "ยังไม่มีชื่อการแข่งขัน"} <em>{race.rounds || ""}</em></h2><p>นักกีฬา {athletes.length} คน · ใช้ทุ่นลมหลัก · เวลาไทย {bangkokTime(Date.now())}</p></div>
        <div className="hero-metrics">
          <Metric label="นักกีฬาที่ข้อมูลเป็นปัจจุบัน" value={`${liveCount}/${athletes.length}`} sub="ไม่เกิน 5 วินาที" icon={<Users/>}/>
          <Metric label="ข้อมูลที่ได้รับ" value={String(collector?.messages_received || 0)} sub={`เชื่อมต่อใหม่ ${collector?.reconnects || 0} ครั้ง`} icon={<Activity/>}/>
          <Metric label="สถานะจาก SAILFISH" value={collector?.sailfish_status || race.sailfish_status || "—"} sub={collector?.websocket_connected ? "เชื่อมต่อข้อมูลสดแล้ว" : "ยังไม่เชื่อมต่อข้อมูลสด"} icon={<Radio/>}/>
        </div>
      </section>
      <div className="dashboard-grid">
        <section className="panel wind-card">
          <PanelTitle icon={<Wind/>} title="ลมจากทุ่นหลัก" meta={<StatusDot state={windFresh.className} label={windFresh.label}/>}/>
          <div className="wind-readout">
            <div className="compass-dial"><div className="compass-arrow" style={{transform: `rotate(${wind?.direction_degree || 0}deg)`}}/><b>{number(wind?.direction_degree, 0)}°</b><span>{directionName(wind?.direction_degree)}</span></div>
            <div><strong>{number(wind?.speed_knots, 1)}</strong><small>นอต</small><p>อัปเดต {bangkokTime(wind?.captured_at_ms)}</p></div>
          </div>
        </section>
        <section className="panel athlete-snapshot">
          <PanelTitle icon={<Gauge/>} title="ข้อมูลนักกีฬาล่าสุด" meta={<span>{athletes.length} ลำ</span>}/>
          <AthleteTable athletes={athletes.slice(0, 7)} teamMap={teamMap}/>
        </section>
        <section className="panel health-panel">
          <PanelTitle icon={<ShieldCheck/>} title="สถานะระบบเก็บข้อมูล" meta={null}/>
          <div className="health-list">
            <HealthRow label="การควบคุมผ่าน Tailscale" ok={true} value="ส่วนตัว"/>
            <HealthRow label="ช่องรับข้อมูลสด" ok={Boolean(collector?.websocket_connected)} value={collector?.websocket_connected ? "เชื่อมต่อแล้ว" : "ไม่ได้เชื่อมต่อ"}/>
            <HealthRow label="ข้อมูลล่าสุด" ok={freshness(collector?.last_message_at).className === "live"} value={bangkokTime(collector?.last_message_at)}/>
            <HealthRow label="การแปลข้อมูล" ok={!collector?.last_error} value={collector?.last_error ? "ต้องตรวจสอบ" : "พร้อมใช้งาน"}/>
          </div>
        </section>
      </div>
    </>
  );
}

function LiveRace({race, collector, wind, athletes, teamMap}: {
  race: Race; collector: Collector | null; wind: WindState | null; athletes: AthleteState[]; teamMap: Map<string, Team>;
}) {
  const [windWindow, setWindWindow] = useState<WindWindow>("realtime");
  const [windRows, setWindRows] = useState<WindState[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const supabase = createClient();
      let query = supabase.from("wind_readings")
        .select("race_cd,wind_instrument_cd,captured_at_ms,speed_knots,direction_degree,latitude,longitude,created_at")
        .eq("race_cd", race.race_cd)
        .gte("captured_at_ms", Date.now() - windWindowMs(windWindow))
        .order("captured_at_ms", {ascending: false})
        .limit(1200);
      if (race.main_wind_instrument_cd) query = query.eq("wind_instrument_cd", race.main_wind_instrument_cd);
      const {data} = await query;
      if (cancelled) return;
      const rows = ((data || []) as Array<Omit<WindState, "updated_at"> & {created_at: string}>)
        .map(({created_at, ...row}) => ({...row, updated_at: created_at}));
      setWindRows(rows.length ? rows : wind ? [wind] : []);
    };
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [race.main_wind_instrument_cd, race.race_cd, wind, windWindow]);

  return (
    <div className="live-layout">
      <section className="panel race-map-panel">
        <PanelTitle icon={<LocateFixed/>} title={`${race.name || "การแข่งขัน"} · สนามแข่งขัน`} meta={<StatusDot state={collector?.websocket_connected ? "live" : "offline"} label={collector?.websocket_connected ? "กำลังรับข้อมูล" : "ไม่ได้เชื่อมต่อ"}/>}/>
        <RaceMap athletes={athletes} wind={wind} teamMap={teamMap}/>
      </section>
      <WindTable rows={windRows} window={windWindow} onWindowChange={setWindWindow}/>
      <section className="panel telemetry-table-panel">
        <PanelTitle icon={<Users/>} title="ทิศของนักกีฬาแต่ละคน" meta={<span>คำนวณจากทิศทุ่น − COG</span>}/>
        <AthleteDirectionTable athletes={athletes} teamMap={teamMap}/>
      </section>
    </div>
  );
}

function History({race, teams, role}: {race: Race; teams: Team[]; role: string}) {
  const [selectedTeam, setSelectedTeam] = useState(teams[0]?.team_cd || "");
  const [readings, setReadings] = useState<AthleteState[]>([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!selectedTeam && teams[0]) setSelectedTeam(teams[0].team_cd);
  }, [selectedTeam, teams]);
  useEffect(() => {
    if (!selectedTeam) return;
    const supabase = createClient();
    void supabase.from("athlete_readings")
      .select("race_cd,team_cd,captured_at_ms,sog_knots,cog_degree,latitude,longitude,relative_signed_degree,relative_angle_degree,upwind_vmg_knots,created_at")
      .eq("race_cd", race.race_cd)
      .eq("team_cd", selectedTeam)
      .order("captured_at_ms", {ascending: true})
      .limit(10000)
      .then(({data}) => {
        setReadings(((data || []) as unknown as AthleteState[]).map((row) => ({...row, updated_at: (row as unknown as {created_at: string}).created_at})));
        setCursor(0);
      });
  }, [race.race_cd, selectedTeam]);
  useEffect(() => {
    if (!playing || readings.length < 2) return;
    const timer = window.setInterval(() => {
      setCursor((value) => value >= readings.length - 1 ? 0 : value + 1);
    }, 1000 / speed);
    return () => window.clearInterval(timer);
  }, [playing, readings.length, speed]);
  const selected = teams.find((team) => team.team_cd === selectedTeam);
  const current = readings[cursor];
  const teamMap = new Map(teams.map((team) => [team.team_cd, team]));

  async function exportCsv() {
    if (role !== "admin") return;
    const supabase = createClient();
    const {data} = await supabase.from("athlete_readings")
      .select("team_cd,captured_at_ms,sog_knots,cog_degree,latitude,longitude,relative_signed_degree,relative_angle_degree,upwind_vmg_knots")
      .eq("race_cd", race.race_cd)
      .order("captured_at_ms")
      .limit(100000);
    const rows = data || [];
    const columns = ["team_cd","captured_at_ms","sog_knots","cog_degree","latitude","longitude","relative_signed_degree","relative_angle_degree","upwind_vmg_knots"];
    const csv = [columns.join(","), ...rows.map((row) => columns.map((key) => JSON.stringify((row as Record<string, unknown>)[key] ?? "")).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], {type: "text/csv;charset=utf-8"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sailfish-${race.race_cd}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const {data: {user}} = await supabase.auth.getUser();
    if (user) await supabase.from("audit_logs").insert({actor_id: user.id, action: "telemetry.export_csv", race_cd: race.race_cd});
  }
  return (
    <div className="history-layout">
      <section className="panel replay-stage">
        <PanelTitle icon={<Clock3/>} title={`${race.name || "การแข่งขัน"} · ${race.rounds || "ย้อนหลัง"}`} meta={role === "admin" ? <button className="text-button" onClick={exportCsv}>ดาวน์โหลดตารางข้อมูล</button> : <span>เวลาอ้างอิงสากล</span>}/>
        {current ? <RaceMap athletes={[current]} wind={null} teamMap={teamMap}/> : <div className="replay-placeholder"><Anchor/><h3>{selected ? `กำลังโหลด ${selected.team_name}` : "เลือกนักกีฬา"}</h3><p>เล่นข้อมูลทุกวินาที พร้อมทิศทางการเคลื่อนที่และความเร็วเข้าหาลม</p></div>}
        <div className="replay-controls">
          <button onClick={() => setCursor(0)}><RotateCcw/></button>
          <button className="play" onClick={() => setPlaying((value) => !value)}>{playing ? <Square/> : <Play/>}</button>
          <input className="timeline-input" type="range" min="0" max={Math.max(0, readings.length - 1)} value={cursor} onChange={(event) => setCursor(Number(event.target.value))}/>
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value=".5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option></select>
        </div>
      </section>
      <section className="panel history-roster">
        <PanelTitle icon={<Users/>} title="นักกีฬา" meta={<span>{teams.length}</span>}/>
        {teams.map((team) => <label className="check-row" key={team.team_cd}><input type="radio" name="history-team" checked={selectedTeam === team.team_cd} onChange={() => setSelectedTeam(team.team_cd)}/><span>{team.sail_no || "—"}</span><b>{team.team_name || team.team_cd}</b></label>)}
      </section>
    </div>
  );
}

function Compare({athletes, teamMap}: {athletes: AthleteState[]; teamMap: Map<string, Team>}) {
  const selected = athletes.slice(0, 4);
  return (
    <div className="compare-grid">
      {selected.map((athlete, index) => {
        const team = teamMap.get(athlete.team_cd);
        return <section className="panel athlete-card" key={athlete.team_cd}>
          <div className={`sail-accent accent-${index + 1}`}/>
          <p>หมายเลขใบเรือ {team?.sail_no || "—"}</p><h2>{team?.team_name || athlete.team_cd}</h2>
          <div className="comparison-metrics">
            <Metric label="ความเร็วเหนือพื้นน้ำ (SOG)" value={number(athlete.sog_knots)} sub="นอต" icon={<Gauge/>}/>
            <Metric label="ทิศทางการเคลื่อนที่ (COG)" value={`${number(athlete.cog_degree, 0)}°`} sub="องศา" icon={<Compass/>}/>
            <Metric label="มุมเส้นทางเทียบลม" value={`${number(athlete.relative_angle_degree, 0)}°`} sub="องศา" icon={<Wind/>}/>
            <Metric label="ความเร็วเข้าหาลม (VMG)" value={number(athlete.upwind_vmg_knots)} sub="นอต" icon={<ArrowRight/>}/>
          </div>
        </section>;
      })}
      {!selected.length && <EmptyState/>}
    </div>
  );
}

function Control({collector, race, notice, historyImport, onControl, onImportHistory}: {
  collector: Collector | null; race: Race; notice: string;
  historyImport: HistoryImport | null;
  onControl: (action: "arm" | "start-override" | "stop" | "retry") => void;
  onImportHistory: () => void;
}) {
  return (
    <div className="control-layout">
      <section className="panel control-main">
        <div className="control-lock"><LockKeyhole/><div><b>ควบคุมผ่านเครือข่ายส่วนตัว TAILSCALE</b><span>คำสั่งถูกส่งจากเครื่องนี้ไปยัง ai-brain โดยตรง</span></div></div>
        <h2>{race.name} · {race.rounds}</h2>
        <div className={`selected-race-status status-${race.sailfish_status}`}>
          สถานะจาก SailFish: <b>{raceStatusLabel[race.sailfish_status || ""] || "ไม่ทราบสถานะ"}</b>
        </div>
        <div className="state-flow">{["idle", "armed", "waiting_for_start", "recording", "finishing", "completed"].map((state) => <span className={collector?.state === state ? "current" : ""} key={state}>{collectorState[state]}</span>)}</div>
        <div className="control-buttons">
          {race.sailfish_status === "50" && <>
            <button className="arm" onClick={() => onControl("arm")}><Radio/> เตรียมเก็บข้อมูล</button>
            <button onClick={() => onControl("start-override")}><Play/> เริ่มด้วยตนเอง</button>
            <button onClick={() => onControl("retry")}><RefreshCw/> ลองใหม่</button>
            <button className="danger" onClick={() => onControl("stop")}><Square/> หยุด</button>
          </>}
          {race.sailfish_status === "10" && <p className="waiting-copy">รอเจ้าของสนามกดเริ่มใน SailFish แล้วกด “ตรวจสถานะรอบ” ด้านบนอีกครั้ง</p>}
          {race.sailfish_status === "99" && <button className="arm" onClick={onImportHistory} disabled={historyImport?.status === "running"}>
            <Clock3/> {historyImport?.status === "running" ? "กำลังนำเข้าข้อมูลย้อนหลัง…" : "นำเข้าข้อมูลย้อนหลังตอนนี้"}
          </button>}
        </div>
        {notice && <div className="control-notice">{notice}</div>}
      </section>
      <section className="panel control-status">
        <PanelTitle icon={<Activity/>} title="สถานะการทำงาน" meta={null}/>
        <dl>
          <dt>ขั้นตอนปัจจุบัน</dt><dd>{collectorState[collector?.state || "idle"]}</dd>
          <dt>ช่องรับข้อมูลสด</dt><dd>{collector?.websocket_connected ? "เชื่อมต่อแล้ว" : "ไม่ได้เชื่อมต่อ"}</dd>
          <dt>ข้อมูลที่ได้รับ</dt><dd>{collector?.messages_received || 0}</dd>
          <dt>จำนวนครั้งที่เชื่อมต่อใหม่</dt><dd>{collector?.reconnects || 0}</dd>
          <dt>ข้อมูลล่าสุด</dt><dd>{bangkokTime(collector?.last_message_at)}</dd>
          <dt>การนำเข้าข้อมูลย้อนหลัง</dt><dd>{historyImport ? collectorState[historyImport.status] || "เสร็จแล้ว" : "รอจบการแข่งขัน"}</dd>
          <dt>เวลานำเข้าที่กำหนด</dt><dd>{historyImport ? bangkokTime(historyImport.scheduled_for) : "หลังจบ 90 นาที"}</dd>
          <dt>ความคืบหน้า</dt><dd>{number(historyImport?.progress_percent, 0)}%</dd>
        </dl>
        {historyImport?.last_error && <div className="control-notice">{historyImport.last_error}</div>}
      </section>
    </div>
  );
}

function Quality({collector, quality, athletes, teams}: {collector: Collector | null; quality: QualityEvent[]; athletes: AthleteState[]; teams: Team[]}) {
  const duplicateDevices = teams.filter((team, index) => team.device_cd && teams.findIndex((item) => item.device_cd === team.device_cd) !== index);
  return (
    <>
      <div className="quality-summary">
        <Metric label="เชื่อมต่อใหม่" value={String(collector?.reconnects || 0)} sub="ครั้งในรอบนี้" icon={<RefreshCw/>}/>
        <Metric label="ปัญหาที่ยังไม่ได้ตรวจ" value={String(quality.filter((item) => !item.resolved_at).length)} sub="รายการ" icon={<AlertTriangle/>}/>
        <Metric label="นักกีฬาที่ข้อมูลล่าช้า" value={String(athletes.filter((item) => freshness(item.updated_at).className !== "live").length)} sub="เกิน 5 วินาที" icon={<Clock3/>}/>
        <Metric label="อุปกรณ์ที่ถูกใช้ซ้ำ" value={String(duplicateDevices.length)} sub="รายการ" icon={<Database/>}/>
      </div>
      <section className="panel quality-events">
        <PanelTitle icon={<ClipboardCheck/>} title="รายการปัญหาคุณภาพข้อมูล" meta={<span>30 รายการล่าสุด</span>}/>
        {!quality.length && <div className="all-clear"><CheckCircle2/><b>ไม่พบปัญหาในรอบนี้</b><span>ปัญหาการแปลข้อมูล เวลา และการเชื่อมต่อจะแสดงที่นี่</span></div>}
        {quality.map((item) => <div className="event-row" key={item.id}><span className={`severity ${item.severity}`}/><div><b>{qualityEventName[item.event_type] || "พบข้อมูลที่ต้องตรวจสอบ"}</b><small>รายละเอียดสำหรับผู้ดูแล: {JSON.stringify(item.details)}</small></div><time>{bangkokTime(item.created_at)}</time></div>)}
      </section>
    </>
  );
}

function SettingsPanel({race, wind, role}: {race: Race; wind: WindState | null; role: string}) {
  const [classes, setClasses] = useState<RaceClass[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const supabase = createClient();
    void supabase.from("race_classes").select("*").eq("match_cd", race.match_cd).order("name")
      .then(({data}) => setClasses((data || []) as RaceClass[]));
  }, [race.match_cd]);

  async function saveVisibility(item: RaceClass, field: "public_live_enabled" | "public_history_enabled") {
    if (role !== "admin") return;
    const api = process.env.NEXT_PUBLIC_CONTROL_API_URL;
    const supabase = createClient();
    const {data: {session}} = await supabase.auth.getSession();
    if (!api || !session) return setMessage("ต้องเข้าสู่ระบบและเชื่อม Tailscale ก่อนแก้สิทธิ์");
    const next = {...item, [field]: !item[field]};
    try {
      const response = await fetch(`${api.replace(/\/$/, "")}/race-classes/${item.level_cd}/visibility`, {
        method: "POST",
        headers: {Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json"},
        body: JSON.stringify({
          public_live_enabled: next.public_live_enabled,
          public_history_enabled: next.public_history_enabled,
        }),
      });
      if (!response.ok) throw new Error((await response.json()).detail || `HTTP ${response.status}`);
      setClasses((values) => values.map((value) => value.level_cd === item.level_cd ? next : value));
      setMessage(`บันทึกสิทธิ์การเผยแพร่ของ ${item.name} แล้ว`);
    } catch (error) {
      setMessage(`บันทึกไม่ได้ — เช็ก Tailscale (${String(error)})`);
    }
  }

  return (
    <div className="settings-grid">
      <section className="panel setting-card"><Settings2/><h3>ทุ่นลมอ้างอิง</h3><p>ใช้เครื่องวัดลมหลัก</p><code>{race.main_wind_instrument_cd || wind?.wind_instrument_cd || "ยังไม่ได้กำหนด"}</code><button disabled>กำหนดจากการตั้งค่าระบบ</button></section>
      <section className="panel setting-card"><Clock3/><h3>เวลาและความสดของข้อมูล</h3><p>แสดงเวลาไทย</p><code>ยอมรับข้อมูลลมที่ห่างไม่เกิน 5 วินาที</code><button disabled>จัดเก็บเวลาแบบสากล</button></section>
      <section className="panel setting-card"><Database/><h3>ระยะเวลาเก็บข้อมูล</h3><p>ข้อมูลที่แปลแล้วเก็บระยะยาว</p><code>ข้อมูลดิบเก็บ 30 วัน</code><button disabled>ลบอัตโนมัติตามกำหนด</button></section>
      <section className="panel setting-card public-settings"><ShieldCheck/><h3>สิทธิ์การเผยแพร่</h3><p>อนุญาตแยกการแข่งขันสดและข้อมูลย้อนหลังรายประเภทเรือ</p>
        {classes.map((item) => <div className="class-visibility" key={item.level_cd}>
          <b>{item.name}</b>
          <button disabled={role !== "admin"} className={item.public_live_enabled ? "enabled" : ""} onClick={() => saveVisibility(item, "public_live_enabled")}>สด: {item.public_live_enabled ? "เผยแพร่" : "ไม่เผยแพร่"}</button>
          <button disabled={role !== "admin"} className={item.public_history_enabled ? "enabled" : ""} onClick={() => saveVisibility(item, "public_history_enabled")}>ย้อนหลัง: {item.public_history_enabled ? "เผยแพร่" : "ไม่เผยแพร่"}</button>
        </div>)}
        {message && <div className="control-notice">{message}</div>}
      </section>
    </div>
  );
}

function RaceMap({athletes, wind, teamMap}: {athletes: AthleteState[]; wind: WindState | null; teamMap: Map<string, Team>}) {
  const points = athletes.filter((item) => item.latitude != null && item.longitude != null);
  const allLat = [...points.map((p) => p.latitude!), ...(wind?.latitude != null ? [wind.latitude] : [])];
  const allLon = [...points.map((p) => p.longitude!), ...(wind?.longitude != null ? [wind.longitude] : [])];
  const minLat = Math.min(...allLat, 0), maxLat = Math.max(...allLat, 1);
  const minLon = Math.min(...allLon, 0), maxLon = Math.max(...allLon, 1);
  const xy = (lat: number, lon: number) => ({
    x: 8 + ((lon - minLon) / Math.max(maxLon - minLon, .00001)) * 84,
    y: 92 - ((lat - minLat) / Math.max(maxLat - minLat, .00001)) * 84,
  });
  return (
    <div className="race-map">
      <div className="map-grid"/>
      {wind?.latitude != null && wind.longitude != null && (() => {
        const p = xy(wind.latitude!, wind.longitude!);
        return <div className="wind-marker" style={{left: `${p.x}%`, top: `${p.y}%`}}><Wind/><span>ทุ่นลม</span></div>;
      })()}
      {points.map((athlete) => {
        const p = xy(athlete.latitude!, athlete.longitude!);
        const team = teamMap.get(athlete.team_cd);
        return <div className="boat-marker" key={athlete.team_cd} style={{left: `${p.x}%`, top: `${p.y}%`, transform: `translate(-50%,-50%) rotate(${athlete.cog_degree || 0}deg)`}}><Anchor/><b style={{transform: `rotate(-${athlete.cog_degree || 0}deg)`}}>{team?.sail_no || "•"}</b></div>;
      })}
      {!points.length && <div className="map-empty">กำลังรอตำแหน่งนักกีฬา</div>}
    </div>
  );
}

function AthleteTable({athletes, teamMap}: {athletes: AthleteState[]; teamMap: Map<string, Team>}) {
  return (
    <div className="athlete-table">
      <div className="table-head"><span>ใบเรือ / นักกีฬา</span><span>ความเร็ว (SOG)</span><span>ทิศทาง (COG)</span><span>มุมเทียบลม</span><span>ความเร็วเข้าหาลม</span><span>สถานะ</span></div>
      {athletes.map((athlete) => {
        const team = teamMap.get(athlete.team_cd);
        const fresh = freshness(athlete.updated_at);
        return <div className="table-row" key={athlete.team_cd}>
          <span><b>{team?.sail_no || "—"}</b><i>{team?.team_name || athlete.team_cd.slice(0, 8)}</i></span>
          <span>{number(athlete.sog_knots)}<small> นอต</small></span>
          <span>{number(athlete.cog_degree, 0)}°</span>
          <span>{number(athlete.relative_angle_degree, 0)}°</span>
          <span className={(athlete.upwind_vmg_knots || 0) >= 0 ? "positive" : "negative"}>{number(athlete.upwind_vmg_knots)}</span>
          <span><StatusDot state={fresh.className} label={fresh.label}/></span>
        </div>;
      })}
      {!athletes.length && <div className="table-empty">รอข้อมูลนักกีฬา</div>}
    </div>
  );
}

type WindWindow = "realtime" | "3" | "5" | "10";
const windWindowMs = (value: WindWindow) => value === "realtime" ? 30_000 : Number(value) * 60_000;
const windWindowOptions: Array<[WindWindow, string]> = [
  ["realtime", "เวลาจริง"], ["3", "3 นาที"], ["5", "5 นาที"], ["10", "10 นาที"],
];
const wrapTo180 = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
const buoyMinusCog = (relativeSigned: number | null) =>
  relativeSigned == null ? null : wrapTo180(-relativeSigned);

function WindTable({rows, window, onWindowChange}: {
  rows: WindState[]; window: WindWindow; onWindowChange: (value: WindWindow) => void;
}) {
  return <section className="panel telemetry-table-panel">
    <PanelTitle icon={<Wind/>} title="ตารางลมและทิศ" meta={<span>{rows.length} จุดข้อมูล</span>}/>
    <div className="time-filter" aria-label="ช่วงเวลาของข้อมูลลม">
      {windWindowOptions.map(([value, label]) =>
        <button className={window === value ? "active" : ""} key={value} onClick={() => onWindowChange(value)}>{label}</button>)}
    </div>
    <div className="wind-data-table">
      <div className="wind-table-head"><span>เวลา</span><span>ความเร็วลม</span><span>ทิศลม</span><span>ชื่อทิศ</span></div>
      {rows.map((row) => <div className="wind-table-row" key={`${row.wind_instrument_cd}-${row.captured_at_ms}`}>
        <span>{bangkokTime(row.captured_at_ms)}</span>
        <span>{number(row.speed_knots)} <small>นอต</small></span>
        <span>{number(row.direction_degree, 0)}°</span>
        <span>{directionName(row.direction_degree)}</span>
      </div>)}
      {!rows.length && <div className="table-empty">รอข้อมูลลมจากทุ่นหลัก</div>}
    </div>
  </section>;
}

function AthleteDirectionTable({athletes, teamMap}: {athletes: AthleteState[]; teamMap: Map<string, Team>}) {
  return <div className="direction-athlete-table">
    <div className="direction-table-head"><span>เลขใบเรือ</span><span>ชื่อ</span><span>COG</span><span>SOG</span><span>ทิศทุ่น − COG</span></div>
    {athletes.map((athlete) => {
      const team = teamMap.get(athlete.team_cd);
      const relative = buoyMinusCog(athlete.relative_signed_degree);
      return <div className="direction-table-row" key={athlete.team_cd}>
        <span><b>{team?.sail_no || "—"}</b></span>
        <span>{team?.team_name || athlete.team_cd.slice(0, 8)}</span>
        <span>{athlete.cog_degree == null ? "—" : `${number(athlete.cog_degree, 0)}°`}</span>
        <span>{athlete.sog_knots == null ? "—" : `${number(athlete.sog_knots)} นอต`}</span>
        <span className={relative == null ? "" : relative >= 0 ? "positive" : "negative"}>
          {relative == null ? "—" : `${relative > 0 ? "+" : ""}${number(relative, 0)}°`}
        </span>
      </div>;
    })}
    {!athletes.length && <div className="table-empty">รอข้อมูลนักกีฬา</div>}
  </div>;
}

function Metric({label, value, sub, icon}: {label: string; value: string; sub: string; icon: React.ReactNode}) {
  return <div className="metric"><span>{icon}{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}
function PanelTitle({icon, title, meta}: {icon: React.ReactNode; title: string; meta: React.ReactNode}) {
  return <div className="panel-title"><div>{icon}<b>{title}</b></div>{meta}</div>;
}
function StatusDot({state, label}: {state: string; label: string}) {
  return <span className={`status-dot ${state}`}><i/>{label}</span>;
}
function HealthRow({label, ok, value}: {label: string; ok: boolean; value: string}) {
  return <div><span>{ok ? <CheckCircle2/> : <AlertTriangle/>}{label}</span><b className={ok ? "ok" : "warn"}>{value}</b></div>;
}
function LoadingState() {
  return <div className="loading-state"><RefreshCw/><p>กำลังโหลดข้อมูลที่ได้รับอนุญาต…</p></div>;
}
function EmptyState() {
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_CONTROL_API_URL;
    if (!api) {
      setBackendStatus("offline");
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);
    void fetch(`${api.replace(/\/$/, "")}/health`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => setBackendStatus(response.ok ? "online" : "offline"))
      .catch(() => setBackendStatus("offline"))
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  const statusText = backendStatus === "checking"
    ? "กำลังตรวจการเชื่อมต่อ…"
    : backendStatus === "online"
      ? "เชื่อมต่อผ่าน Tailscale แล้ว"
      : "เชื่อมต่อไม่ได้ — ตรวจว่าอุปกรณ์เปิด Tailscale";

  return (
    <div className="empty-state">
      <Anchor/>
      <h2>ยังไม่มีรอบที่กำลังแข่งขัน</h2>
      <p>รอบที่รอเริ่มจะอยู่ในหน้าควบคุม และจะแสดงหน้านี้เมื่อ SailFish กดเริ่มการแข่งขัน</p>
      <div className={`backend-connection ${backendStatus}`}>
        <i/>
        <span><b>ระบบเก็บข้อมูล ai-brain</b><small>{statusText}</small></span>
      </div>
      <Link className="empty-action" href="/control">
        ไปหน้าควบคุมการเก็บข้อมูล <ArrowRight/>
      </Link>
    </div>
  );
}
