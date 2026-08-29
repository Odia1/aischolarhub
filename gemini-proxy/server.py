import itertools
import os
import threading
from typing import Optional

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response, StreamingResponse


app = FastAPI(title="AI Scholar Hub Gemini Proxy")

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"

PROXY_API_KEY = os.environ["GEMINI_PROXY_API_KEY"]

GEMINI_KEYS = [
    os.environ["GEMINI_KEY_1"],
    os.environ["GEMINI_KEY_2"],
    os.environ["GEMINI_KEY_3"],
]

if len(set(GEMINI_KEYS)) != len(GEMINI_KEYS):
    raise RuntimeError("GEMINI_KEY_1, GEMINI_KEY_2 and GEMINI_KEY_3 must be different")

key_cycle = itertools.cycle(range(len(GEMINI_KEYS)))
cycle_lock = threading.Lock()


def next_key_index() -> int:
    with cycle_lock:
        return next(key_cycle)


def ordered_key_indices():
    """
    Start with the next round-robin key, then try the other keys.
    """
    first = next_key_index()
    return [(first + offset) % len(GEMINI_KEYS)
            for offset in range(len(GEMINI_KEYS))]


def authorized(auth_header: Optional[str]) -> bool:
    if not auth_header:
        return False

    expected = f"Bearer {PROXY_API_KEY}"
    return auth_header.strip() == expected


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/v1/models")
async def models(authorization: Optional[str] = Header(default=None)):
    if not authorized(authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Return the models that AI Scholar Hub exposes.
    return {
        "object": "list",
        "data": [
            {
                "id": "gemini-3.5-flash",
                "object": "model",
                "owned_by": "google",
            },
            {
                "id": "gemini-3.5-flash-lite",
                "object": "model",
                "owned_by": "google",
            },
            {
                "id": "gemini-3.7-flash",
                "object": "model",
                "owned_by": "google",
            },
        ],
    }


@app.api_route(
    "/v1/chat/completions",
    methods=["POST"],
)
async def chat_completions(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    if not authorized(authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")

    body = await request.body()

    if not body:
        raise HTTPException(status_code=400, detail="Empty request body")

    # We need to inspect whether this is a streaming request.
    try:
        request_json = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    is_streaming = bool(request_json.get("stream", False))

    last_response = None

    for key_index in ordered_key_indices():
        gemini_key = GEMINI_KEYS[key_index]

        headers = {
            "Authorization": f"Bearer {gemini_key}",
            "Content-Type": "application/json",
        }

        try:
            if is_streaming:
                return await stream_request(
                    body=body,
                    headers=headers,
                    key_index=key_index,
                )

            async with httpx.AsyncClient(timeout=None) as client:
                response = await client.post(
                    f"{GEMINI_BASE_URL}/chat/completions",
                    content=body,
                    headers=headers,
                )

            last_response = response

            # Successful response.
            if response.status_code < 400:
                return Response(
                    content=response.content,
                    status_code=response.status_code,
                    media_type=response.headers.get(
                        "content-type",
                        "application/json",
                    ),
                )

            # Rate-limit/quota response:
            # immediately try another Gemini key.
            if response.status_code in (429, 503):
                continue

            # Other errors belong to the request itself.
            return Response(
                content=response.content,
                status_code=response.status_code,
                media_type=response.headers.get(
                    "content-type",
                    "application/json",
                ),
            )

        except httpx.RequestError:
            # Try another key if the upstream request itself failed.
            continue

    if last_response is not None:
        return Response(
            content=last_response.content,
            status_code=last_response.status_code,
            media_type=last_response.headers.get(
                "content-type",
                "application/json",
            ),
        )

    raise HTTPException(
        status_code=503,
        detail="All Gemini API keys are currently unavailable",
    )


async def stream_request(body: bytes, headers: dict, key_index: int):
    """
    Streaming request.

    Important: failover is possible before the upstream stream starts,
    but once bytes have started flowing we cannot safely switch keys
    mid-generation.
    """

    client = httpx.AsyncClient(timeout=None)

    try:
        upstream = await client.send(
            client.build_request(
                "POST",
                f"{GEMINI_BASE_URL}/chat/completions",
                content=body,
                headers=headers,
            ),
            stream=True,
        )

        if upstream.status_code in (429, 503):
            await upstream.aclose()
            await client.aclose()

            # Try remaining keys before giving up.
            for next_index in [
                (key_index + 1) % len(GEMINI_KEYS),
                (key_index + 2) % len(GEMINI_KEYS),
            ]:
                retry_client = httpx.AsyncClient(timeout=None)

                retry_headers = {
                    "Authorization": f"Bearer {GEMINI_KEYS[next_index]}",
                    "Content-Type": "application/json",
                }

                retry_upstream = await retry_client.send(
                    retry_client.build_request(
                        "POST",
                        f"{GEMINI_BASE_URL}/chat/completions",
                        content=body,
                        headers=retry_headers,
                    ),
                    stream=True,
                )

                if retry_upstream.status_code < 400:
                    return StreamingResponse(
                        stream_response(
                            retry_upstream,
                            retry_client,
                        ),
                        status_code=retry_upstream.status_code,
                        media_type="text/event-stream",
                    )

                await retry_upstream.aclose()
                await retry_client.aclose()

            raise HTTPException(
                status_code=429,
                detail="All Gemini API keys are rate limited",
            )

        if upstream.status_code >= 400:
            content = await upstream.aread()
            status = upstream.status_code
            content_type = upstream.headers.get(
                "content-type",
                "application/json",
            )

            await upstream.aclose()
            await client.aclose()

            return Response(
                content=content,
                status_code=status,
                media_type=content_type,
            )

        return StreamingResponse(
            stream_response(upstream, client),
            status_code=upstream.status_code,
            media_type="text/event-stream",
        )

    except Exception:
        await client.aclose()
        raise


async def stream_response(upstream, client):
    try:
        async for chunk in upstream.aiter_bytes():
            yield chunk
    finally:
        await upstream.aclose()
        await client.aclose()
