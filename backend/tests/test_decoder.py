import json

from lzstring import LZString

from app.decoder import (
    course_to_wind,
    decode_live_frame,
    decode_snapshot_result,
    normalize_team,
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
