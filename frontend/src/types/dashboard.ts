export type Section = "overview" | "live" | "history" | "compare" | "control" | "quality" | "settings";

export interface Race {
  race_cd: string;
  name: string | null;
  rounds: string | null;
  group_name: string | null;
  sailfish_status: string | null;
  main_wind_instrument_cd: string | null;
  updated_at: string;
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
