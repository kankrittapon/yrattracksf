"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import {Activity, Anchor, Clock3, Compass, Gauge, Radio, Satellite, Wind} from "lucide-react";
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
  tracker_status: {
    track_open: boolean;
  } | null;
  wind: {
    captured_at_ms: number;
    speed_knots: number | null;
    direction_degree: number | null;
    updated_at: string;
  } | null;
  athletes: PublicAthlete[];
}

interface PublicWindRow {
  captured_at_ms: number;
  speed_knots: number | null;
  direction_degree: number | null;
  updated_at: string;
}

type WindWindow = "realtime" | "3" | "5" | "10";
const windWindowOptions: Array<[WindWindow, string]> = [
  ["realtime", "เวลาจริง"], ["3", "3 นาที"], ["5", "5 นาที"], ["10", "10 นาที"],
];
const windWindowMs = (value: WindWindow) => value === "realtime" ? 30_000 : Number(value) * 60_000;
const wrapTo180 = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
const buoyMinusCog = (relativeSigned: number | null) =>
  relativeSigned == null ? null : wrapTo180(-relativeSigned);

export default function PublicTelemetryPage() {
  const [catalog, setCatalog] = useState<CatalogRace[]>([]);
  const [mode, setMode] = useState<"live" | "history">("live");
  const [matchCd, setMatchCd] = useState("");
  const [levelCd, setLevelCd] = useState("");
  const [raceCd, setRaceCd] = useState("");
  const [data, setData] = useState<PublicRaceData | null>(null);
  const [teamCd, setTeamCd] = useState("");
  const [history, setHistory] = useState<PublicAthlete[]>([]);
  const [windWindow, setWindWindow] = useState<WindWindow>("realtime");
  const [windRows, setWindRows] = useState<PublicWindRow[]>([]);
  const [message, setMessage] = useState("กำลังโหลดรายการที่อนุญาตให้บุคคลทั่วไปดู…");

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
    (!matchCd || item.match_cd === matchCd) && (!levelCd || item.level_cd === levelCd))
    .sort((a, b) => ({50: 0, 10: 1, 99: 2}[a.sailfish_status] ?? 3) - ({50: 0, 10: 1, 99: 2}[b.sailfish_status] ?? 3)),
  [levelCd, matchCd, modeRaces]);

  useEffect(() => {
    const supabase = createClient();
    void supabase.rpc("get_public_race_catalog").then(({data: rows, error}) => {
      if (error) return setMessage(`ยังเปิดหน้าสาธารณะไม่ได้: ${error.message}`);
      const next = (rows || []) as CatalogRace[];
      setCatalog(next);
      setMessage(next.length ? "" : "ยังไม่มีประเภทเรือที่ผู้ดูแลอนุญาตให้บุคคลทั่วไปดู");
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
    const [{data: result, error}, {data: raceWind}] = await Promise.all([
      supabase.rpc("get_public_race", {p_race_cd: raceCd}),
      supabase.rpc("get_public_race_wind", {p_race_cd: raceCd}),
    ]);
    if (error) return setMessage(error.message);
    const next = (result || null) as PublicRaceData | null;
    if (next && raceWind?.[0]) next.wind = raceWind[0] as PublicRaceData["wind"];
    setData(next);
    setMessage(result ? "" : "รอบนี้ไม่ได้รับอนุญาตให้แสดง");
  }, [raceCd]);

  useEffect(() => { void loadRace(); }, [loadRace]);
  useEffect(() => {
    if (mode !== "live" || !raceCd) return;
    const timer = window.setInterval(() => void loadRace(), 2000);
    return () => window.clearInterval(timer);
  }, [loadRace, mode, raceCd]);

  const loadWind = useCallback(async () => {
    if (mode !== "live" || !raceCd) return setWindRows([]);
    const supabase = createClient();
    const {data: rows, error} = await supabase.rpc("get_public_wind_history", {
      p_race_cd: raceCd,
      p_minutes: windWindow === "realtime" ? 1 : Number(windWindow),
    });
    if (error) {
      const fallback = data?.wind ? [data.wind] : [];
      return setWindRows(fallback);
    }
    const cutoff = Date.now() - windWindowMs(windWindow);
    setWindRows(((rows || []) as PublicWindRow[]).filter((row) => row.captured_at_ms >= cutoff));
  }, [data?.wind, mode, raceCd, windWindow]);

  useEffect(() => {
    void loadWind();
    if (mode !== "live" || !raceCd) return;
    const timer = window.setInterval(() => void loadWind(), 2000);
    return () => window.clearInterval(timer);
  }, [loadWind, mode, raceCd]);

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
        <div className="public-brand"><span><Wind/></span><div><b>SailFish</b><small>สมาคมเรือใบแห่งประเทศไทย · ข้อมูลสาธารณะ</small></div></div>
        <div className="public-live-badge"><i/>{mode === "live" ? "การแข่งขันสด" : "ผลการแข่งขันย้อนหลัง"}</div>
      </header>
      <section className="public-hero">
        <p>ข้อมูลการแข่งขัน SAILFISH</p>
        <h1>{mode === "live" ? "ติดตามการแข่งขันสด" : "ผลการแข่งขันย้อนหลัง"}</h1>
        <span>ข้อมูลที่ผู้จัดการแข่งขันอนุญาต · ไม่มีการแสดงพิกัดเรือ</span>
      </section>
      <section className="public-filters">
        <div className="public-tabs">
          <button className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}><Radio/> ถ่ายทอดสด</button>
          <button className={mode === "history" ? "active" : ""} onClick={() => setMode("history")}><Clock3/> ย้อนหลัง</button>
        </div>
        <label>รายการ<select value={matchCd} onChange={(event) => {setMatchCd(event.target.value); setLevelCd("");}}>{matches.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>ประเภทเรือ<select value={levelCd} onChange={(event) => setLevelCd(event.target.value)}>{classes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>รอบ<select value={raceCd} onChange={(event) => setRaceCd(event.target.value)}>{races.map((item) => <option value={item.race_cd} key={item.race_cd}>{item.race_name || item.class_name} · {item.rounds || "—"}</option>)}</select></label>
      </section>

      {message && <div className="public-message"><Anchor/><b>{message}</b></div>}
      {data && <>
        <section className="public-race-title">
          <div><small>{data.race.match_name}</small><h2>{data.race.class_name} · {data.race.rounds}</h2><span>{data.race.race_name}</span></div>
          <div><b>{data.athletes.length}</b><small>นักกีฬา</small></div>
        </section>
        {mode === "live" && data.race.status !== "99" && <section className={`public-track-card ${data.tracker_status?.track_open ? "open" : ""}`}>
          <div className="public-track-summary">
            <span><Satellite/></span>
            <div><small>สถานะระบบติดตาม</small><h3>{data.tracker_status?.track_open ? "ระบบติดตามเปิดแล้ว" : "กำลังเตรียมระบบติดตาม"}</h3></div>
          </div>
        </section>}
        {(mode === "history" || data.race.status === "50") && <section className="public-metrics">
          <Metric icon={<Wind/>} label="ความเร็วลม" value={`${number(data.wind?.speed_knots)} นอต`} sub={bangkokTime(data.wind?.captured_at_ms)}/>
          <Metric icon={<Compass/>} label="ทิศที่ลมพัดมา" value={`${number(data.wind?.direction_degree, 0)}°`} sub={directionName(data.wind?.direction_degree)}/>
          <Metric icon={<Activity/>} label="สถานะข้อมูล" value={freshness(data.wind?.updated_at).label} sub={mode === "live" ? "อัปเดตทุก 2 วินาที" : "ข้อมูลสุดท้ายของรอบ"}/>
        </section>}

        {mode === "live" && data.race.status !== "50" ? <section className="public-waiting-card">
          <Anchor/><h3>{data.race.status === "10" ? "รอเริ่มการแข่งขัน" : "รอรอบถัดไป"}</h3>
          <p>{data.race.status === "10" ? `${data.race.class_name} · ${data.race.rounds || "รอบที่กำลังเตรียม"}` : "การแข่งขันรอบนี้จบแล้ว ข้อมูลสดถูกปิดจนกว่าจะมีรอบใหม่"}</p>
        </section> : mode === "live" ? <>
          <section className="public-wind-card">
            <div className="public-card-title"><h3>ตารางลมและทิศ</h3><div className="time-filter">
              {windWindowOptions.map(([value, label]) => <button className={windWindow === value ? "active" : ""} key={value} onClick={() => setWindWindow(value)}>{label}</button>)}
            </div></div>
            <div className="public-wind-table">
              <div className="public-wind-head"><span>เวลา</span><span>ความเร็วลม</span><span>ทิศลม</span><span>ชื่อทิศ</span></div>
              {windRows.map((row) => <div className="public-wind-row" key={row.captured_at_ms}>
                <span>{bangkokTime(row.captured_at_ms)}</span><span>{number(row.speed_knots)} <small>นอต</small></span>
                <span>{number(row.direction_degree, 0)}°</span><span>{directionName(row.direction_degree)}</span>
              </div>)}
              {!windRows.length && <div className="public-chart-empty">รอข้อมูลลมจากทุ่นหลัก</div>}
            </div>
          </section>
          <section className="public-table-card">
            <h3>ทิศของนักกีฬาแต่ละคน</h3>
            <div className="public-table-head"><span>เลขใบเรือ</span><span>ชื่อ</span><span>COG</span><span>SOG</span><span>ทิศทุ่น − COG</span></div>
            {data.athletes.map((item) => {
              const relative = buoyMinusCog(item.relative_signed_degree);
              return <div className="public-table-row" key={item.team_cd}>
                <span><b>{item.sail_no || "—"}</b></span><span>{item.team_name || item.team_cd}</span>
                <span>{item.cog_degree == null ? "—" : `${number(item.cog_degree, 0)}°`}</span>
                <span>{item.sog_knots == null ? "—" : `${number(item.sog_knots)} นอต`}</span>
                <span className={relative == null ? "" : relative >= 0 ? "positive" : "negative"}>{relative == null ? "—" : `${relative > 0 ? "+" : ""}${number(relative, 0)}°`}</span>
              </div>;
            })}
          </section>
        </> : <section className="public-history-grid">
          <aside className="public-roster"><h3>นักกีฬา</h3>{data.athletes.map((item) => <button className={teamCd === item.team_cd ? "active" : ""} key={item.team_cd} onClick={() => setTeamCd(item.team_cd)}><b>{item.sail_no || "—"}</b><span>{item.team_name || item.team_cd}<small>{item.nationality || "—"}</small></span></button>)}</aside>
          <div className="public-history-panel"><h3>{selected?.team_name || "ข้อมูลนักกีฬาย้อนหลัง"}</h3>
            <div className="public-metrics compact">
              <Metric icon={<Gauge/>} label="ความเร็วล่าสุด (SOG)" value={`${number(latestHistory?.sog_knots)} นอต`} sub={`${history.length} จุดข้อมูล`}/>
              <Metric icon={<Compass/>} label="ทิศทางล่าสุด (COG)" value={`${number(latestHistory?.cog_degree, 0)}°`} sub={bangkokTime(latestHistory?.captured_at_ms)}/>
              <Metric icon={<Wind/>} label="มุมเส้นทางเทียบลม" value={latestHistory?.relative_angle_degree == null ? "—" : `${number(latestHistory.relative_angle_degree, 0)}°`} sub="คำนวณจากทิศทางและลม"/>
            </div>
            <HistoryChart rows={history}/>
          </div>
        </section>}
      </>}
      <footer className="public-footer">ทิศทุ่น − COG แสดงค่าหลังปรับให้อยู่ระหว่าง −180° ถึง 180° · COG คือทิศทางการเคลื่อนที่ ไม่ใช่ทิศหัวเรือ</footer>
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
  return <div className="public-chart"><div><b>ความเร็วตามเวลา</b><span>แสดงหนึ่งจุดทุก 5 วินาที</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={points}/></svg></div>;
}
