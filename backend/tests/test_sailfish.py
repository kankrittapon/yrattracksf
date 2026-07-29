import httpx

from app.config import Settings
from app.sailfish import SailfishClient


async def test_discover_races_reads_every_page() -> None:
    requested_pages: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        page_no = int(request.url.params["pageNo"])
        requested_pages.append(page_no)
        start = (page_no - 1) * 50
        stop = min(start + 50, 55)
        rows = [
            {"matchCd": f"match-{index}", "matchName": f"Match {index}"}
            for index in range(start, stop)
        ]
        return httpx.Response(200, json={"data": {"list": rows, "total": 55}})

    client = SailfishClient(Settings(_env_file=None))
    await client.http.aclose()
    client.http = httpx.AsyncClient(
        base_url="https://www.saill.cn",
        transport=httpx.MockTransport(handler),
    )
    client.access_token = "test-token"

    rows = await client.discover_races()
    await client.close()

    assert len(rows) == 55
    assert requested_pages == [1, 2]
    assert rows[-1]["matchCd"] == "match-54"
