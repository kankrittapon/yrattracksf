"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  Activity, AlertTriangle, Anchor, ArrowRight, CheckCircle2, ChevronDown, ClipboardCheck,
  Clock3, Compass, Database, Gauge, LocateFixed, LockKeyhole, Play,
  Radio, RefreshCw, RotateCcw, Settings2, ShieldCheck, Square, Users, Wind,
} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {bangkokTime, directionName, freshness, number} from "@/lib/format";
import type {AthleteState, Collector, Race, Section, Team, WindState} from "@/types/dashboard";

interface QualityEvent {
  id: number;
  event_type: string;
  severity: string;
  details: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
}

const titles: Record<Section, [string, string]> = {
  overview: ["Race overview", "ภาพรวมการแข่งขันและสัญญาณล่าสุด"],
  live: ["Live race", "ตำแหน่ง ลม และสมรรถนะวินาทีต่อวินาที"],
  history: ["Races & history", "สำรวจและเล่นข้อมูลการแข่งขันย้อนหลัง"],
  compare: ["Athlete compare", "เปรียบเทียบเส้นทาง ความเร็ว และมุมเทียบลม"],
  control: ["Collector control", "Arm และควบคุม Collector ผ่าน Tailscale เท่านั้น"],
  quality: ["Data quality", "ตรวจความสด ช่องว่าง การเชื่อมต่อ และ decoder"],
  settings: ["Race settings", "ตั้งค่าทุ่นลม หน่วย เวลา และนโยบายข้อมูล"],
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

  const load = useCallback(async () => {
    const supabase = createClient();
    const {data: raceRows} = await supabase.from("races").select("*").order("updated_at", {ascending: false});
    const nextRaces = (raceRows || []) as Race[];
    setRaces(nextRaces);
    const selected = raceCd || nextRaces[0]?.race_cd || "";
    if (!raceCd && selected) setRaceCd(selected);
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
  }, [raceCd]);

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
  const teamMap = useMemo(() => new Map(teams.map((team) => [team.team_cd, team])), [teams]);
  const liveCount = athletes.filter((item) => freshness(item.updated_at).className === "live").length;

  async function control(action: "arm" | "start-override" | "stop" | "retry") {
    setNotice("กำลังเชื่อมต่อ ai-brain ผ่าน Tailscale…");
    const api = process.env.NEXT_PUBLIC_CONTROL_API_URL;
    if (!api) return setNotice("ยังไม่ได้ตั้งค่า NEXT_PUBLIC_CONTROL_API_URL");
    const supabase = createClient();
    const {data: {session}} = await supabase.auth.getSession();
    if (!session) return setNotice("Session หมดอายุ กรุณาเข้าสู่ระบบใหม่");
    const reason = action === "arm" || action === "retry"
      ? "Dashboard control"
      : window.prompt("ระบุเหตุผลสำหรับ audit log", "") || "";
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
      setNotice(`คำสั่ง ${action} สำเร็จ`);
    } catch (error) {
      setNotice(`เชื่อมต่อไม่ได้ — กรุณาเชื่อม Tailscale (${String(error)})`);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">SAILFISH TELEMETRY</p><h1>{titles[section][0]}</h1><span>{titles[section][1]}</span></div>
        <div className="race-picker">
          <label>ACTIVE RACE</label>
          <select value={raceCd} onChange={(event) => setRaceCd(event.target.value)}>
            {!races.length && <option value="">ยังไม่มีการแข่งขัน</option>}
            {races.map((item) => <option value={item.race_cd} key={item.race_cd}>{item.name || item.race_cd} · {item.rounds || "—"}</option>)}
          </select>
          <ChevronDown size={16}/>
        </div>
      </div>

      {loading ? <LoadingState/> : !race ? <EmptyState/> : (
        <>
          {section === "overview" && <Overview race={race} collector={collector} wind={wind} athletes={athletes} liveCount={liveCount} teamMap={teamMap}/>}
          {section === "live" && <LiveRace race={race} collector={collector} wind={wind} athletes={athletes} teamMap={teamMap}/>}
          {section === "history" && <History race={race} teams={teams} role={role}/>}
          {section === "compare" && <Compare athletes={athletes} teamMap={teamMap}/>}
          {section === "control" && <Control collector={collector} race={race} notice={notice} onControl={control}/>}
          {section === "quality" && <Quality collector={collector} quality={quality} athletes={athletes} teams={teams}/>}
          {section === "settings" && <SettingsPanel race={race} wind={wind}/>}
        </>
      )}
    </>
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
        <div><div className="status-kicker"><span className="pulse"/> {collector?.state || "NOT ARMED"}</div><h2>{race.name || "Unnamed race"} <em>{race.rounds || ""}</em></h2><p>{athletes.length} athletes · Main wind instrument · Bangkok time {bangkokTime(Date.now())}</p></div>
        <div className="hero-metrics">
          <Metric label="LIVE ATHLETES" value={`${liveCount}/${athletes.length}`} sub="≤ 5 sec" icon={<Users/>}/>
          <Metric label="MESSAGES" value={String(collector?.messages_received || 0)} sub={`${collector?.reconnects || 0} reconnects`} icon={<Activity/>}/>
          <Metric label="SAILFISH STATUS" value={collector?.sailfish_status || race.sailfish_status || "—"} sub={collector?.websocket_connected ? "socket connected" : "socket offline"} icon={<Radio/>}/>
        </div>
      </section>
      <div className="dashboard-grid">
        <section className="panel wind-card">
          <PanelTitle icon={<Wind/>} title="Main wind" meta={<StatusDot state={windFresh.className} label={windFresh.label}/>}/>
          <div className="wind-readout">
            <div className="compass-dial"><div className="compass-arrow" style={{transform: `rotate(${wind?.direction_degree || 0}deg)`}}/><b>{number(wind?.direction_degree, 0)}°</b><span>{directionName(wind?.direction_degree)}</span></div>
            <div><strong>{number(wind?.speed_knots, 1)}</strong><small>KNOTS</small><p>Updated {bangkokTime(wind?.captured_at_ms)}</p></div>
          </div>
        </section>
        <section className="panel athlete-snapshot">
          <PanelTitle icon={<Gauge/>} title="Fleet snapshot" meta={<span>{athletes.length} boats</span>}/>
          <AthleteTable athletes={athletes.slice(0, 7)} teamMap={teamMap}/>
        </section>
        <section className="panel health-panel">
          <PanelTitle icon={<ShieldCheck/>} title="Collector health" meta={null}/>
          <div className="health-list">
            <HealthRow label="Tailscale control" ok={true} value="Private"/>
            <HealthRow label="WebSocket" ok={Boolean(collector?.websocket_connected)} value={collector?.websocket_connected ? "Connected" : "Offline"}/>
            <HealthRow label="Last message" ok={freshness(collector?.last_message_at).className === "live"} value={bangkokTime(collector?.last_message_at)}/>
            <HealthRow label="Decoder" ok={!collector?.last_error} value={collector?.last_error ? "Attention" : "Ready"}/>
          </div>
        </section>
      </div>
    </>
  );
}

function LiveRace({race, collector, wind, athletes, teamMap}: {
  race: Race; collector: Collector | null; wind: WindState | null; athletes: AthleteState[]; teamMap: Map<string, Team>;
}) {
  return (
    <div className="live-layout">
      <section className="panel race-map-panel">
        <PanelTitle icon={<LocateFixed/>} title={`${race.name || "Race"} · live field`} meta={<StatusDot state={collector?.websocket_connected ? "live" : "offline"} label={collector?.websocket_connected ? "LIVE" : "OFFLINE"}/>}/>
        <RaceMap athletes={athletes} wind={wind} teamMap={teamMap}/>
      </section>
      <section className="panel live-wind-side">
        <PanelTitle icon={<Wind/>} title="Wind now" meta={null}/>
        <div className="big-number">{number(wind?.speed_knots)}<small>kt</small></div>
        <div className="direction-row"><Compass/> {number(wind?.direction_degree, 0)}° · {directionName(wind?.direction_degree)}</div>
        <p className="data-note">Main instrument · {bangkokTime(wind?.captured_at_ms)}</p>
      </section>
      <section className="panel fleet-table-panel">
        <PanelTitle icon={<Users/>} title="Fleet telemetry" meta={<span>COG ≠ heading</span>}/>
        <AthleteTable athletes={athletes} teamMap={teamMap}/>
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
        <PanelTitle icon={<Clock3/>} title={`${race.name || "Race"} · ${race.rounds || "history"}`} meta={role === "admin" ? <button className="text-button" onClick={exportCsv}>Export CSV</button> : <span>UTC source</span>}/>
        {current ? <RaceMap athletes={[current]} wind={null} teamMap={teamMap}/> : <div className="replay-placeholder"><Anchor/><h3>{selected ? `กำลังโหลด ${selected.team_name}` : "เลือกนักกีฬา"}</h3><p>ข้อมูลหนึ่งวินาทีจะถูกเล่นบนแผนที่พร้อม COG และ VMG</p></div>}
        <div className="replay-controls">
          <button onClick={() => setCursor(0)}><RotateCcw/></button>
          <button className="play" onClick={() => setPlaying((value) => !value)}>{playing ? <Square/> : <Play/>}</button>
          <input className="timeline-input" type="range" min="0" max={Math.max(0, readings.length - 1)} value={cursor} onChange={(event) => setCursor(Number(event.target.value))}/>
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value=".5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option></select>
        </div>
      </section>
      <section className="panel history-roster">
        <PanelTitle icon={<Users/>} title="Athletes" meta={<span>{teams.length}</span>}/>
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
          <p>SAIL {team?.sail_no || "—"}</p><h2>{team?.team_name || athlete.team_cd}</h2>
          <div className="comparison-metrics">
            <Metric label="SOG" value={number(athlete.sog_knots)} sub="knots" icon={<Gauge/>}/>
            <Metric label="COG" value={`${number(athlete.cog_degree, 0)}°`} sub="course" icon={<Compass/>}/>
            <Metric label="WIND ANGLE" value={`${number(athlete.relative_angle_degree, 0)}°`} sub="course-to-wind" icon={<Wind/>}/>
            <Metric label="UPWIND VMG" value={number(athlete.upwind_vmg_knots)} sub="knots" icon={<ArrowRight/>}/>
          </div>
        </section>;
      })}
      {!selected.length && <EmptyState/>}
    </div>
  );
}

function Control({collector, race, notice, onControl}: {
  collector: Collector | null; race: Race; notice: string;
  onControl: (action: "arm" | "start-override" | "stop" | "retry") => void;
}) {
  return (
    <div className="control-layout">
      <section className="panel control-main">
        <div className="control-lock"><LockKeyhole/><div><b>TAILSCALE PRIVATE CONTROL</b><span>คำสั่งถูกส่งจาก browser ไป ai-brain โดยตรง</span></div></div>
        <h2>{race.name} · {race.rounds}</h2>
        <div className="state-flow">{["idle", "armed", "waiting_for_start", "recording", "finishing", "completed"].map((state) => <span className={collector?.state === state ? "current" : ""} key={state}>{state.replaceAll("_", " ")}</span>)}</div>
        <div className="control-buttons">
          <button className="arm" onClick={() => onControl("arm")}><Radio/> Arm collector</button>
          <button onClick={() => onControl("start-override")}><Play/> Manual start</button>
          <button onClick={() => onControl("retry")}><RefreshCw/> Retry</button>
          <button className="danger" onClick={() => onControl("stop")}><Square/> Stop</button>
        </div>
        {notice && <div className="control-notice">{notice}</div>}
      </section>
      <section className="panel control-status">
        <PanelTitle icon={<Activity/>} title="Runtime" meta={null}/>
        <dl>
          <dt>State</dt><dd>{collector?.state || "idle"}</dd>
          <dt>WebSocket</dt><dd>{collector?.websocket_connected ? "connected" : "offline"}</dd>
          <dt>Messages</dt><dd>{collector?.messages_received || 0}</dd>
          <dt>Reconnects</dt><dd>{collector?.reconnects || 0}</dd>
          <dt>Last message</dt><dd>{bangkokTime(collector?.last_message_at)}</dd>
        </dl>
      </section>
    </div>
  );
}

function Quality({collector, quality, athletes, teams}: {collector: Collector | null; quality: QualityEvent[]; athletes: AthleteState[]; teams: Team[]}) {
  const duplicateDevices = teams.filter((team, index) => team.device_cd && teams.findIndex((item) => item.device_cd === team.device_cd) !== index);
  return (
    <>
      <div className="quality-summary">
        <Metric label="RECONNECTS" value={String(collector?.reconnects || 0)} sub="collector run" icon={<RefreshCw/>}/>
        <Metric label="OPEN ALERTS" value={String(quality.filter((item) => !item.resolved_at).length)} sub="requires review" icon={<AlertTriangle/>}/>
        <Metric label="STALE ATHLETES" value={String(athletes.filter((item) => freshness(item.updated_at).className !== "live").length)} sub="over 5 sec" icon={<Clock3/>}/>
        <Metric label="DUPLICATE DEVICES" value={String(duplicateDevices.length)} sub="team assignments" icon={<Database/>}/>
      </div>
      <section className="panel quality-events">
        <PanelTitle icon={<ClipboardCheck/>} title="Quality event stream" meta={<span>latest 30</span>}/>
        {!quality.length && <div className="all-clear"><CheckCircle2/><b>ไม่พบปัญหาในรอบนี้</b><span>ระบบจะแสดง decoder, timestamp และ connection errors ที่นี่</span></div>}
        {quality.map((item) => <div className="event-row" key={item.id}><span className={`severity ${item.severity}`}/><div><b>{item.event_type.replaceAll("_", " ")}</b><small>{JSON.stringify(item.details)}</small></div><time>{bangkokTime(item.created_at)}</time></div>)}
      </section>
    </>
  );
}

function SettingsPanel({race, wind}: {race: Race; wind: WindState | null}) {
  return (
    <div className="settings-grid">
      <section className="panel setting-card"><Settings2/><h3>Wind reference</h3><p>Main instrument</p><code>{race.main_wind_instrument_cd || wind?.wind_instrument_cd || "Not assigned"}</code><button disabled>เปลี่ยนผ่าน migration/config</button></section>
      <section className="panel setting-card"><Clock3/><h3>Time & freshness</h3><p>Display: Asia/Bangkok</p><code>wind tolerance = 5 seconds</code><button disabled>UTC storage enforced</button></section>
      <section className="panel setting-card"><Database/><h3>Retention</h3><p>Normalized: long-term</p><code>raw payload = 30 days</code><button disabled>Scheduled cleanup</button></section>
      <section className="panel setting-card"><ShieldCheck/><h3>Privacy</h3><p>Authenticated members only</p><code>RLS + audit logging</code><button disabled>Admin managed</button></section>
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
        return <div className="wind-marker" style={{left: `${p.x}%`, top: `${p.y}%`}}><Wind/><span>WIND</span></div>;
      })()}
      {points.map((athlete) => {
        const p = xy(athlete.latitude!, athlete.longitude!);
        const team = teamMap.get(athlete.team_cd);
        return <div className="boat-marker" key={athlete.team_cd} style={{left: `${p.x}%`, top: `${p.y}%`, transform: `translate(-50%,-50%) rotate(${athlete.cog_degree || 0}deg)`}}><Anchor/><b style={{transform: `rotate(-${athlete.cog_degree || 0}deg)`}}>{team?.sail_no || "•"}</b></div>;
      })}
      {!points.length && <div className="map-empty">รอพิกัดนักกีฬา Live</div>}
    </div>
  );
}

function AthleteTable({athletes, teamMap}: {athletes: AthleteState[]; teamMap: Map<string, Team>}) {
  return (
    <div className="athlete-table">
      <div className="table-head"><span>SAIL / ATHLETE</span><span>SOG</span><span>COG</span><span>WIND ∠</span><span>VMG</span><span>STATUS</span></div>
      {athletes.map((athlete) => {
        const team = teamMap.get(athlete.team_cd);
        const fresh = freshness(athlete.updated_at);
        return <div className="table-row" key={athlete.team_cd}>
          <span><b>{team?.sail_no || "—"}</b><i>{team?.team_name || athlete.team_cd.slice(0, 8)}</i></span>
          <span>{number(athlete.sog_knots)}<small> kt</small></span>
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
  return <div className="empty-state"><Anchor/><h2>ยังไม่มีการแข่งขันในฐานข้อมูล</h2><p>ให้ Admin เชื่อม Tailscale แล้ว Sync หรือ Arm race จาก Collector Control</p></div>;
}
