"""Summarize diagnostic extension exports without printing credentials."""

import json
import sys
from collections import Counter
from pathlib import Path

from app.decoder import decode_live_frame, decode_snapshot_result


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python tools/inspect_export.py <sailfish-extension-log.json>")
    path = Path(sys.argv[1])
    document = json.loads(path.read_text(encoding="utf-8"))
    entries = document.get("entries") or []
    print(f"file={path.name} entries={len(entries)} dropped={document.get('droppedEntries', 0)}")
    for kind, count in Counter(item.get("type") for item in entries).most_common():
        print(f"{kind}: {count}")

    for entry in entries:
        if entry.get("type") == "cdp-websocket-message" and isinstance(entry.get("payload"), str):
            frame = decode_live_frame(entry["payload"])
            if frame.kind not in {"heartbeat", "command"}:
                print(f"live kind={frame.kind} entity_ids={frame.entity_ids}")
        response = entry.get("responseText")
        if isinstance(response, dict) and isinstance(response.get("result"), str):
            try:
                snapshot = decode_snapshot_result(response["result"])
            except Exception:
                continue
            print(
                "snapshot "
                f"race={snapshot.get('raceCd')} status={snapshot.get('status')} "
                f"teams={len(snapshot.get('teamList') or [])} "
                f"wind={len(snapshot.get('windInstrumentList') or [])}"
            )


if __name__ == "__main__":
    main()
