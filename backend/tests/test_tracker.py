from app.tracker import signal_status


def test_signal_status_thresholds() -> None:
    now = 1_000_000
    assert signal_status(None, now, 15, 60) == "offline"
    assert signal_status(now - 5_000, now, 15, 60) == "online"
    assert signal_status(now - 30_000, now, 15, 60) == "stale"
    assert signal_status(now - 90_000, now, 15, 60) == "offline"
    assert signal_status(now + 5_000, now, 15, 60) == "online"
