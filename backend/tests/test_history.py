from types import SimpleNamespace

from app.history import HistoryImportManager


def test_history_nearest_wind_and_freshness_window() -> None:
    manager = HistoryImportManager(
        SimpleNamespace(wind_freshness_seconds=5),
        SimpleNamespace(),
        SimpleNamespace(),
    )
    wind = [
        {"captured_at_ms": 1_000, "direction_degree": 0},
        {"captured_at_ms": 8_000, "direction_degree": 90},
    ]
    athletes = [
        {"captured_at_ms": 4_000, "sog_knots": 4, "cog_degree": 0},
        {"captured_at_ms": 20_000, "sog_knots": 4, "cog_degree": 0},
    ]

    manager._calculate_wind_metrics(athletes, wind)

    assert athletes[0]["relative_angle_degree"] == 0
    assert athletes[0]["upwind_vmg_knots"] == 4
    assert "relative_angle_degree" not in athletes[1]


def test_history_deduplicates_by_race_team_and_timestamp() -> None:
    rows = [
        {"race_cd": "r", "team_cd": "a", "captured_at_ms": 1, "sog_knots": 1},
        {"race_cd": "r", "team_cd": "a", "captured_at_ms": 1, "sog_knots": 2},
    ]
    result = HistoryImportManager._deduplicate(
        rows, ("race_cd", "team_cd", "captured_at_ms")
    )
    assert len(result) == 1
    assert result[0]["sog_knots"] == 2
