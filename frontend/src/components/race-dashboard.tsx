"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  Activity, AlertTriangle, Anchor, ArrowRight, CheckCircle2, ChevronDown, CircleGauge, ClipboardCheck,
  Clock3, Compass, Database, Gauge, Globe2, HelpCircle, LocateFixed, LockKeyhole, Play,
  Radio, RefreshCw, RotateCcw, ShieldCheck, SlidersHorizontal, Square, Users, Wind,
} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {bangkokDateTime, bangkokTime, directionName, freshness, mapErrorMessage, number} from "@/lib/format";
import {useVisibleInterval} from "@/lib/use-visible-interval";
import {ReasonDialog} from "@/components/reason-dialog";
import type {
  AthleteState, Collector, HistoryImport, Match, Race, Section, Team, WindState,
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
  settings: ["เผยแพร่สู่สาธารณะ", "เปิด/ปิดการเผยแพร่รายการแข่งขันและประเภทเรือให้บุคคลทั่วไปดู"],
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

const tokenSourceLabel: Record<string, string> = {
  automatic: "อัตโนมัติจาก SailFish",
  environment: "ค่าสำรองใน .env",
  unavailable: "หาไม่ได้",
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
  const [matchFilter, setMatchFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");

  const load = useCallback(async () => {
    if (section === "control" || section === "history" || section === "settings") {
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const {data: raceRows} = await supabase.from("races")
      .select("*,match:matches(name),race_class:race_classes(name)")
      .order("updated_at", {ascending: false});
    const allRaces = (raceRows || []) as unknown as Race[];
    const nextRaces = allRaces.filter((item) => {
      if (section === "live") {
        return item.sailfish_status === "50"
          || (item.sailfish_status === "10" && Boolean(item.collection_enabled));
      }
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
    const [teamResult, athleteResult, windResult, collectorResult, qualityResult, profileResult] = await Promise.all([
      supabase.from("teams").select("*").eq("race_cd", selected),
      supabase.from("live_athlete_state").select("*").eq("race_cd", selected).order("captured_at_ms", {ascending: false}),
      supabase.from("live_wind_state").select("*").eq("race_cd", selected).order("captured_at_ms", {ascending: false}).limit(1).maybeSingle(),
      supabase.from("collector_status").select("*").eq("race_cd", selected).maybeSingle(),
      supabase.from("data_quality_events").select("*").eq("race_cd", selected).order("created_at", {ascending: false}).limit(30),
      user ? supabase.from("profiles").select("role").eq("id", user.id).maybeSingle() : Promise.resolve({data: null}),
    ]);
    setTeams((teamResult.data || []) as Team[]);
    setAthletes((athleteResult.data || []) as AthleteState[]);
    setWind((windResult.data || null) as WindState | null);
    setCollector((collectorResult.data || null) as Collector | null);
    setQuality((qualityResult.data || []) as QualityEvent[]);
    setRole(profileResult.data?.role || "viewer");
    setLoading(false);
  }, [raceCd, section]);

  useEffect(() => { void load(); }, [load]);

  // แทนที่จะ reload ทั้งหมด (races+teams+athletes+wind+collector+quality+profile) ทุกครั้งที่มี event
  // อัปเดตเฉพาะตารางที่เปลี่ยนจริง ลดภาระตอนแข่งจริงที่ event มาถี่ระดับวินาที
  const reloadAthletes = useCallback(async () => {
    if (!raceCd) return;
    const supabase = createClient();
    const {data} = await supabase.from("live_athlete_state").select("*").eq("race_cd", raceCd).order("captured_at_ms", {ascending: false});
    setAthletes((data || []) as AthleteState[]);
  }, [raceCd]);
  const reloadWind = useCallback(async () => {
    if (!raceCd) return;
    const supabase = createClient();
    const {data} = await supabase.from("live_wind_state").select("*").eq("race_cd", raceCd).order("captured_at_ms", {ascending: false}).limit(1).maybeSingle();
    setWind((data || null) as WindState | null);
  }, [raceCd]);
  const reloadCollector = useCallback(async () => {
    if (!raceCd) return;
    const supabase = createClient();
    const {data} = await supabase.from("collector_status").select("*").eq("race_cd", raceCd).maybeSingle();
    setCollector((data || null) as Collector | null);
  }, [raceCd]);

  const [liveChannelHealthy, setLiveChannelHealthy] = useState(false);
  useEffect(() => {
    if (!raceCd) return;
    setLiveChannelHealthy(false);
    const supabase = createClient();
    const channel = supabase.channel(`live:${raceCd}`)
      .on("postgres_changes", {event: "*", schema: "public", table: "live_athlete_state", filter: `race_cd=eq.${raceCd}`}, () => void reloadAthletes())
      .on("postgres_changes", {event: "*", schema: "public", table: "live_wind_state", filter: `race_cd=eq.${raceCd}`}, () => void reloadWind())
      .on("postgres_changes", {event: "*", schema: "public", table: "collector_status", filter: `race_cd=eq.${raceCd}`}, () => void reloadCollector())
      .subscribe((status) => setLiveChannelHealthy(status === "SUBSCRIBED"));
    return () => { void supabase.removeChannel(channel); };
  }, [raceCd, reloadAthletes, reloadWind, reloadCollector]);

  // สำรองไว้เผื่อ Realtime ต่อไม่ติด (เช่นเครือข่ายบล็อก websocket) — poll เฉพาะตอน channel ไม่ healthy เท่านั้น
  useVisibleInterval(() => {
    if (!raceCd || liveChannelHealthy) return;
    void reloadAthletes(); void reloadWind(); void reloadCollector();
  }, 3000);

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

  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">ข้อมูลการแข่งขัน SAILFISH</p><h1>{titles[section][0]}</h1><span>{titles[section][1]}</span></div>
        <div className="race-picker">
          <label>{section === "live" ? "เลือกรอบที่เตรียมหรือกำลังแข่ง" : "เลือกรอบที่กำลังแข่ง"}</label>
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
          {section === "live" && (race.sailfish_status === "50"
            ? <LiveRace race={race} collector={collector} wind={wind} athletes={athletes} teamMap={teamMap}/>
            : <PreparedLiveRace race={race} collector={collector}/>)}
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
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("เลือกหรือค้นหารายการแข่งขัน แล้ว Sync เพื่อดูประเภทเรือและรอบทั้งหมด");
  const [newRaces, setNewRaces] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<{race: Race; action: "start-override" | "stop"} | null>(null);

  const reload = useCallback(async () => {
    const next = await loadWorkspaceData();
    setData(next);
    setMatchCd((current) => {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem("sailfish-control-match") : "";
      return next.matches.some((item) => item.match_cd === current) ? current
        : next.matches.some((item) => item.match_cd === saved) ? saved!
        : next.matches[0]?.match_cd || current;
    });
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useVisibleInterval(() => void reload(), 5000);
  useEffect(() => {
    if (matchCd) window.localStorage.setItem("sailfish-control-match", matchCd);
    setClassFilter("");
  }, [matchCd]);
  const isAdmin = data.role === "admin";

  const options = useMemo(() => {
    const map = new Map(data.matches.map((item) => [item.match_cd, readableMatchName(item.match_cd, item.name, data.races)]));
    discovered.forEach((item) => {
      const discoveredName = readableMatchName(item.matchCd, item.matchName, data.races);
      if (!map.has(item.matchCd) || !discoveredName.startsWith("รายการเดิม")) map.set(item.matchCd, discoveredName);
    });
    return [...map.entries()];
  }, [data.matches, data.races, discovered]);
  const matchRaces = data.races.filter((item) => item.match_cd === matchCd && item.sailfish_status !== "99");
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
      setNotice(`ค้นหาไม่สำเร็จ — ${mapErrorMessage(error)}`);
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
      setNotice(`อัปเดตแล้ว ${incoming.length} รอบ · รอเริ่ม ${body.waiting?.length || 0} · กำลังแข่ง ${body.active?.length || 0} · จบแล้ว ${body.finished?.length || 0} · เตรียมเก็บข้อมูลอัตโนมัติแล้ว ${body.armed?.length || 0} รอบ`);
      await reload();
    } catch (error) {
      setNotice(`Sync ไม่สำเร็จ — ${mapErrorMessage(error)}`);
    } finally { setBusy(""); }
  }

  async function runRoundAction(race: Race, action: "arm" | "start-override" | "stop" | "retry", reason: string) {
    setBusy(race.race_cd);
    try {
      await adminRequest(`/collectors/${race.race_cd}/${action}`, {method: "POST", body: JSON.stringify({reason})});
      setNotice(`${actionName[action]} ${classNameOf(race)} ${race.rounds || ""} สำเร็จ`);
      await reload();
    } catch (error) {
      setNotice(`สั่งงานไม่สำเร็จ — ${mapErrorMessage(error)}`);
    } finally { setBusy(""); }
  }

  function roundAction(race: Race, action: "arm" | "start-override" | "stop" | "retry") {
    if (action === "start-override" || action === "stop") {
      setPendingAction({race, action});
      return;
    }
    void runRoundAction(race, action, "สั่งงานจากหน้าควบคุม");
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
      setNotice(`ตั้งค่า Public ไม่สำเร็จ — ${mapErrorMessage(error)}`);
    } finally { setBusy(""); }
  }

  if (loading) return <LoadingState/>;

  return <div className="match-workspace">
    {pendingAction && <ReasonDialog
      title={`${actionName[pendingAction.action]} · ${classNameOf(pendingAction.race)} ${pendingAction.race.rounds || ""}`}
      description="ระบุเหตุผลที่สั่งงานนี้ เพื่อบันทึกไว้ตรวจสอบภายหลัง"
      confirmLabel="ยืนยันคำสั่ง"
      onCancel={() => setPendingAction(null)}
      onConfirm={(reason) => {
        const {race, action} = pendingAction;
        setPendingAction(null);
        void runRoundAction(race, action, reason);
      }}
    />}
    <section className="panel match-toolbar">
      <div className="control-lock"><LockKeyhole/><div><b>ควบคุมผ่าน TAILSCALE</b><span>เลือกรายการแข่งขันก่อน แล้วจัดการแต่ละรอบแยกกัน</span></div></div>
      {!isAdmin && <div className="role-notice"><ShieldCheck/> เฉพาะผู้ดูแลระบบ (admin) เท่านั้นที่สั่งเริ่ม/หยุดการเก็บข้อมูลได้ — บัญชีนี้ดูสถานะได้อย่างเดียว</div>}
      <div className="match-picker-row">
        <label>รายการแข่งขัน<select value={matchCd} onChange={(event) => setMatchCd(event.target.value)}>
          {!options.length && <option value="">ยังไม่มีรายการ</option>}
          {options.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select></label>
        <button disabled={Boolean(busy) || !isAdmin} onClick={discoverMatches}><Database/> ค้นหารายการ</button>
        <button className="primary-match-action" disabled={Boolean(busy) || !matchCd || !isAdmin} onClick={syncMatch}><RefreshCw/> {busy === "sync" ? "กำลัง Sync…" : matchRaces.length ? "Sync หารอบใหม่" : "นำเข้ารายการ"}</button>
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
          {isAdmin ? (
            <button className={scopeEnabled ? "enabled" : ""} disabled={Boolean(busy)} onClick={togglePublicScope}>
              <ShieldCheck/> {scopeEnabled ? `ปิดหน้าสาธารณะ · ${scopeLabel}` : `เปิดหน้าสาธารณะ · ${scopeLabel}`}
            </button>
          ) : <span className="finished-copy">ต้องเป็นผู้ดูแลระบบ</span>}
        </div>
      </div>
      {groups.map(([levelCd, label]) => <section className="panel class-race-group" key={levelCd}>
        <PanelTitle icon={<Users/>} title={label} meta={<span>{visible.filter((item) => (item.level_cd || "") === levelCd).length} รอบ</span>}/>
        {visible.filter((item) => (item.level_cd || "") === levelCd).map((race) => {
          const status = collectorMap.get(race.race_cd);
          const running = race.collection_enabled || Boolean(status && !["idle", "completed", "error"].includes(status.state));
          return <div className="round-control-row" key={race.race_cd}>
            <div><b>{race.rounds || race.name || "ไม่ระบุรอบ"}</b><span>{raceStatusLabel[race.sailfish_status || ""] || "ไม่ทราบสถานะ"} · {bangkokDateTime(race.start_at)}</span></div>
            <div className="round-badges">{newRaces.has(race.race_cd) && <i className="new-badge">รอบใหม่</i>}<i className={`race-status status-${race.sailfish_status}`}>{collectorState[status?.state || "idle"]}</i></div>
            <div className="round-actions">
              {!isAdmin ? <span className="finished-copy">ต้องเป็นผู้ดูแลระบบจึงจะสั่งงานได้</span>
                : <>
                  {!running && <button disabled={busy === race.race_cd} onClick={() => roundAction(race, "arm")}><Radio/> เตรียมเก็บข้อมูล</button>}
                  {running && <>
                    <button disabled={busy === race.race_cd} onClick={() => roundAction(race, "start-override")}><Play/> เริ่มด้วยตนเอง</button>
                    <button disabled={busy === race.race_cd} onClick={() => roundAction(race, "retry")}><RefreshCw/> ลองใหม่</button>
                    <button className="danger" disabled={busy === race.race_cd} onClick={() => roundAction(race, "stop")}><Square/> หยุด</button>
                  </>}
                </>}
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
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const next = await loadWorkspaceData();
    setData(next);
    setMatchCd((current) => next.matches.some((item) => item.match_cd === current)
      ? current
      : next.matches[0]?.match_cd || "");
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useVisibleInterval(() => void reload(), 5000);
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
    } catch (error) { setNotice(`นำเข้าไม่สำเร็จ — ${mapErrorMessage(error)}`); }
    finally { setBusy(false); }
  }

  async function discoverMatches() {
    setBusy(true);
    try {
      const body = await adminRequest("/races/discover");
      setNotice(`โหลดรายการแข่งขันจาก SailFish แล้ว ${body.total ?? body.items?.length ?? 0} รายการ`);
      await reload();
    } catch (error) {
      setNotice(`โหลดรายการแข่งขันไม่สำเร็จ — ${mapErrorMessage(error)}`);
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
      setNotice(`โหลดประเภทและรอบแล้ว ${body.items?.length || 0} รอบ · จบแล้ว ${body.finished?.length || 0} รอบ · เตรียมเก็บข้อมูลอัตโนมัติแล้ว ${body.armed?.length || 0} รอบ`);
      await reload();
    } catch (error) {
      setNotice(`โหลดประเภทและรอบไม่สำเร็จ — ${mapErrorMessage(error)}`);
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
      setNotice(`ตั้งค่าหน้าสาธารณะไม่สำเร็จ — ${mapErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState/>;

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
          <label>{selectable && <input type="checkbox" checked={selected.has(race.race_cd)} onChange={(event) => setSelected((current) => {const next = new Set(current); event.target.checked ? next.add(race.race_cd) : next.delete(race.race_cd); return next;})}/>}<span><b>{classNameOf(race)} · {race.rounds || "ไม่ระบุรอบ"}</b><small>{bangkokDateTime(race.end_at)}</small></span></label>
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    const next = await loadWorkspaceData();
    setData(next);
    setMatchCd((current) => next.matches.some((item) => item.match_cd === current) ? current : next.matches[0]?.match_cd || "");
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useVisibleInterval(() => void reload(), 10000);
  const match = data.matches.find((item) => item.match_cd === matchCd);
  const races = data.races.filter((item) => item.match_cd === matchCd);
  const imports = new Map(data.imports.map((item) => [item.race_cd, item]));
  const groups = [...new Map(races.map((item) => [item.level_cd || "", classNameOf(item)])).entries()];
  const isAdmin = data.role === "admin";
  async function toggle() {
    if (!match) return;
    setBusy(true);
    try {
      await adminRequest(`/matches/${match.match_cd}/visibility`, {method: "POST", body: JSON.stringify({is_public: !match.is_public})});
      setNotice(!match.is_public ? "เปิดเผยรายการและทุกประเภทเรือแล้ว" : "ปิดเผยแพร่รายการแล้ว");
      await reload();
    } catch (error) { setNotice(`บันทึกไม่สำเร็จ — ${mapErrorMessage(error)}`); }
    finally { setBusy(false); }
  }
  if (loading) return <LoadingState/>;
  return <div className="publishing-workspace">
    {!isAdmin && <div className="role-notice"><ShieldCheck/> เฉพาะผู้ดูแลระบบ (admin) เท่านั้นที่เปลี่ยนสิทธิ์เผยแพร่ได้ — บัญชีนี้ดูสถานะได้อย่างเดียว</div>}
    <section className="panel match-toolbar">
      <div className="match-picker-row"><label>รายการแข่งขัน<select value={matchCd} onChange={(event) => setMatchCd(event.target.value)}>{data.matches.map((item) => <option value={item.match_cd} key={item.match_cd}>{item.name}</option>)}</select></label></div>
    </section>
    {match && <section className="panel publishing-master">
      <div><ShieldCheck/><span><b>{match.name}</b><small>เมื่อเปิด ทุกประเภทเรือในรายการนี้จะเผยแพร่โดยอัตโนมัติ</small></span></div>
      {isAdmin && <button className={match.is_public ? "enabled" : ""} disabled={busy} onClick={toggle}>{match.is_public ? "กำลังเผยแพร่ · กดเพื่อปิด" : "เปิดเผยรายการนี้"}</button>}
    </section>}
    {notice && <div className="control-notice">{notice}</div>}
    {groups.map(([levelCd, label]) => <section className="panel class-race-group" key={levelCd}>
      <PanelTitle icon={<Users/>} title={label} meta={<span>แสดงสถานะเท่านั้น</span>}/>
      {races.filter((item) => (item.level_cd || "") === levelCd).map((race) => {
        const job = imports.get(race.race_cd);
        return <div className="settings-status-row" key={race.race_cd}><b>{race.rounds || race.name || "ไม่ระบุรอบ"}</b><i className={`race-status status-${race.sailfish_status}`}>{raceStatusLabel[race.sailfish_status || ""] || "ไม่ทราบสถานะ"}</i><span>{race.history_imported_at ? "พร้อมดูย้อนหลัง" : job?.status === "running" ? `กำลังนำเข้า ${number(job.progress_percent, 0)}%` : race.sailfish_status === "99" ? "รอนำเข้าข้อมูลย้อนหลัง" : "ข้อมูลสดตามสถานะรอบ"}</span></div>;
      })}
    </section>)}
    <UsageGuide isAdmin={isAdmin}/>
  </div>;
}

function GuideSection({icon, title, defaultOpen, children}: {
  icon: React.ReactNode; title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  return <details className="guide-section" open={defaultOpen}>
    <summary>{icon}<span>{title}</span><ChevronDown className="guide-caret"/></summary>
    <div className="guide-body">{children}</div>
  </details>;
}

function UsageGuide({isAdmin}: {isAdmin: boolean}) {
  return <section className="panel usage-guide">
    <PanelTitle icon={<HelpCircle/>} title="วิธีการใช้งานแต่ละหน้า" meta={<span>คู่มือฉบับละเอียด</span>}/>
    <div className="guide-intro">
      <p>คู่มือนี้อธิบายทุกหน้าของระบบ ทั้งหน้าที่ต้องเข้าสู่ระบบ (เมนูด้านซ้าย) และหน้าสาธารณะที่ใครก็เปิดดูได้โดยไม่ต้อง Login กดที่หัวข้อเพื่อขยายดูรายละเอียดของแต่ละหน้า</p>
      <p>ข้อมูลทุกอย่างในระบบเก็บเป็น <b>เวลาสากล (UTC)</b> แต่หน้าจอทุกหน้าจะแปลงและแสดงเป็น <b>เวลาไทย</b> ให้อัตโนมัติเสมอ</p>
    </div>

    <GuideSection icon={<CircleGauge/>} title="1. ภาพรวมการแข่งขัน (Overview)" defaultOpen>
      <p>หน้าแรกที่เห็นหลัง Login เป็นสรุปภาพรวมของรอบที่เลือกไว้ด้านบน (เลือกรอบได้จากช่อง “เลือกรอบที่กำลังแข่ง” มุมขวาบนของหน้า)</p>
      <ul>
        <li><b>แถบสถานะบนสุด</b> — ชื่อการแข่งขัน รอบ จำนวนนักกีฬา และสถานะปัจจุบันของระบบเก็บข้อมูล (ยังไม่เริ่ม / เตรียมพร้อม / กำลังเก็บข้อมูล / จบแล้ว)</li>
        <li><b>การ์ดตัวเลขสามช่อง</b> — จำนวนนักกีฬาที่ข้อมูลยังสดอยู่ (ไม่เกิน 5 วินาที), จำนวนข้อความที่รับมาทั้งหมดจาก SailFish และจำนวนครั้งที่เชื่อมต่อใหม่, สถานะรอบตามที่ SailFish รายงาน</li>
        <li><b>การ์ดลมจากทุ่นหลัก</b> — เข็มทิศแสดงทิศทางที่ลมพัดมา ความเร็วลมล่าสุด และเวลาที่อัปเดต</li>
        <li><b>ตารางข้อมูลนักกีฬาล่าสุด</b> — แสดง 7 คนแรก พร้อมทิศทาง มุมเทียบลม และ VMC ถ้ามีมากกว่านั้นกด “ดูนักกีฬาทั้งหมด” เพื่อไปหน้าการแข่งขันสด</li>
        <li><b>สถานะระบบเก็บข้อมูล</b> — เช็คว่าการควบคุมผ่าน Tailscale ปกติไหม ช่องรับข้อมูลสดเชื่อมต่ออยู่ไหม ข้อมูลล่าสุดมาเมื่อไหร่ และการแปลข้อมูล (decoder) มีปัญหาหรือไม่ ใช้หน้านี้เป็นจุดแรกในการเช็คสุขภาพระบบก่อนแข่งเสมอ</li>
      </ul>
    </GuideSection>

    <GuideSection icon={<Radio/>} title="2. การแข่งขันสด (Live)">
      <p>ใช้ระหว่างรอบกำลังแข่งขันจริง (สถานะ SailFish = “กำลังแข่งขัน”) ถ้ารอบยังไม่เริ่ม หน้านี้จะแสดงสถานะการเตรียมพร้อมแทน (ดูหัวข้อ “ก่อนเริ่มแข่ง” ด้านล่าง)</p>
      <ul>
        <li><b>แผนที่สนามแข่งขัน</b> — ตำแหน่งนักกีฬาทุกคนและทุ่นลมแบบเรียลไทม์ หัวลูกศรของแต่ละลำหมุนตามทิศทางการเคลื่อนที่ (COG) จริง</li>
        <li><b>ตารางลมและทิศ</b> — เลือกช่วงเวลาย้อนหลังที่จะแสดง (3 / 5 / 9 / 15 นาที) มีค่าเฉลี่ยความเร็วและทิศลมของช่วงที่เลือกกำกับไว้ด้านบนตาราง</li>
        <li><b>ตารางทิศของนักกีฬาแต่ละคน</b> — เทียบ COG ของแต่ละคนกับทิศลมจริง (ปรับให้อยู่ระหว่าง −180° ถึง 180° เพื่อดูง่ายว่าใครอยู่ฝั่งซ้าย/ขวาของลม) พร้อมค่า VMC (ความเร็วมุ่งสู่เส้นชัย หน่วยนอต)</li>
        <li><b>ก่อนเริ่มแข่ง (สถานะ “เตรียมพร้อม” หรือ “รอเริ่มการแข่งขัน”)</b> — หน้านี้จะโชว์แถบความคืบหน้า (เตรียมพร้อม → รอเริ่ม → กำลังเก็บข้อมูล) และสถานะช่องรับข้อมูลสด เมื่อ SailFish เปลี่ยนเป็น “กำลังแข่งขัน” แผนที่และตารางทั้งหมดจะเปิดให้เองโดยอัตโนมัติ ไม่ต้องรีเฟรชหน้า</li>
      </ul>
    </GuideSection>

    <GuideSection icon={<Clock3/>} title="3. ผลการแข่งขันย้อนหลัง (History)">
      <p>ใช้ดูข้อมูลของรอบที่จบไปแล้ว ต้อง “นำเข้าข้อมูลย้อนหลัง” ก่อนถึงจะเปิดดูได้ (ผู้ดูแลเท่านั้นที่นำเข้าได้ สมาชิกทั่วไปดูได้อย่างเดียว)</p>
      <p><b>ขั้นตอนการดู:</b></p>
      <ol>
        <li>เลือก “รายการแข่งขัน” จากช่องด้านบน — ถ้ายังไม่มีในลิสต์ ผู้ดูแลกด “โหลดรายการจาก SailFish” ก่อน</li>
        <li>กด “โหลดประเภทและรอบ” เพื่อดึงรอบทั้งหมดของรายการนั้นมาแสดง</li>
        <li>เลือกประเภทเรือที่ต้องการ (จะเห็นเฉพาะประเภทที่มีรอบจบแล้วอย่างน้อยหนึ่งรอบ)</li>
        <li>ถ้ารอบไหนยังไม่ได้นำเข้า ผู้ดูแลกด “นำเข้ารอบนี้” (หรือ “นำเข้าทั้ง…” เพื่อนำเข้าหลายรอบพร้อมกัน) ระบบจะดึงข้อมูลตำแหน่ง ความเร็ว และคำนวณ VMC ให้ทุกจุดข้อมูลโดยอัตโนมัติ ใช้เวลาสักครู่ตามความยาวของรอบ</li>
        <li>เมื่อขึ้น “พร้อมดูย้อนหลัง” กด “เปิดดูย้อนหลัง” เพื่อเข้าสู่ตัวเล่นข้อมูล</li>
      </ol>
      <p><b>ตัวเล่นข้อมูลย้อนหลัง:</b></p>
      <ul>
        <li>เลือกนักกีฬาจากรายชื่อด้านขวาเพื่อดูเส้นทางของคนนั้น</li>
        <li>กดปุ่ม <b>▶ เล่น</b> เพื่อไล่ดูตำแหน่งทีละวินาทีบนแผนที่ กดซ้ำเพื่อหยุดชั่วคราว ปุ่ม <b>↺</b> กลับไปจุดเริ่มต้นของรอบ</li>
        <li>ลากแถบเวลา (timeline) เพื่อกระโดดไปจุดเวลาที่ต้องการได้ทันที และปรับความเร็วการเล่นได้ (0.5×, 1×, 2×, 5×)</li>
        <li>ผู้ดูแลกด “ดาวน์โหลดตารางข้อมูล” มุมขวาบนของกล่องเล่นข้อมูล เพื่อส่งออกเป็นไฟล์ CSV ของทุกคนในรอบนั้น (มีบันทึกการดาวน์โหลดไว้ในระบบเพื่อตรวจสอบย้อนหลังได้)</li>
      </ul>
    </GuideSection>

    <GuideSection icon={<Users/>} title="4. เปรียบเทียบนักกีฬา (Compare)">
      <p>เลือกนักกีฬาได้สูงสุด 4 คนพร้อมกัน จากรายชื่อในรอบที่กำลังเลือกอยู่ (ใช้ได้ทั้งตอนแข่งสดและดูย้อนหลัง) แต่ละคนจะแสดงเป็นการ์ดแยกกัน มีสีขอบต่างกันให้แยกง่าย ในการ์ดจะเห็นทิศทางการเคลื่อนที่ (COG) มุมเส้นทางเทียบลม และ VMC ของแต่ละคน ณ เวลาล่าสุด ใช้เปรียบเทียบกลยุทธ์การแล่นระหว่างนักกีฬาได้ทันที</p>
    </GuideSection>

    {isAdmin && <GuideSection icon={<SlidersHorizontal/>} title="5. ควบคุมการเก็บข้อมูล (Control) — เฉพาะผู้ดูแล">
      <p>หน้านี้ควบคุมว่าระบบจะเริ่ม/หยุดเก็บข้อมูลจาก SailFish ของแต่ละรอบเมื่อไหร่ ทำงานผ่านเครื่องเก็บข้อมูล (ai-brain) ที่เชื่อมต่อผ่าน Tailscale เท่านั้น</p>
      <ul>
        <li><b>โหลดรายการจาก SailFish</b> — ดึงรายชื่อการแข่งขันทั้งหมดในบัญชี SailFish มาแสดง</li>
        <li><b>โหลดประเภทและรอบ</b> — ดึงประเภทเรือและทุกรอบของรายการที่เลือกไว้</li>
        <li><b>เตรียมเก็บข้อมูล (arm)</b> — สั่งให้ระบบเริ่มเฝ้ารอรอบนี้ พร้อมเชื่อมต่อรับข้อมูลทันทีที่ SailFish เริ่มแข่งจริง</li>
        <li><b>เริ่มเก็บข้อมูลด้วยตนเอง</b> — ใช้เมื่อสถานะจาก SailFish ผิดปกติหรือมาช้า ต้องระบุเหตุผลทุกครั้งก่อนยืนยัน (บันทึกไว้ตรวจสอบย้อนหลังได้)</li>
        <li><b>หยุดเก็บข้อมูล</b> — หยุดการเก็บข้อมูลของรอบนั้นทันที ต้องระบุเหตุผลเช่นกัน</li>
        <li><b>ลองใหม่ (retry)</b> — ใช้เมื่อการเชื่อมต่อมีปัญหาซ้ำๆ เพื่อเริ่มเชื่อมต่อใหม่ตั้งแต่ต้น</li>
        <li><b>เปิด/ปิดหน้าสาธารณะตามขอบเขต</b> — เลือกได้ว่าจะเปิดให้บุคคลทั่วไปดู “ทุกประเภท” หรือ “เฉพาะประเภทที่เลือกอยู่” ของรายการนั้น (แยกจากสวิตช์ในหน้า “เผยแพร่สู่สาธารณะ” ซึ่งเป็นสวิตช์ระดับรายการทั้งหมด)</li>
      </ul>
    </GuideSection>}

    {isAdmin && <GuideSection icon={<ClipboardCheck/>} title="6. ตรวจสอบคุณภาพข้อมูล (Quality) — เฉพาะผู้ดูแล">
      <p>ใช้เฝ้าระวังปัญหาการเก็บ/แปลข้อมูลของรอบที่เลือกไว้</p>
      <ul>
        <li><b>ตัวเลขสรุปด้านบน</b> — จำนวนครั้งที่เชื่อมต่อใหม่ในรอบนี้, จำนวนปัญหาที่ยังไม่ได้ตรวจ, จำนวนนักกีฬาที่ข้อมูลล่าช้าเกิน 5 วินาที, จำนวนอุปกรณ์ GPS ที่ถูกใช้ซ้ำกันมากกว่าหนึ่งคน (ควรเป็น 0 เสมอ ถ้าไม่ใช่ให้ตรวจสอบการผูกอุปกรณ์กับนักกีฬาใน SailFish)</li>
        <li><b>รายการปัญหาคุณภาพข้อมูล</b> — Log ปัญหาทั้งหมด 30 รายการล่าสุด เช่น พบข้อมูลที่แปลไม่ได้ ช่วงเวลาที่ข้อมูลขาดหาย หรือช่องรับข้อมูลสดเชื่อมต่อใหม่ พร้อมเวลาที่เกิดและรายละเอียดทางเทคนิคสำหรับผู้ดูแล</li>
      </ul>
    </GuideSection>}

    {isAdmin && <GuideSection icon={<Globe2/>} title="7. เผยแพร่สู่สาธารณะ (Settings) — หน้านี้">
      <p>ควบคุมว่าใครก็ตามที่ไม่ได้ Login (ผ่านหน้าเว็บสาธารณะ <code>/public</code>) จะเห็นรายการแข่งขันไหนได้บ้าง</p>
      <ul>
        <li><b>สวิตช์ระดับรายการ</b> (การ์ดด้านบน) — เปิดแล้วทุกประเภทเรือในรายการนั้นจะเผยแพร่โดยอัตโนมัติทันที</li>
        <li><b>รายการสถานะรายรอบ</b> ด้านล่าง — แสดงสถานะของแต่ละรอบเท่านั้น (สถานะจาก SailFish และความพร้อมของข้อมูลย้อนหลัง) ไม่มีสวิตช์แยกรายรอบในหน้านี้ — ถ้าต้องการเปิดเฉพาะบางประเภทเรือ ให้ไปใช้ “เปิด/ปิดหน้าสาธารณะตามขอบเขต” ในหน้าควบคุมการเก็บข้อมูลแทน</li>
        <li>เมื่อรอบไหนจบแล้ว (สถานะ 99) การถ่ายทอดสดของรอบนั้นจะหยุดให้บุคคลทั่วไปดูโดยอัตโนมัติ จนกว่าจะนำเข้าข้อมูลย้อนหลังและเปิดให้ดูย้อนหลังแยกต่างหาก</li>
      </ul>
    </GuideSection>}

    <GuideSection icon={<Globe2/>} title="8. หน้าเว็บสาธารณะ (/public) — ไม่ต้อง Login">
      <p>หน้านี้แยกจากหน้าที่เหลือทั้งหมด เปิดดูได้จากลิงก์ <code>/public</code> โดยไม่ต้องมีบัญชีผู้ใช้ ออกแบบมาให้ผู้ชมทั่วไป โค้ช หรือผู้ปกครองติดตามการแข่งขันได้ <b>โดยไม่เปิดเผยพิกัด GPS ที่แท้จริงของเรือ</b> — เห็นได้เฉพาะรายการ ประเภทเรือ และรอบที่ผู้ดูแลเปิดอนุญาตไว้เท่านั้น</p>
      <ul>
        <li><b>แท็บ “ถ่ายทอดสด”</b> — เลือกรายการ / ประเภทเรือ / รอบ จากตัวกรองด้านบน จะเห็นสถานะระบบติดตาม GPS, ตารางลมและทิศ (เลือกช่วงเวลาได้), และตารางทิศของนักกีฬาแต่ละคนพร้อม VMC อัปเดตให้เองแบบเรียลไทม์ผ่าน Realtime (ไม่ต้องกดรีเฟรช)</li>
        <li><b>แท็บ “ย้อนหลัง”</b> — แสดงเฉพาะรอบที่จบแล้วและผู้ดูแลเปิดให้ดูย้อนหลัง เลือกนักกีฬาจากรายชื่อด้านซ้าย จะเห็นค่าล่าสุดของรอบนั้นก่อน แล้วใช้ปุ่ม <b>▶ เล่น</b> หรือ<b>ลากแถบเวลา</b>ใต้ตัวเลขเพื่อไล่ดูค่า COG / ลม / มุมเทียบลม / VMC ที่จุดเวลาต่างๆ ตลอดทั้งรอบ พร้อมจุดชี้ตำแหน่งบนกราฟความเร็ว (ไม่มีแผนที่หรือพิกัด ตามนโยบายความเป็นส่วนตัว)</li>
        <li>ตัวกรอง “รายการ / ประเภทเรือ / รอบ” ที่มุมบนใช้แคบขอบเขตการค้นหาได้ ถ้าเปลี่ยนรายการหรือประเภทแล้วไม่มีรอบให้เลือก แปลว่าผู้ดูแลยังไม่ได้เปิดเผยแพร่ประเภทนั้น</li>
      </ul>
    </GuideSection>

    <GuideSection icon={<Gauge/>} title="คำศัพท์ที่พบในทุกหน้า">
      <ul>
        <li><b>SOG</b> (Speed Over Ground) — ความเร็วเหนือพื้นจาก GPS หน่วยนอต</li>
        <li><b>COG</b> (Course Over Ground) — ทิศทางการเคลื่อนที่จริงของเรือจาก GPS <i>ไม่ใช่</i>ทิศหัวเรือ</li>
        <li><b>มุมเส้นทางเทียบลม</b> — ผลต่างระหว่าง COG กับทิศทางลมจริง ปรับให้อยู่ระหว่าง −180° ถึง 180° เพื่อดูง่ายว่าเรืออยู่ฝั่งซ้ายหรือขวาของลม</li>
        <li><b>VMC</b> (Velocity Made good on Course) — องค์ประกอบของความเร็วที่มุ่งตรงเข้าหาเส้นชัยจริงๆ (ไม่ใช่ความเร็วรวม SOG) ค่าบวกแปลว่ากำลังเข้าใกล้เส้นชัย ค่าลบแปลว่ากำลังห่างออก เป็นตัวชี้วัดที่มีค่าต่อเนื่องเกือบตลอดทั้งรอบ ต่างจากการวัดเทียบทุ่นกลางคอร์สที่บางช่วงอาจไม่มีข้อมูลพิกัดทุ่นให้คำนวณ</li>
      </ul>
    </GuideSection>
  </section>;
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
          {athletes.length > 7 && <Link className="view-all-link" href="/live">ดูนักกีฬาทั้งหมด {athletes.length} คน <ArrowRight size={14}/></Link>}
        </section>
        <section className="panel health-panel">
          <PanelTitle icon={<ShieldCheck/>} title="สถานะระบบเก็บข้อมูล" meta={null}/>
          <div className="health-list">
            <HealthRow label="การควบคุมผ่าน Tailscale" ok={true} value="ส่วนตัว"/>
            <HealthRow label="ช่องรับข้อมูลสด" ok={Boolean(collector?.websocket_connected)} value={collector?.websocket_connected ? "เชื่อมต่อแล้ว" : "ไม่ได้เชื่อมต่อ"}/>
            <HealthRow label="ข้อมูลล่าสุด" ok={freshness(collector?.last_message_at).className === "live"} value={bangkokDateTime(collector?.last_message_at)}/>
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
  const [windWindow, setWindWindow] = useState<WindWindow>("3");
  const [windRows, setWindRows] = useState<WindState[]>([]);
  const [windChannelHealthy, setWindChannelHealthy] = useState(false);

  const loadWind = useCallback(async () => {
    const supabase = createClient();
    let query = supabase.from("wind_readings")
      .select("race_cd,wind_instrument_cd,captured_at_ms,speed_knots,direction_degree,latitude,longitude,created_at")
      .eq("race_cd", race.race_cd)
      .gte("captured_at_ms", Date.now() - windWindowMs(windWindow))
      .order("captured_at_ms", {ascending: false})
      .limit(1200);
    if (race.main_wind_instrument_cd) query = query.eq("wind_instrument_cd", race.main_wind_instrument_cd);
    const {data} = await query;
    const rows = ((data || []) as Array<Omit<WindState, "updated_at"> & {created_at: string}>)
      .map(({created_at, ...row}) => ({...row, updated_at: created_at}));
    setWindRows(rows.length ? rows : wind ? [wind] : []);
  }, [race.main_wind_instrument_cd, race.race_cd, wind, windWindow]);
  useEffect(() => { void loadWind(); }, [loadWind]);

  // Realtime: ต่อแถวลมใหม่เข้า windRows ทันทีที่ collector เขียนลง DB แทนการ query ใหม่ทั้งก้อนทุก 2 วินาที
  useEffect(() => {
    setWindChannelHealthy(false);
    const supabase = createClient();
    const channel = supabase.channel(`wind-readings:${race.race_cd}`)
      .on("postgres_changes", {event: "INSERT", schema: "public", table: "wind_readings", filter: `race_cd=eq.${race.race_cd}`}, (payload) => {
        const row = payload.new as Omit<WindState, "updated_at"> & {created_at: string};
        if (race.main_wind_instrument_cd && row.wind_instrument_cd !== race.main_wind_instrument_cd) return;
        setWindRows((current) => {
          const cutoff = Date.now() - windWindowMs(windWindow);
          const next = [{...row, updated_at: row.created_at}, ...current.filter((item) => item.captured_at_ms !== row.captured_at_ms)];
          return next.filter((item) => item.captured_at_ms >= cutoff).slice(0, 1200);
        });
      })
      .subscribe((status) => setWindChannelHealthy(status === "SUBSCRIBED"));
    return () => { void supabase.removeChannel(channel); };
  }, [race.race_cd, race.main_wind_instrument_cd, windWindow]);

  // สำรองไว้เผื่อ Realtime ต่อไม่ติด
  useVisibleInterval(() => { if (!windChannelHealthy) void loadWind(); }, 3000);

  return (
    <div className="live-layout">
      <section className="panel race-map-panel">
        <PanelTitle icon={<LocateFixed/>} title={`${race.name || "การแข่งขัน"} · สนามแข่งขัน`} meta={<StatusDot state={collector?.websocket_connected ? "live" : "offline"} label={collector?.websocket_connected ? "กำลังรับข้อมูล" : "ไม่ได้เชื่อมต่อ"}/>}/>
        <RaceMap athletes={athletes} wind={wind} teamMap={teamMap}/>
      </section>
      <WindTable rows={windRows} window={windWindow} onWindowChange={setWindWindow}/>
      <section className="panel telemetry-table-panel">
        <PanelTitle icon={<Users/>} title="ทิศของนักกีฬาแต่ละคน" meta={<span>คำนวณจาก COG เทียบทิศลมจริง</span>}/>
        <AthleteDirectionTable athletes={athletes} teamMap={teamMap}/>
      </section>
    </div>
  );
}

function PreparedLiveRace({race, collector}: {race: Race; collector: Collector | null}) {
  const websocketReady = Boolean(collector?.websocket_connected);
  return <div className="control-layout">
    <section className="panel control-main">
      <div className="control-lock">
        <Radio/>
        <div><b>เตรียมเก็บข้อมูลแล้ว</b><span>ระบบกำลังรอเจ้าของสนามกดเริ่มการแข่งขันใน SailFish</span></div>
      </div>
      <h2>{race.name || "การแข่งขัน"} · {race.rounds || "รอบปัจจุบัน"}</h2>
      <div className="state-flow">
        {["armed", "waiting_for_start", "recording"].map((state) =>
          <span className={collector?.state === state ? "current" : ""} key={state}>{collectorState[state]}</span>)}
      </div>
      <p className="waiting-copy">เมื่อ SailFish เปลี่ยนเป็น “กำลังแข่งขัน” หน้านี้จะเปิดแผนที่ ลม และข้อมูลนักกีฬาให้อัตโนมัติ</p>
      {!websocketReady && <div className="control-notice">
        ช่องรับข้อมูลสดยังไม่เชื่อมต่อ
        {collector?.token_source === "unavailable" && " — ระบบหา Live token อัตโนมัติไม่สำเร็จและไม่มีค่า fallback"}
        {collector?.websocket_last_error && ` — ${collector.websocket_last_error}`}
      </div>}
    </section>
    <section className="panel control-status">
      <PanelTitle icon={<ShieldCheck/>} title="ความพร้อมของข้อมูลสด" meta={null}/>
      <dl>
        <div><dt>สถานะ SailFish</dt><dd>{raceStatusLabel[race.sailfish_status || ""] || "ไม่ทราบสถานะ"}</dd></div>
        <div><dt>สถานะ Collector</dt><dd>{collectorState[collector?.state || "idle"]}</dd></div>
        <div><dt>ช่องรับข้อมูลสด</dt><dd>{websocketReady ? "เชื่อมต่อแล้ว" : "ยังไม่เชื่อมต่อ"}</dd></div>
        <div><dt>ที่มาของ Live token</dt><dd>{tokenSourceLabel[collector?.token_source || ""] || "ไม่ทราบ"}</dd></div>
        <div><dt>ช่องทางข้อมูล</dt><dd>{collector?.transport_mode === "snapshot_fallback" ? "Snapshot สำรอง (WebSocket มีปัญหา)" : "WebSocket"}</dd></div>
        <div><dt>จำนวนการเชื่อมต่อใหม่</dt><dd>{collector?.reconnects || 0}</dd></div>
        <div><dt>ข้อความที่ได้รับ</dt><dd>{collector?.messages_received || 0}</dd></div>
        <div><dt>ข้อความล่าสุด</dt><dd>{bangkokDateTime(collector?.last_message_at)}</dd></div>
      </dl>
    </section>
  </div>;
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
    if (race.archived_at) {
      void adminRequest(`/archive/athlete-history?race_cd=${race.race_cd}&team_cd=${selectedTeam}`)
        .then((data: Array<AthleteState & {created_at: string}>) => {
          setReadings((data || []).map((row) => ({...row, updated_at: row.created_at})));
          setCursor(0);
        });
      return;
    }
    const supabase = createClient();
    void supabase.from("athlete_readings")
      .select("race_cd,team_cd,captured_at_ms,sog_knots,cog_degree,latitude,longitude,relative_signed_degree,relative_angle_degree,upwind_vmg_knots,vmc_knots,created_at")
      .eq("race_cd", race.race_cd)
      .eq("team_cd", selectedTeam)
      .order("captured_at_ms", {ascending: true})
      .limit(10000)
      .then(({data}) => {
        setReadings(((data || []) as unknown as AthleteState[]).map((row) => ({...row, updated_at: (row as unknown as {created_at: string}).created_at})));
        setCursor(0);
      });
  }, [race.race_cd, race.archived_at, selectedTeam]);
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
    let rows: Record<string, unknown>[];
    if (race.archived_at) {
      const perTeam = await Promise.all(teams.map((team) =>
        adminRequest(`/archive/athlete-history?race_cd=${race.race_cd}&team_cd=${team.team_cd}`)
          .catch(() => []) as Promise<Record<string, unknown>[]>));
      rows = perTeam.flat();
    } else {
      const {data} = await supabase.from("athlete_readings")
        .select("team_cd,captured_at_ms,sog_knots,cog_degree,latitude,longitude,relative_signed_degree,relative_angle_degree,upwind_vmg_knots,vmc_knots")
        .eq("race_cd", race.race_cd)
        .order("captured_at_ms")
        .limit(100000);
      rows = data || [];
    }
    const columns = ["team_cd","captured_at_ms","sog_knots","cog_degree","latitude","longitude","relative_signed_degree","relative_angle_degree","upwind_vmg_knots","vmc_knots"];
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
        {current ? <div className="replay-map-wrap">
          <RaceMap athletes={[current]} wind={null} teamMap={teamMap}/>
          <div className="replay-timestamp"><Clock3/><b>{bangkokDateTime(current.captured_at_ms)}</b></div>
        </div> : <div className="replay-placeholder"><Anchor/><h3>{selected ? `กำลังโหลด ${selected.team_name}` : "เลือกนักกีฬา"}</h3><p>เล่นข้อมูลทุกวินาที พร้อมทิศทางการเคลื่อนที่และความเร็วเข้าหาลม</p></div>}
        <div className="replay-controls">
          <button aria-label="กลับไปจุดเริ่มต้น" onClick={() => setCursor(0)}><RotateCcw/></button>
          <button className="play" aria-label={playing ? "หยุดชั่วคราว" : "เล่นย้อนหลัง"} onClick={() => setPlaying((value) => !value)}>{playing ? <Square/> : <Play/>}</button>
          <input className="timeline-input" aria-label="ตำแหน่งเวลาในการเล่นย้อนหลัง" type="range" min="0" max={Math.max(0, readings.length - 1)} value={cursor} onChange={(event) => setCursor(Number(event.target.value))}/>
          <select aria-label="ความเร็วการเล่น" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value=".5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option></select>
        </div>
      </section>
      <section className="panel history-roster">
        <PanelTitle icon={<Users/>} title="นักกีฬา" meta={<span>{teams.length}</span>}/>
        {teams.map((team) => <label className="check-row" key={team.team_cd}><input type="radio" name="history-team" checked={selectedTeam === team.team_cd} onChange={() => setSelectedTeam(team.team_cd)}/><span>{team.sail_no || "—"}</span><b>{team.team_name || team.team_cd}</b></label>)}
      </section>
    </div>
  );
}

const MAX_COMPARE = 4;

function Compare({athletes, teamMap}: {athletes: AthleteState[]; teamMap: Map<string, Team>}) {
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  useEffect(() => {
    setSelectedTeams((current) => {
      const valid = current.filter((teamCd) => athletes.some((athlete) => athlete.team_cd === teamCd));
      return valid.length ? valid : athletes.slice(0, MAX_COMPARE).map((athlete) => athlete.team_cd);
    });
  }, [athletes]);

  function toggle(teamCd: string) {
    setSelectedTeams((current) => {
      if (current.includes(teamCd)) return current.filter((item) => item !== teamCd);
      if (current.length >= MAX_COMPARE) return current;
      return [...current, teamCd];
    });
  }

  const selected = athletes.filter((athlete) => selectedTeams.includes(athlete.team_cd));

  return (
    <>
      <section className="panel compare-picker">
        <PanelTitle icon={<Users/>} title="เลือกนักกีฬาที่จะเปรียบเทียบ" meta={<span>เลือกแล้ว {selectedTeams.length}/{MAX_COMPARE}</span>}/>
        <div className="compare-picker-grid">
          {athletes.map((athlete) => {
            const team = teamMap.get(athlete.team_cd);
            const checked = selectedTeams.includes(athlete.team_cd);
            return <label className={`compare-picker-item ${checked ? "checked" : ""}`} key={athlete.team_cd}>
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && selectedTeams.length >= MAX_COMPARE}
                onChange={() => toggle(athlete.team_cd)}
              />
              <b>{team?.sail_no || "—"}</b><span>{team?.team_name || athlete.team_cd.slice(0, 8)}</span>
            </label>;
          })}
          {!athletes.length && <div className="table-empty">ยังไม่มีข้อมูลนักกีฬาให้เลือก</div>}
        </div>
      </section>
      <div className="compare-grid">
        {selected.map((athlete, index) => {
          const team = teamMap.get(athlete.team_cd);
          return <section className="panel athlete-card" key={athlete.team_cd}>
            <div className={`sail-accent accent-${index + 1}`}/>
            <p>หมายเลขใบเรือ {team?.sail_no || "—"}</p><h2>{team?.team_name || athlete.team_cd}</h2>
            <div className="comparison-metrics">
              <Metric label="ทิศทางการเคลื่อนที่ (COG)" value={`${number(athlete.cog_degree, 0)}°`} sub="องศา" icon={<Compass/>}/>
              <Metric label="มุมเส้นทางเทียบลม" value={`${number(athlete.relative_angle_degree, 0)}°`} sub="องศา" icon={<Wind/>}/>
              <Metric label="VMC" value={number(athlete.vmc_knots)} sub="นอต" icon={<ArrowRight/>}/>
            </div>
          </section>;
        })}
        {!selected.length && <EmptyState/>}
      </div>
    </>
  );
}

function formatDetails(details: Record<string, unknown>) {
  const entries = Object.entries(details || {});
  if (!entries.length) return "ไม่มีรายละเอียดเพิ่มเติม";
  return entries.map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ");
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
        {quality.map((item) => <div className="event-row" key={item.id}><span className={`severity ${item.severity}`}/><div><b>{qualityEventName[item.event_type] || "พบข้อมูลที่ต้องตรวจสอบ"}</b><small>รายละเอียดสำหรับผู้ดูแล: {formatDetails(item.details)}</small></div><time>{bangkokDateTime(item.created_at)}</time></div>)}
      </section>
    </>
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
      <div className="table-head"><span>ใบเรือ / นักกีฬา</span><span>ทิศทาง (COG)</span><span>มุมเทียบลม</span><span>VMC</span><span>สถานะ</span></div>
      {athletes.map((athlete) => {
        const team = teamMap.get(athlete.team_cd);
        const fresh = freshness(athlete.updated_at);
        return <div className="table-row" key={athlete.team_cd}>
          <span><b>{team?.sail_no || "—"}</b><i>{team?.team_name || athlete.team_cd.slice(0, 8)}</i></span>
          <span>{number(athlete.cog_degree, 0)}°</span>
          <span>{number(athlete.relative_angle_degree, 0)}°</span>
          <span className={(athlete.vmc_knots || 0) >= 0 ? "positive" : "negative"}>{number(athlete.vmc_knots)}<small> นอต</small></span>
          <span><StatusDot state={fresh.className} label={fresh.label}/></span>
        </div>;
      })}
      {!athletes.length && <div className="table-empty">รอข้อมูลนักกีฬา</div>}
    </div>
  );
}

type WindWindow = "3" | "5" | "9" | "15";
const windWindowMs = (value: WindWindow) => Number(value) * 60_000;
const windWindowOptions: Array<[WindWindow, string]> = [
  ["3", "3 นาที"], ["5", "5 นาที"], ["9", "9 นาที"], ["15", "15 นาที"],
];
const wrapTo180 = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
const buoyMinusCog = (relativeSigned: number | null) =>
  relativeSigned == null ? null : wrapTo180(-relativeSigned);

// ค่าเฉลี่ยของช่วงเวลาที่เลือก คำนวณฝั่ง client จากข้อมูลลมดิบที่ query มาแล้ว (ทิศใช้ circular mean กันปัญหาเฉลี่ยรอบ 360/0 องศา)
function windAverage(rows: WindState[]) {
  const speeds = rows.map((row) => row.speed_knots).filter((value): value is number => value != null);
  const directions = rows.map((row) => row.direction_degree).filter((value): value is number => value != null);
  const speed = speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : null;
  let direction: number | null = null;
  if (directions.length) {
    const sumSin = directions.reduce((sum, value) => sum + Math.sin(value * Math.PI / 180), 0);
    const sumCos = directions.reduce((sum, value) => sum + Math.cos(value * Math.PI / 180), 0);
    direction = (Math.atan2(sumSin, sumCos) * 180 / Math.PI + 360) % 360;
  }
  return {speed, direction};
}

function WindTable({rows, window, onWindowChange}: {
  rows: WindState[]; window: WindWindow; onWindowChange: (value: WindWindow) => void;
}) {
  const windowLabel = windWindowOptions.find(([value]) => value === window)?.[1] || "";
  const avg = windAverage(rows);
  return <section className="panel telemetry-table-panel">
    <PanelTitle icon={<Wind/>} title="ตารางลมและทิศ" meta={<span>{rows.length} จุดข้อมูล</span>}/>
    <div className="time-filter" aria-label="ช่วงเวลาของข้อมูลลม">
      {windWindowOptions.map(([value, label]) =>
        <button className={window === value ? "active" : ""} key={value} onClick={() => onWindowChange(value)}>{label}</button>)}
    </div>
    <div className="wind-summary">
      <div><small>ความเร็วลมเฉลี่ย · {windowLabel}</small><b>{number(avg.speed)}<span>นอต</span></b></div>
      <div><small>ทิศลมเฉลี่ย · {windowLabel}</small><b>{number(avg.direction, 0)}°<span>{directionName(avg.direction)}</span></b></div>
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
    <div className="direction-table-head"><span>เลขใบเรือ</span><span>ชื่อ</span><span>COG</span><span>COG เทียบทิศลมจริง</span><span>VMC</span></div>
    {athletes.map((athlete) => {
      const team = teamMap.get(athlete.team_cd);
      const relative = buoyMinusCog(athlete.relative_signed_degree);
      return <div className="direction-table-row" key={athlete.team_cd}>
        <span><b>{team?.sail_no || "—"}</b></span>
        <span>{team?.team_name || athlete.team_cd.slice(0, 8)}</span>
        <span>{athlete.cog_degree == null ? "—" : `${number(athlete.cog_degree, 0)}°`}</span>
        <span className={relative == null ? "" : relative >= 0 ? "positive" : "negative"}>
          {relative == null ? "—" : `${relative > 0 ? "+" : ""}${number(relative, 0)}°`}
        </span>
        <span>{athlete.vmc_knots == null ? "—" : `${number(athlete.vmc_knots)} นอต`}</span>
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
