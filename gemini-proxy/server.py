import itertools
import json
import os
import re
import threading
import time
from typing import Optional

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response, StreamingResponse


app = FastAPI(title="AI Scholar Hub Gemini Proxy")

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"

PROXY_API_KEY = os.environ["GEMINI_PROXY_API_KEY"]

_gemini_key_vars = sorted(
    (
        name
        for name in os.environ
        if re.fullmatch(r"GEMINI_KEY_[1-9]\d*", name)
    ),
    key=lambda name: int(name.rsplit("_", 1)[1]),
)

_gemini_key_numbers = [
    int(name.rsplit("_", 1)[1])
    for name in _gemini_key_vars
]

if (
    not _gemini_key_numbers
    or _gemini_key_numbers
    != list(range(1, max(_gemini_key_numbers) + 1))
):
    raise RuntimeError(
        "GEMINI_KEY_n variables must be contiguous starting with GEMINI_KEY_1"
    )

GEMINI_KEYS = [
    os.environ[name].strip()
    for name in _gemini_key_vars
]

if not all(GEMINI_KEYS):
    raise RuntimeError("Gemini API keys must not be empty")

if len(set(GEMINI_KEYS)) != len(GEMINI_KEYS):
    raise RuntimeError("All GEMINI_KEY_n values must be different")

key_cycle = itertools.cycle(range(len(GEMINI_KEYS)))
cycle_lock = threading.Lock()

# Gemini 3 thought signatures must survive the tool-call round trip.
# Map the OpenAI-compatible tool-call ID to the signature returned by Gemini.
thought_signatures = {}
thought_signatures_lock = threading.Lock()


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



def google_error_fields(response):
    """Extract only sanitized Gemini error metadata; never log keys or request content."""
    if response.status_code < 400:
        return "", ""

    try:
        payload = response.json()
        error = payload.get("error", {}) if isinstance(payload, dict) else {}
        status = str(error.get("status", "") or "")[:80]
        message = " ".join(str(error.get("message", "") or "").split())[:500]
        return status, message
    except Exception:
        try:
            text = " ".join(response.text.split())[:500]
            return "UNPARSED_UPSTREAM_ERROR", text
        except Exception:
            return "UNPARSED_UPSTREAM_ERROR", ""


def log_provider_attempt(model, key_index, status, elapsed_ms, response=None):
    google_status = ""
    google_message = ""

    if response is not None:
        google_status, google_message = google_error_fields(response)

    print(
        "GEMINI PROVIDER ATTEMPT "
        f"provider=gemini "
        f"model={model or '-'} "
        f"keySlot={key_index + 1} "
        f"status={status} "
        f"elapsedMs={elapsed_ms:.1f} "
        f"googleStatus={google_status!r} "
        f"googleMessage={google_message!r}",
        flush=True,
    )


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
            {
                "id": "gemini-3.8-flash",
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
    model = str(request_json.get("model", "") or "")

    # Restore Gemini thought signatures that LibreChat/LangChain omitted.
    #
    # Google requires the thought_signature to be returned on the same
    # assistant tool_call that originally received it.  We key the cache
    # by tool-call ID so parallel MCP calls remain independent.
    restored_signatures = 0

    for msg in request_json.get("messages", []):
        if msg.get("role") != "assistant":
            continue

        for tool_call in msg.get("tool_calls", []):
            call_id = tool_call.get("id")
            if not call_id:
                continue

            with thought_signatures_lock:
                signature = thought_signatures.get(call_id)

            if not signature:
                continue

            extra_content = tool_call.get("extra_content")
            if not isinstance(extra_content, dict):
                extra_content = {}

            google_content = extra_content.get("google")
            if not isinstance(google_content, dict):
                google_content = {}

            if "thought_signature" not in google_content:
                google_content["thought_signature"] = signature
                extra_content["google"] = google_content
                tool_call["extra_content"] = extra_content
                restored_signatures += 1

    if restored_signatures:
        body = json.dumps(request_json).encode("utf-8")
        print(
            f"GEMINI THOUGHT SIGNATURE RESTORE count={restored_signatures}",
            flush=True,
        )

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
                    model=model,
                )

            attempt_start = time.perf_counter()

            async with httpx.AsyncClient(timeout=None) as client:
                response = await client.post(
                    f"{GEMINI_BASE_URL}/chat/completions",
                    content=body,
                    headers=headers,
                )

            elapsed_ms = (time.perf_counter() - attempt_start) * 1000
            log_provider_attempt(
                model,
                key_index,
                response.status_code,
                elapsed_ms,
                response,
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
            print(
                f"GEMINI UPSTREAM ERROR {response.status_code}: "
                f"{response.text[:4000]}",
                flush=True,
            )
            return Response(
                content=response.content,
                status_code=response.status_code,
                media_type=response.headers.get(
                    "content-type",
                    "application/json",
                ),
            )

        except httpx.RequestError as exc:
            elapsed_ms = (
                (time.perf_counter() - attempt_start) * 1000
                if "attempt_start" in locals()
                else 0.0
            )
            print(
                "GEMINI PROVIDER ATTEMPT "
                f"provider=gemini model={model or '-'} "
                f"keySlot={key_index + 1} "
                f"status=REQUEST_ERROR "
                f"elapsedMs={elapsed_ms:.1f} "
                f"errorType={type(exc).__name__}",
                flush=True,
            )
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


async def stream_request(
    body: bytes,
    headers: dict,
    key_index: int,
    model: str,
):
    """
    Streaming request.

    Important: failover is possible before the upstream stream starts,
    but once bytes have started flowing we cannot safely switch keys
    mid-generation.
    """

    client = httpx.AsyncClient(timeout=None)

    try:
        attempt_start = time.perf_counter()

        upstream = await client.send(
            client.build_request(
                "POST",
                f"{GEMINI_BASE_URL}/chat/completions",
                content=body,
                headers=headers,
            ),
            stream=True,
        )

        elapsed_ms = (time.perf_counter() - attempt_start) * 1000

        if upstream.status_code in (429, 503):
            await upstream.aread()
            log_provider_attempt(
                model,
                key_index,
                upstream.status_code,
                elapsed_ms,
                upstream,
            )
            await upstream.aclose()
            await client.aclose()

            # Try every remaining key before giving up.
            for offset in range(1, len(GEMINI_KEYS)):
                next_index = (
                    key_index + offset
                ) % len(GEMINI_KEYS)
                retry_client = httpx.AsyncClient(timeout=None)

                retry_headers = {
                    "Authorization": f"Bearer {GEMINI_KEYS[next_index]}",
                    "Content-Type": "application/json",
                }

                retry_start = time.perf_counter()

                retry_upstream = await retry_client.send(
                    retry_client.build_request(
                        "POST",
                        f"{GEMINI_BASE_URL}/chat/completions",
                        content=body,
                        headers=retry_headers,
                    ),
                    stream=True,
                )

                retry_elapsed_ms = (time.perf_counter() - retry_start) * 1000

                if retry_upstream.status_code < 400:
                    log_provider_attempt(
                        model,
                        next_index,
                        retry_upstream.status_code,
                        retry_elapsed_ms,
                        retry_upstream,
                    )
                    return StreamingResponse(
                        stream_response(
                            retry_upstream,
                            retry_client,
                        ),
                        status_code=retry_upstream.status_code,
                        media_type="text/event-stream",
                    )

                await retry_upstream.aread()
                log_provider_attempt(
                    model,
                    next_index,
                    retry_upstream.status_code,
                    retry_elapsed_ms,
                    retry_upstream,
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

            print(
                f"GEMINI STREAM UPSTREAM ERROR {status}: "
                f"{content[:4000]!r}",
                flush=True,
            )

            await upstream.aclose()
            await client.aclose()

            return Response(
                content=content,
                status_code=status,
                media_type=content_type,
            )

        log_provider_attempt(
            model,
            key_index,
            upstream.status_code,
            elapsed_ms,
            upstream,
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
    # Buffer SSE data because HTTP chunks do not necessarily align with
    # complete SSE events.
    sse_buffer = ""
    tool_call_ids_by_index = {}

    def process_sse_event(data):
        if not data or data == "[DONE]":
            return

        try:
            event = json.loads(data)
        except json.JSONDecodeError:
            return

        for choice in event.get("choices", []):
            delta = choice.get("delta", {})

            for tool_call in delta.get("tool_calls", []):
                index = tool_call.get("index")
                call_id = tool_call.get("id")

                if index is not None and call_id:
                    tool_call_ids_by_index[index] = call_id

                extra_content = tool_call.get("extra_content")
                if not isinstance(extra_content, dict):
                    continue

                google_content = extra_content.get("google")
                if not isinstance(google_content, dict):
                    continue

                signature = google_content.get("thought_signature")
                if not signature:
                    continue

                if not call_id and index is not None:
                    call_id = tool_call_ids_by_index.get(index)

                if not call_id:
                    print(
                        "GEMINI THOUGHT SIGNATURE WITHOUT CALL ID "
                        f"index={index}",
                        flush=True,
                    )
                    continue

                with thought_signatures_lock:
                    thought_signatures[call_id] = signature

                print(
                    "GEMINI THOUGHT SIGNATURE STORED "
                    f"call_id={call_id} index={index}",
                    flush=True,
                )

    try:
        async for chunk in upstream.aiter_bytes():
            try:
                sse_buffer += chunk.decode("utf-8", errors="ignore")

                # SSE events are separated by a blank line.
                while "\n\n" in sse_buffer:
                    event_text, sse_buffer = sse_buffer.split("\n\n", 1)

                    data_lines = []

                    for line in event_text.splitlines():
                        if line.startswith("data: "):
                            data_lines.append(line[6:])

                    if data_lines:
                        process_sse_event("\n".join(data_lines).strip())

            except Exception as e:
                # Never allow diagnostic parsing to interfere with streaming.
                print(
                    f"GEMINI THOUGHT SIGNATURE PARSE ERROR: {type(e).__name__}",
                    flush=True,
                )

            yield chunk

    finally:
        # Process a final complete event if one remains buffered.
        try:
            if sse_buffer.strip():
                data_lines = []

                for line in sse_buffer.splitlines():
                    if line.startswith("data: "):
                        data_lines.append(line[6:])

                if data_lines:
                    process_sse_event("\n".join(data_lines).strip())
        except Exception:
            pass

        await upstream.aclose()
        await client.aclose()
