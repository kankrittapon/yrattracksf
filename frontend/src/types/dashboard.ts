export type Section = "overview" | "live" | "history" | "compare" | "control" | "quality" | "settings";

export interface Race {
  race_cd: string;
  match_cd: string;
  level_cd: string | null;
  name: string | null;
  rounds: string | null;
  group_name: string | null;
  sailfish_status: string | null;
  main_wind_instrument_cd: string | null;
  start_at: string | null;
  end_at: string | null;
  history_imported_at: string | null;
  collection_enabled: boolean;
  updated_at: string;
  match?: {name: string} | null;
  race_class?: {
    name: string;
    public_live_enabled?: boolean;
    public_history_enabled?: boolean;
  } | null;
}

export interface Match {
  match_cd: string;
  name: string;
  starts_at: string | null;
  ends_at: string | null;
  is_public: boolean;
  synced_at: string;
}

export interface RaceClass {
  level_cd: string;
  match_cd: string;
  name: string;
  public_live_enabled: boolean;
  public_history_enabled: boolean;
}

export interface HistoryImport {
  race_cd: string;
  status: "pending" | "running" | "completed" | "error";
  scheduled_for: string;
  progress_percent: number;
  athlete_readings_count: number;
  wind_readings_count: number;
  last_error: string | null;
}

export interface Team {
  race_cd: string;
  team_cd: string;
  team_name: string | null;
  sail_no: string | null;
  nationality: string | null;
  device_cd: string | null;
}

export interface AthleteState {
  race_cd: string;
  team_cd: string;
  captured_at_ms: number;
  sog_knots: number | null;
  cog_degree: number | null;
  latitude: number | null;
  longitude: number | null;
  relative_signed_degree: number | null;
  relative_angle_degree: number | null;
  upwind_vmg_knots: number | null;
  updated_at: string;
}

export interface WindState {
  race_cd: string;
  wind_instrument_cd: string;
  captured_at_ms: number;
  speed_knots: number | null;
  direction_degree: number | null;
  latitude: number | null;
  longitude: number | null;
  updated_at: string;
}

export interface Collector {
  race_cd: string;
  state: string;
  websocket_connected: boolean;
  sailfish_status: string | null;
  last_message_at: string | null;
  last_error: string | null;
  messages_received: number;
  reconnects: number;
}
