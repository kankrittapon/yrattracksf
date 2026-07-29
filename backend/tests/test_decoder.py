import json

from lzstring import LZString

from app.decoder import (
    bearing_degree,
    build_mark_positions,
    calculate_vmc,
    course_to_wind,
    decode_live_frame,
    decode_snapshot_result,
    normalize_team,
    resolve_mark_target,
    wrap_to_180,
)


def test_wrap_to_180() -> None:
    assert wrap_to_180(190) == -170
    assert wrap_to_180(-190) == 170
    assert wrap_to_180(360) == 0


def test_course_to_wind() -> None:
    result = course_to_wind(4, 45, 0)
    assert result["relative_signed_degree"] == 45
    assert result["relative_angle_degree"] == 45
    assert round(result["upwind_vmg_knots"], 5) == 2.82843


def test_bearing_degree_cardinal_directions() -> None:
    assert round(bearing_degree(0, 0, 1, 0), 3) == 0.0
    assert round(bearing_degree(0, 0, 0, 1), 3) == 90.0
    assert round(bearing_degree(0, 0, -1, 0), 3) == 180.0
    assert round(bearing_degree(0, 0, 0, -1), 3) == 270.0


def test_build_mark_positions_aliases_finish_to_start_line() -> None:
    snapshot = {
        "navigationMark": [
            {"position": "startA", "navigationMarkName": "startA"},
            {"position": "startB", "navigationMarkName": "startB"},
            {"position": "finishA", "navigationMarkName": "finishA"},
            {"position": "finishB", "navigationMarkName": "finishB"},
            {"position": "point", "navigationMarkName": "1"},
        ],
        "markpositions": [
            {"lat": 12.0, "lng": 100.0},
            {"lat": 12.1, "lng": 100.1},
            {"lat": 12.5, "lng": 100.5},
        ],
    }
    positions = build_mark_positions(snapshot)
    assert positions["startA"] == (12.0, 100.0)
    assert positions["1"] == (12.5, 100.5)
    assert positions["finishA"] == positions["startA"]
    assert positions["finishB"] == positions["startB"]


def test_resolve_mark_target_averages_gate_marks() -> None:
    positions = {"4s": (10.0, 20.0), "4p": (12.0, 22.0)}
    assert resolve_mark_target(positions, "4s/4p") == (11.0, 21.0)
    assert resolve_mark_target(positions, "4s") == (10.0, 20.0)
    assert resolve_mark_target(positions, "unknown") is None
    assert resolve_mark_target(positions, None) is None


def test_calculate_vmc_matches_sog_when_heading_straight_at_mark() -> None:
    mark_positions = {"1": (1.0, 0.0)}
    row = {
        "sog_knots": 5.0,
        "cog_degree": 0.0,
        "latitude": 0.0,
        "longitude": 0.0,
        "raw_runtime": [""] * 14 + ["1"],
    }
    result = calculate_vmc(row, mark_positions)
    assert round(result["vmc_knots"], 5) == 5.0


def test_calculate_vmc_negative_when_heading_away_from_mark() -> None:
    mark_positions = {"1": (1.0, 0.0)}
    row = {
        "sog_knots": 5.0,
        "cog_degree": 180.0,
        "latitude": 0.0,
        "longitude": 0.0,
        "raw_runtime": [""] * 14 + ["1"],
    }
    result = calculate_vmc(row, mark_positions)
    assert round(result["vmc_knots"], 5) == -5.0


def test_calculate_vmc_none_when_mark_unresolved() -> None:
    row = {
        "sog_knots": 5.0,
        "cog_degree": 0.0,
        "latitude": 0.0,
        "longitude": 0.0,
        "raw_runtime": [""] * 14 + ["unknown-mark"],
    }
    assert calculate_vmc(row, {}) == {"vmc_knots": None}


def test_normalize_team_uses_team_identity() -> None:
    runtime = [""] * 51
    runtime[10] = "2.5"
    runtime[16] = "270"
    runtime[17] = "12.6"
    runtime[18] = "100.9"
    runtime[22] = "1784963889000"
    runtime[23] = "1784963884400"
    result = normalize_team({
        "raceCd": "race",
        "teamCd": "team-a",
        "deviceCd": "shared-device",
        "runtime": runtime,
    })
    assert result["team_cd"] == "team-a"
    assert result["sog_knots"] == 2.5
    assert result["captured_at_ms"] == 1784963889000
    assert result["relative_signed_degree"] is None
    assert result["relative_angle_degree"] is None
    assert result["upwind_vmg_knots"] is None
    assert result["wind_reading_captured_at_ms"] is None
    assert result["vmc_knots"] is None


def test_live_frame_types() -> None:
    assert decode_live_frame("\n").kind == "heartbeat"
    command = decode_live_frame(json.dumps({"k": "CMD", "v": "CONNECTED"}))
    assert command.kind == "command"
    sample = "ciIgOGZlMDllNDY1NzdjNGIxODhlNDg5NmFjN2U1NTk1NDZdEAaePY0BAABAQJEBl/+QfvtSKUCZAQK4WbxYOllAqAEKuAGYwY7B+jPAAaCkjsH6Mw=="
    binary = decode_live_frame(sample)
    assert binary.kind == "binary"
    assert "8fe09e46577c4b188e4896ac7e559546" in binary.entity_ids


def test_replay_uri_safe_payload() -> None:
    payload = {"team-1": [["", "value"]], "kind": "replay"}
    compressed = LZString().compressToEncodedURIComponent(json.dumps(payload))
    assert decode_snapshot_result(compressed) == payload
