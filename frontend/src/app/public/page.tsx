"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import {Activity, Anchor, Clock3, Compass, Gauge, Radio, Wind} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {bangkokTime, directionName, freshness, number} from "@/lib/format";

interface CatalogRace {
  match_cd: string;
  match_name: string;
  level_cd: string;
  class_name: string;
  race_cd: string;
  race_name: string | null;
  rounds: string | null;
  sailfish_status: string;
  public_mode: "live" | "history";
  start_at: string | null;
  end_at: string | null;
}

interface PublicAthlete {
  team_cd: string;
  team_name: string | null;
  sail_no: string | null;
  nationality: string | null;
  captured_at_ms: number | null;
  sog_knots: number | null;
  cog_degree: number | null;
  wind_speed_knots?: number | null;
  wind_direction_degree?: number | null;
  relative_signed_degree: number | null;
  relative_angle_degree: number | null;
  upwind_vmg_knots: number | null;
  updated_at?: string | null;
}

interface PublicRaceData {
  race: {
    race_cd: string;
    match_name: string;
    class_name: string;
    race_name: string | null;
    rounds: string | null;
    status: string;
    start_at: string | null;
    end_at: string | null;
  };
  wind: {
    captured_at_ms: number;
    speed_knots: number | null;
    direction_degree: number | null;
    updated_at: string;
  } | null;
  athletes: PublicAthlete[];
}

export default function PublicTelemetryPage() {
  const [catalog, setCatalog] = useState<CatalogRace[]>([]);
  const [mode, setMode] = useState<"live" | "history">("live");
  const [matchCd, setMatchCd] = useState("");
  const [levelCd, setLevelCd] = useState("");
  const [raceCd, setRaceCd] = useState("");
  const [data, setData] = useState<PublicRaceData | null>(null);
  const [teamCd, setTeamCd] = useState("");
  const [history, setHistory] = useState<PublicAthlete[]>([]);
  const [message, setMessage] = useState("กำลังโหลดรายการที่เปิดเป็น Public…");

  const modeRaces = useMemo(() => catalog.filter((item) => item.public_mode === mode), [catalog, mode]);
  const matches = useMemo(
    () => [...new Map(modeRaces.map((item) => [item.match_cd, item.match_name])).entries()],
    [modeRaces],
  );
  const classes = useMemo(
    () => [...new Map(modeRaces.filter((item) => !matchCd || item.match_cd === matchCd)
      .map((item) => [item.level_cd, item.class_name])).entries()],
    [matchCd, modeRaces],
  );
  const races = useMemo(() => modeRaces.filter((item) =>
    (!matchCd || item.match_cd === matchCd) && (!levelCd || item.level_cd === levelCd)),
  [levelCd, matchCd, modeRaces]);

  useEffect(() => {
    const supabase = createClient();
    void supabase.rpc("get_public_race_catalog").then(({data: rows, error}) => {
      if (error) return setMessage(`ยังเปิด Public ไม่ได้: ${error.message}`);
      const next = (rows || []) as CatalogRace[];
      setCatalog(next);
      setMessage(next.length ? "" : "ยังไม่มีประเภทเรือที่ Admin อนุญาตให้ดู Public");
    });
  }, []);

  useEffect(() => {
    const validMatch = matches.some(([value]) => value === matchCd) ? matchCd : matches[0]?.[0] || "";
    if (validMatch !== matchCd) setMatchCd(validMatch);
  }, [matchCd, matches]);
  useEffect(() => {
    const validClass = classes.some(([value]) => value === levelCd) ? levelCd : classes[0]?.[0] || "";
    if (validClass !== levelCd) setLevelCd(validClass);
  }, [classes, levelCd]);
  useEffect(() => {
    const validRace = races.some((item) => item.race_cd === raceCd) ? raceCd : races[0]?.race_cd || "";
    if (validRace !== raceCd) setRaceCd(validRace);
  }, [raceCd, races]);

  const loadRace = useCallback(async () => {
    if (!raceCd) return setData(null);
    const supabase = createClient();
    const {data: result, error} = await supabase.rpc("get_public_race", {p_race_cd: raceCd});
    if (error) return setMessage(error.message);
    setData((result || null) as PublicRaceData | null);
    setMessage(result ? "" : "รอบนี้ไม่ได้รับอนุญาตให้แสดง");
  }, [raceCd]);

  useEffect(() => { void loadRace(); }, [loadRace]);
  useEffect(() => {
    if (mode !== "live" || !raceCd) return;
    const timer = window.setInterval(() => void loadRace(), 2000);
    return () => window.clearInterval(timer);
  }, [loadRace, mode, raceCd]);

  useEffect(() => {
    const firstTeam = data?.athletes[0]?.team_cd || "";
    if (!data?.athletes.some((item) => item.team_cd === teamCd)) setTeamCd(firstTeam);
  }, [data, teamCd]);
  useEffect(() => {
    if (mode !== "history" || !raceCd || !teamCd) return setHistory([]);
    const supabase = createClient();
    void supabase.rpc("get_public_athlete_history", {
      p_race_cd: raceCd,
      p_team_cd: teamCd,
      p_from_ms: null,
      p_to_ms: null,
      p_sample_seconds: 5,
    }).then(({data: rows, error}) => {
      if (error) return setMessage(error.message);
      setHistory((rows || []) as PublicAthlete[]);
    });
  }, [mode, raceCd, teamCd]);

  const selected = data?.athletes.find((item) => item.team_cd === teamCd) || data?.athletes[0];
  const latestHistory = history.at(-1);

  return (
    <main className="public-shell">
      <header className="public-header">
        <div className="public-brand"><span><Wind/></span><div><b>SailFish</b><small>PUBLIC RACE INTELLIGENCE</small></div></div>
        <div className="public-live-badge"><i/>{mode === "live" ? "LIVE TELEMETRY" : "RACE HISTORY"}</div>
      </header>
      <section className="public-hero">
        <p>SAILFISH TELEMETRY</p>
        <h1>{mode === "live" ? "Live race dashboard" : "Race history"}</h1>
        <span>ข้อมูลที่ผู้จัดการแข่งขันอนุญาต · ไม่มีการแสดงพิกัดเรือ</span>
      </section>
      <section className="public-filters">
        <div className="public-tabs">
          <button className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}><Radio/> Live</button>
          <button className={mode === "history" ? "active" : ""} onClick={() => setMode("history")}><Clock3/> History</button>
        </div>
        <label>รายการ<select value={matchCd} onChange={(event) => {setMatchCd(event.target.value); setLevelCd("");}}>{matches.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>ประเภทเรือ<select value={levelCd} onChange={(event) => setLevelCd(event.target.value)}>{classes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>รอบ<select value={raceCd} onChange={(event) => setRaceCd(event.target.value)}>{races.map((item) => <option value={item.race_cd} key={item.race_cd}>{item.race_name || item.class_name} · {item.rounds || "—"}</option>)}</select></label>
      </section>

      {message && <div className="public-message"><Anchor/><b>{message}</b></div>}
      {data && <>
        <section className="public-race-title">
          <div><small>{data.race.match_name}</small><h2>{data.race.class_name} · {data.race.rounds}</h2><span>{data.race.race_name}</span></div>
          <div><b>{data.athletes.length}</b><small>ATHLETES</small></div>
        </section>
        <section className="public-metrics">
          <Metric icon={<Wind/>} label="WIND SPEED" value={`${number(data.wind?.speed_knots)} kt`} sub={bangkokTime(data.wind?.captured_at_ms)}/>
          <Metric icon={<Compass/>} label="WIND FROM" value={`${number(data.wind?.direction_degree, 0)}°`} sub={directionName(data.wind?.direction_degree)}/>
          <Metric icon={<Activity/>} label="DATA STATUS" value={freshness(data.wind?.updated_at).label} sub={mode === "live" ? "refresh every 2 sec" : "final reading"}/>
        </section>

        {mode === "live" ? <section className="public-table-card">
          <h3>Fleet performance</h3>
          <div className="public-table-head"><span>SAIL / ATHLETE</span><span>SOG</span><span>COG</span><span>WIND ∠</span><span>VMG</span></div>
          {data.athletes.map((item) => <div className="public-table-row" key={item.team_cd}>
            <span><b>{item.sail_no || "—"}</b><i>{item.team_name || item.team_cd} · {item.nationality || "—"}</i></span>
            <span>{number(item.sog_knots)} <small>kt</small></span><span>{number(item.cog_degree, 0)}°</span>
            <span>{item.relative_angle_degree == null ? "—" : `${number(item.relative_angle_degree, 0)}°`}</span>
            <span>{item.upwind_vmg_knots == null ? "—" : number(item.upwind_vmg_knots)}</span>
          </div>)}
        </section> : <section className="public-history-grid">
          <aside className="public-roster"><h3>นักกีฬา</h3>{data.athletes.map((item) => <button className={teamCd === item.team_cd ? "active" : ""} key={item.team_cd} onClick={() => setTeamCd(item.team_cd)}><b>{item.sail_no || "—"}</b><span>{item.team_name || item.team_cd}<small>{item.nationality || "—"}</small></span></button>)}</aside>
          <div className="public-history-panel"><h3>{selected?.team_name || "Athlete history"}</h3>
            <div className="public-metrics compact">
              <Metric icon={<Gauge/>} label="FINAL SOG" value={`${number(latestHistory?.sog_knots)} kt`} sub={`${history.length} samples`}/>
              <Metric icon={<Compass/>} label="FINAL COG" value={`${number(latestHistory?.cog_degree, 0)}°`} sub={bangkokTime(latestHistory?.captured_at_ms)}/>
              <Metric icon={<Wind/>} label="WIND ANGLE" value={latestHistory?.relative_angle_degree == null ? "—" : `${number(latestHistory.relative_angle_degree, 0)}°`} sub="course-to-wind"/>
            </div>
            <HistoryChart rows={history}/>
          </div>
        </section>}
      </>}
      <footer className="public-footer">Course-to-wind ใช้ COG เทียบกับทิศลมจากทุ่น · COG ไม่ใช่ทิศหัวเรือ</footer>
    </main>
  );
}

function Metric({icon, label, value, sub}: {icon: React.ReactNode; label: string; value: string; sub: string}) {
  return <div className="public-metric"><span>{icon}{label}</span><b>{value}</b><small>{sub}</small></div>;
}

function HistoryChart({rows}: {rows: PublicAthlete[]}) {
  if (!rows.length) return <div className="public-chart-empty">กำลังโหลดข้อมูลย้อนหลัง…</div>;
  const values = rows.map((row) => row.sog_knots || 0);
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => `${index / Math.max(values.length - 1, 1) * 100},${94 - value / max * 82}`).join(" ");
  return <div className="public-chart"><div><b>SOG over time</b><span>sample ทุก 5 วินาที</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={points}/></svg></div>;
}
