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


def bearing_degree(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing (0-360, 0 = north) from point 1 to point 2."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_lon = math.radians(lon2 - lon1)
    x = math.sin(delta_lon) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lon)
    return math.degrees(math.atan2(x, y)) % 360.0


def build_mark_positions(snapshot: dict[str, Any]) -> dict[str, tuple[float, float]]:
    """Map navigationMarkName -> (lat, lon), aliasing the finish line to the start line.

    SailFish's ``navigationMark`` entries carry no coordinates of their own;
    the coordinates live in the parallel ``markpositions`` array, in the same
    order as the non-finish entries of ``navigationMark``. ``markpositions``
    only grows entries for marks that have actually been set/reported so far
    (course marks past the ones sailed this race may still be missing), so
    it is frequently shorter than the non-finish mark list — zip only maps
    what's available rather than requiring an exact count match, so marks
    that ARE resolvable aren't discarded just because later ones aren't.
    """
    marks = snapshot.get("navigationMark") or []
    positions = snapshot.get("markpositions") or []
    finish_positions = {"finishA", "finishB"}
    non_finish = [mark for mark in marks if mark.get("position") not in finish_positions]

    resolved: dict[str, tuple[float, float]] = {}
    for mark, point in zip(non_finish, positions):
        name = mark.get("navigationMarkName")
        lat, lon = point.get("lat"), point.get("lng")
        if name and lat not in (None, "") and lon not in (None, ""):
            resolved[str(name)] = (float(lat), float(lon))

    by_position = {mark.get("position"): mark.get("navigationMarkName") for mark in marks}
    for start_key, finish_key in (("startA", "finishA"), ("startB", "finishB")):
        start_name = by_position.get(start_key)
        finish_name = by_position.get(finish_key)
        if start_name in resolved and finish_name:
            resolved[str(finish_name)] = resolved[start_name]
    return resolved


def resolve_finish_target(snapshot: dict[str, Any]) -> tuple[float, float] | None:
    """Position of the finish line (average of finishA/finishB).

    Intermediate course marks (1, 2, 3p, ...) frequently have no GPS fix
    reported at all for a given race, which would leave VMC null most of
    the time if measured against "whichever mark the team is currently
    sailing toward". The finish line is the one target that's reliably
    known for the whole race (it's either the finish gate itself or the
    start line it's aliased to on windward/leeward courses) - matching how
    SailFish's own site keeps its VMC column populated continuously rather
    than going blank between marks.
    """
    marks = snapshot.get("navigationMark") or []
    positions = build_mark_positions(snapshot)
    by_position = {mark.get("position"): mark.get("navigationMarkName") for mark in marks}
    finish_names = [by_position.get(key) for key in ("finishA", "finishB")]
    points = [positions[name] for name in finish_names if name and name in positions]
    if not points:
        return None
    return (
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    )


def calculate_vmc(
    row: dict[str, Any], finish_target: tuple[float, float] | None
) -> dict[str, float | None]:
    """Velocity Made good on Course: the speed component toward the finish line.

    Mirrors ``course_to_wind`` but measures the bearing to the finish
    instead of the wind direction.
    """
    if (
        finish_target is None
        or row.get("sog_knots") is None
        or row.get("cog_degree") is None
        or row.get("latitude") is None
        or row.get("longitude") is None
    ):
        return {"vmc_knots": None}
    bearing = bearing_degree(row["latitude"], row["longitude"], finish_target[0], finish_target[1])
    signed = wrap_to_180(row["cog_degree"] - bearing)
    return {"vmc_knots": row["sog_knots"] * math.cos(math.radians(signed))}


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
        "vmc_knots": None,
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
