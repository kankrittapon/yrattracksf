"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import {Activity, Anchor, Clock3, Compass, Gauge, Play, Radio, RotateCcw, Satellite, Square, Wind} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {bangkokTime, directionName, freshness, mapErrorMessage, number} from "@/lib/format";
import {useVisibleInterval} from "@/lib/use-visible-interval";
import {useDebouncedCallback} from "@/lib/use-debounced-callback";

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
  vmc_knots?: number | null;
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
  const [lastReceivedAt, setLastReceivedAt] = useState<number | null>(null);

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
      if (error) return setMessage(`ยังเปิดหน้าสาธารณะไม่ได้: ${mapErrorMessage(error)}`);
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

  const [publicChannelHealthy, setPublicChannelHealthy] = useState(false);

  const loadRace = useCallback(async () => {
    if (!raceCd) return setData(null);
    const supabase = createClient();
    const [{data: result, error}, {data: raceWind}] = await Promise.all([
      supabase.rpc("get_public_race", {p_race_cd: raceCd}),
      supabase.rpc("get_public_race_wind", {p_race_cd: raceCd}),
    ]);
    if (error) return setMessage(mapErrorMessage(error));
    const next = (result || null) as PublicRaceData | null;
    if (next && raceWind?.[0]) next.wind = raceWind[0] as PublicRaceData["wind"];
    setData(next);
    if (next) setLastReceivedAt(Date.now());
    setMessage(result ? "" : "รอบนี้ไม่ได้รับอนุญาตให้แสดง");
  }, [raceCd]);

  useEffect(() => { void loadRace(); }, [loadRace]);
  // Realtime เป็นตัวหลัก — poll ที่นี่เป็นแค่ fallback: ถี่ (1s) ตอน Realtime ยังไม่ต่อติด
  // และห่างลง (5s) ตอน Realtime ทำงานอยู่แล้ว เผื่อ broadcast หลุดหายไปบ้าง
  useVisibleInterval(() => {
    if (mode === "live" && raceCd) void loadRace();
  }, publicChannelHealthy ? 5000 : 1000);

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

  useEffect(() => { void loadWind(); }, [loadWind]);
  useVisibleInterval(() => {
    if (mode === "live" && raceCd) void loadWind();
  }, publicChannelHealthy ? 5000 : 1000);

  useEffect(() => {
    const firstTeam = data?.athletes[0]?.team_cd || "";
    if (!data?.athletes.some((item) => item.team_cd === teamCd)) setTeamCd(firstTeam);
  }, [data, teamCd]);
  const loadAthleteSeries = useCallback(async () => {
    if (!raceCd || !teamCd || (mode === "live" && data?.race.status !== "50")) {
      setHistory([]);
      return;
    }
    const supabase = createClient();
    const {data: rows, error} = await supabase.rpc("get_public_athlete_history", {
      p_race_cd: raceCd,
      p_team_cd: teamCd,
      p_from_ms: null,
      p_to_ms: null,
      p_sample_seconds: 5,
    });
    if (error) return setMessage(mapErrorMessage(error));
    setHistory((rows || []) as PublicAthlete[]);
  }, [data?.race.status, mode, raceCd, teamCd]);

  useEffect(() => { void loadAthleteSeries(); }, [loadAthleteSeries]);
  useVisibleInterval(() => {
    if (mode === "live" && data?.race.status === "50" && teamCd) void loadAthleteSeries();
  }, publicChannelHealthy ? 5000 : 1000);

  // Realtime: collector เขียนแถวใหม่ลง DB → trigger ฝั่ง DB ส่ง broadcast แบบไม่มีพิกัด/ความเร็วดิบ
  // มาที่ topic ของรอบนี้ (เฉพาะรอบที่เปิดสาธารณะอยู่) → หน้านี้แค่รู้ว่า "มีของใหม่" แล้วเรียก RPC
  // ที่ mask ข้อมูลไว้แล้วซ้ำ ทำให้เห็นข้อมูลใหม่เกือบทันทีแทนที่จะรอรอบ poll ถัดไป
  const debouncedAthleteRefresh = useDebouncedCallback(() => { void loadRace(); void loadAthleteSeries(); }, 300);
  const debouncedWindRefresh = useDebouncedCallback(() => { void loadRace(); void loadWind(); }, 300);
  useEffect(() => {
    if (mode !== "live" || !raceCd) { setPublicChannelHealthy(false); return; }
    setPublicChannelHealthy(false);
    const supabase = createClient();
    const channel = supabase.channel(`public:race:${raceCd}`)
      .on("broadcast", {event: "athlete_update"}, () => debouncedAthleteRefresh())
      .on("broadcast", {event: "wind_update"}, () => debouncedWindRefresh())
      .subscribe((status) => setPublicChannelHealthy(status === "SUBSCRIBED"));
    return () => { void supabase.removeChannel(channel); setPublicChannelHealthy(false); };
  }, [mode, raceCd, debouncedAthleteRefresh, debouncedWindRefresh]);

  const selected = data?.athletes.find((item) => item.team_cd === teamCd) || data?.athletes[0];
  const hasLiveTelemetry = Boolean(data?.wind)
    || Boolean(data?.athletes.some((item) => item.sog_knots != null || item.cog_degree != null));

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
          <div className="public-received-at"><small><Clock3 size={12}/> ได้รับข้อมูลล่าสุดเมื่อ</small><b>{bangkokTime(lastReceivedAt)}</b></div>
          <div><b>{data.athletes.length}</b><small>นักกีฬา</small></div>
        </section>
        {mode === "live" && data.race.status !== "99" && <section className={`public-track-card ${data.tracker_status?.track_open ? "open" : ""}`}>
          <div className="public-track-summary">
            <span><Satellite/></span>
            <div><small>สถานะระบบติดตาม</small><h3>{data.tracker_status?.track_open ? "ระบบติดตามเปิดแล้ว" : "กำลังเตรียมระบบติดตาม"}</h3></div>
          </div>
        </section>}
        {mode === "live" && data.race.status === "50" && !hasLiveTelemetry && <div className="public-telemetry-notice">
          <Activity/>
          <div>
            <b>ยังไม่มีข้อมูลตำแหน่ง ความเร็ว หรือลมส่งเข้ามา</b>
            <span>สถานะ “ระบบติดตามเปิดแล้ว” ด้านบนเป็นสถานะอุปกรณ์ GPS เท่านั้น คนละระบบกับข้อมูลลมและความเร็วนักกีฬาที่แสดงด้านล่าง — หน้านี้จะอัปเดตให้อัตโนมัติทันทีที่มีข้อมูลส่งเข้ามา</span>
          </div>
        </div>}
        {(mode === "history" || data.race.status === "50") && <section className="public-metrics">
          <Metric icon={<Wind/>} label="ความเร็วลม" value={`${number(data.wind?.speed_knots)} นอต`} sub={bangkokTime(data.wind?.captured_at_ms)}/>
          <Metric icon={<Compass/>} label="ทิศที่ลมพัดมา" value={`${number(data.wind?.direction_degree, 0)}°`} sub={directionName(data.wind?.direction_degree)}/>
          <Metric icon={<Activity/>} label="สถานะข้อมูล" value={freshness(data.wind?.updated_at).label} sub={mode === "live" ? "อัปเดตแบบเรียลไทม์" : "ข้อมูลสุดท้ายของรอบ"}/>
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
            <div className="public-table-head"><span>เลขใบเรือ</span><span>ชื่อ</span><span>COG</span><span>COG เทียบทิศลมจริง</span><span>VMC</span></div>
            {data.athletes.map((item) => {
              const relative = buoyMinusCog(item.relative_signed_degree);
              return <div className="public-table-row" key={item.team_cd}>
                <span><b>{item.sail_no || "—"}</b></span><span>{item.team_name || item.team_cd}</span>
                <span>{item.cog_degree == null ? "—" : `${number(item.cog_degree, 0)}°`}</span>
                <span className={relative == null ? "" : relative >= 0 ? "positive" : "negative"}>{relative == null ? "—" : `${relative > 0 ? "+" : ""}${number(relative, 0)}°`}</span>
                <span>{item.vmc_knots == null ? "—" : `${number(item.vmc_knots)} นอต`}</span>
              </div>;
            })}
          </section>
          <AthleteDetail athletes={data.athletes} teamCd={teamCd} onSelect={setTeamCd} selected={selected} rows={history} live/>
        </> : <AthleteDetail athletes={data.athletes} teamCd={teamCd} onSelect={setTeamCd} selected={selected} rows={history}/>}
      </>}
      <footer className="public-footer">COG เทียบทิศลมจริง แสดงค่าหลังปรับให้อยู่ระหว่าง −180° ถึง 180° · COG คือทิศทางการเคลื่อนที่ ไม่ใช่ทิศหัวเรือ</footer>
    </main>
  );
}

function Metric({icon, label, value, sub}: {icon: React.ReactNode; label: string; value: string; sub: string}) {
  return <div className="public-metric"><span>{icon}{label}</span><b>{value}</b><small>{sub}</small></div>;
}

function AthleteDetail({
  athletes,
  teamCd,
  onSelect,
  selected,
  rows,
  live = false,
}: {
  athletes: PublicAthlete[];
  teamCd: string;
  onSelect: (teamCd: string) => void;
  selected?: PublicAthlete;
  rows: PublicAthlete[];
  live?: boolean;
}) {
  const [cursor, setCursor] = useState(Math.max(0, rows.length - 1));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    setCursor(Math.max(0, rows.length - 1));
    setPlaying(false);
  }, [rows]);
  useEffect(() => {
    if (live || !playing || rows.length < 2) return;
    const timer = window.setInterval(() => {
      setCursor((value) => value >= rows.length - 1 ? 0 : value + 1);
    }, 1000 / speed);
    return () => window.clearInterval(timer);
  }, [live, playing, rows.length, speed]);
  const current = live ? rows.at(-1) : rows[cursor];
  const canScrub = !live && rows.length > 1;
  return <section className="public-history-grid">
    <aside className="public-roster"><h3>เลือกนักกีฬา</h3>{athletes.map((item) =>
      <button className={teamCd === item.team_cd ? "active" : ""} key={item.team_cd} onClick={() => onSelect(item.team_cd)}>
        <b>{item.sail_no || "—"}</b><span>{item.team_name || item.team_cd}<small>{item.nationality || "—"}</small></span>
      </button>)}
    </aside>
    <div className="public-history-panel"><h3>{selected?.team_name || "ข้อมูลนักกีฬา"}</h3>
      <div className="public-metrics compact">
        <Metric icon={<Compass/>} label={live ? "ทิศทางล่าสุด (COG)" : "ทิศทาง (COG)"} value={`${number(current?.cog_degree, 0)}°`} sub={bangkokTime(current?.captured_at_ms)}/>
        <Metric icon={<Wind/>} label={live ? "ความเร็วลมล่าสุด" : "ความเร็วลม"} value={`${number(current?.wind_speed_knots)} นอต`} sub={directionName(current?.wind_direction_degree)}/>
        <Metric icon={<Compass/>} label={live ? "ทิศลมล่าสุด" : "ทิศลม"} value={`${number(current?.wind_direction_degree, 0)}°`} sub="ทิศที่ลมพัดมา"/>
        <Metric icon={<Wind/>} label="มุมเส้นทางเทียบลม" value={current?.relative_angle_degree == null ? "—" : `${number(current.relative_angle_degree, 0)}°`} sub="คำนวณจากทิศทางและลม"/>
        <Metric icon={<Gauge/>} label={live ? "VMC ล่าสุด" : "VMC"} value={`${number(current?.vmc_knots)} นอต`} sub={`${rows.length} จุดข้อมูล`}/>
      </div>
      {canScrub && <div className="replay-controls">
        <button aria-label="กลับไปจุดเริ่มต้น" onClick={() => {setPlaying(false); setCursor(0);}}><RotateCcw/></button>
        <button className="play" aria-label={playing ? "หยุดชั่วคราว" : "เล่นย้อนหลัง"} onClick={() => setPlaying((value) => !value)}>{playing ? <Square/> : <Play/>}</button>
        <input
          className="timeline-input"
          aria-label="ตำแหน่งเวลาในการเล่นย้อนหลัง"
          type="range"
          min="0"
          max={rows.length - 1}
          value={cursor}
          onChange={(event) => {setPlaying(false); setCursor(Number(event.target.value));}}
        />
        <select aria-label="ความเร็วการเล่น" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
          <option value=".5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option>
        </select>
      </div>}
      <HistoryChart rows={rows} live={live} cursor={live ? undefined : cursor}/>
    </div>
  </section>;
}

function HistoryChart({rows, live = false, cursor}: {rows: PublicAthlete[]; live?: boolean; cursor?: number}) {
  if (!rows.length) return <div className="public-chart-empty">{live ? "กำลังรอข้อมูลสดของนักกีฬา…" : "กำลังโหลดข้อมูลย้อนหลัง…"}</div>;
  const values = rows.map((row) => row.sog_knots || 0);
  const max = Math.max(...values, 1);
  const toXY = (value: number, index: number) => ({
    x: index / Math.max(values.length - 1, 1) * 100,
    y: 94 - value / max * 82,
  });
  const points = values.map((value, index) => { const p = toXY(value, index); return `${p.x},${p.y}`; }).join(" ");
  const marker = cursor != null && rows[cursor] ? toXY(values[cursor], cursor) : null;
  return <div className="public-chart">
    <div><b>ความเร็วตามเวลา</b><span>{live ? "อัปเดตแบบเรียลไทม์ · " : ""}แสดงหนึ่งจุดทุก 5 วินาที</span></div>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points={points}/>
      {marker && <line className="chart-cursor-line" x1={marker.x} y1="0" x2={marker.x} y2="100"/>}
      {marker && <circle className="chart-cursor-dot" cx={marker.x} cy={marker.y} r="1.8"/>}
    </svg>
  </div>;
}
