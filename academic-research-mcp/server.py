import os
import asyncio
import time
import httpx
from cachetools import TTLCache
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

S2_API_KEY = os.environ["SEMANTIC_SCHOLAR_API_KEY"]
S2_BASE = "https://api.semanticscholar.org/graph/v1"

mcp = FastMCP(
    "Academic Research",
    stateless_http=True,
    json_response=True,
    transport_security=TransportSecuritySettings(
        allowed_hosts=[
            "academic-research-mcp",
            "academic-research-mcp:*",
            "localhost:*",
            "127.0.0.1:*",
        ],
    ),
)

cache = TTLCache(maxsize=1000, ttl=300)
rate_lock = asyncio.Lock()
last_request = 0.0


async def s2_get(path: str, params: dict):
    global last_request

    key = (path, tuple(sorted(params.items())))
    if key in cache:
        return cache[key]

    async with rate_lock:
        wait = 1.0 - (time.monotonic() - last_request)
        if wait > 0:
            await asyncio.sleep(wait)

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{S2_BASE}/{path}",
                params=params,
                headers={"x-api-key": S2_API_KEY},
            )

        last_request = time.monotonic()

    response.raise_for_status()
    data = response.json()
    cache[key] = data
    return data


@mcp.tool()
async def search_papers(
    query: str,
    limit: int = 10,
    year: str | None = None,
) -> dict:
    """Search Semantic Scholar for academic papers.

    Returns paper titles, authors, publication year, abstract,
    citation count, DOI and open-access/PDF information when available.
    """
    limit = max(1, min(limit, 100))

    params = {
        "query": query,
        "limit": limit,
        "fields": (
            "paperId,title,abstract,authors,year,"
            "citationCount,influentialCitationCount,"
            "externalIds,openAccessPdf,url"
        ),
    }

    if year:
        params["year"] = year

    return await s2_get("paper/search", params)


@mcp.tool()
async def get_paper(paper_id: str) -> dict:
    """Retrieve detailed metadata for a Semantic Scholar paper by paper ID, DOI or other supported identifier."""
    params = {
        "fields": (
            "paperId,title,abstract,authors,year,"
            "citationCount,influentialCitationCount,"
            "externalIds,openAccessPdf,url,publicationDate,"
            "journal,venue,fieldsOfStudy"
        )
    }

    return await s2_get(f"paper/{paper_id}", params)


@mcp.tool()
async def get_author(author_id: str) -> dict:
    """Retrieve Semantic Scholar author information and publication statistics."""
    params = {
        "fields": "authorId,name,affiliations,paperCount,citationCount,hIndex"
    }

    return await s2_get(f"author/{author_id}", params)


@mcp.tool()
async def get_citations(
    paper_id: str,
    limit: int = 20,
) -> dict:
    """Retrieve papers that cite a specified Semantic Scholar paper."""
    limit = max(1, min(limit, 100))

    params = {
        "limit": limit,
        "fields": (
            "paperId,title,abstract,authors,year,"
            "citationCount,externalIds,url"
        ),
    }

    return await s2_get(f"paper/{paper_id}/citations", params)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        mcp.streamable_http_app(),
        host="0.0.0.0",
        port=8000,
    )
