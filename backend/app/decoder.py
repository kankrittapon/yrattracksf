import base64
import json
import math
import re
from dataclasses import dataclass
from typing import Any

from lzstring import LZString

HEX_ID = re.compile(rb"[0-9a-f]{32}", re.IGNORECASE)


def wrap_to_180(value: float) -> float:
    wrapped = (value + 180.0) % 360.0 - 180.0
    return 180.0 if wrapped == -180.0 else wrapped


def course_to_wind(sog_knots: float, cog_degree: float, wind_from_degree: float) -> dict[str, float]:
    signed = wrap_to_180(cog_degree - wind_from_degree)
    absolute = abs(signed)
    return {
        "relative_signed_degree": signed,
        "relative_angle_degree": absolute,
        "upwind_vmg_knots": sog_knots * math.cos(math.radians(absolute)),
    }


def decode_snapshot_result(compressed: str) -> dict[str, Any]:
    value = compressed.replace(" ", "+")
    decoded = None
    decoders = (
        LZString().decompressFromEncodedURIComponent,
        LZString().decompressFromBase64,
    ) if any(item in value for item in ("-", "$")) else (
        LZString().decompressFromBase64,
        LZString().decompressFromEncodedURIComponent,
    )
    for decoder in decoders:
        try:
            decoded = decoder(value)
        except (KeyError, TypeError, ValueError):
            continue
        if decoded:
            break
    if not decoded:
        raise ValueError("Unable to decompress SailFish snapshot")
    value = json.loads(decoded)
    if not isinstance(value, dict):
        raise ValueError("Snapshot root must be an object")
    return value


def _number(runtime: list[Any], index: int) -> float | None:
    if index >= len(runtime) or runtime[index] in ("", None):
        return None
    try:
        return float(runtime[index])
    except (TypeError, ValueError):
        return None


def _integer(runtime: list[Any], index: int) -> int | None:
    value = _number(runtime, index)
    return int(value) if value is not None else None


def normalize_team(team: dict[str, Any]) -> dict[str, Any]:
    runtime = team.get("runtime") or []
    return {
        "race_cd": team.get("raceCd"),
        "team_cd": team.get("teamCd"),
        "team_name": team.get("teamName"),
        "sail_no": team.get("sailNo"),
        "device_cd": team.get("deviceCd"),
        "nationality": team.get("nationality"),
        "sog_knots": _number(runtime, 10),
        "cog_degree": _number(runtime, 16),
        "latitude": _number(runtime, 17),
        "longitude": _number(runtime, 18),
        "captured_at_ms": _integer(runtime, 22),
        "received_at_ms": _integer(runtime, 23),
        "relative_signed_degree": None,
        "relative_angle_degree": None,
        "upwind_vmg_knots": None,
        "wind_reading_captured_at_ms": None,
        "vmc_knots": _number(runtime, 27),
        "raw_runtime": runtime,
    }


def normalize_wind(instrument: dict[str, Any]) -> dict[str, Any]:
    runtime = instrument.get("runtime") or []
    return {
        "race_cd": instrument.get("raceCd"),
        "wind_instrument_cd": instrument.get("windInstrumentCd"),
        "wind_instrument_name": instrument.get("windInstrumentName"),
        "device_cd": instrument.get("deviceCd"),
        "roll_type": instrument.get("rollType"),
        "speed_knots": _number(runtime, 10),
        "direction_degree": _number(runtime, 16),
        "latitude": _number(runtime, 17),
        "longitude": _number(runtime, 18),
        "captured_at_ms": _integer(runtime, 22),
        "received_at_ms": _integer(runtime, 23),
        "raw_runtime": runtime,
    }


@dataclass(slots=True)
class LiveFrame:
    kind: str
    payload: Any
    raw_text: str
    entity_ids: list[str]


def decode_live_frame(message: str) -> LiveFrame:
    if message == "\n":
        return LiveFrame("heartbeat", None, message, [])
    try:
        payload = json.loads(message)
        kind = "command" if isinstance(payload, dict) and payload.get("k") == "CMD" else "json"
        return LiveFrame(kind, payload, message, [])
    except json.JSONDecodeError:
        pass

    try:
        binary = base64.b64decode(message, validate=True)
    except Exception:
        return LiveFrame("unknown_text", message, message, [])

    entity_ids = [match.decode("ascii").lower() for match in HEX_ID.findall(binary)]
    return LiveFrame(
        "binary",
        {"size": len(binary), "base64": message},
        message,
        list(dict.fromkeys(entity_ids)),
    )
