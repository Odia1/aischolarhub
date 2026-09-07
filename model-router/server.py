import hashlib
import json
import math
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pymongo import MongoClient


app = FastAPI(title="AI Scholar Hub Model Router")


def env_flag(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be true or false")


ROUTER_ENABLED = env_flag("ASH_MODEL_ROUTER_ENABLED", default=True)

ROUTER_API_KEY = (
    os.environ.get("ASH_MODEL_ROUTER_API_KEY", "").strip()
    or os.environ.get("GEMINI_PROXY_API_KEY", "").strip()
)

if not ROUTER_API_KEY:
    raise RuntimeError(
        "ASH_MODEL_ROUTER_API_KEY or GEMINI_PROXY_API_KEY is required"
    )

RETRYABLE_STATUSES = {408, 429, 500, 502, 503, 504}
CREDENTIAL_OR_ROUTE_STATUSES = {401, 403, 404}
DEFAULT_COOLDOWN_SECONDS = 60


def csv_values(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    values = [value.strip() for value in raw.split(",") if value.strip()]
    if len(values) != len(set(values)):
        raise RuntimeError(f"{name} contains duplicate values")
    return values


@dataclass(frozen=True)
class Credential:
    provider: str
    slot: int
    secret: str
    account_id: str = ""

    @property
    def safe_id(self) -> str:
        prefixes = {
            "google": "G",
            "groq": "GR",
            "openrouter": "OR",
            "cloudflare": "CF",
        }
        return f"{prefixes[self.provider]}{self.slot:02d}"


@dataclass(frozen=True)
class Route:
    route_id: str
    model_class: str
    provider: str
    model: str
    weight: int
    fallback_only: bool = False


@dataclass
class CredentialState:
    next_index: int = 0
    cooldown_until: dict[int, float] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)


def load_credentials() -> dict[str, list[Credential]]:
    credentials = {
        "google": [
            Credential("google", index, secret)
            for index, secret in enumerate(
                csv_values("ASH_GOOGLE_API_KEYS"), start=1
            )
        ],
        "groq": [
            Credential("groq", index, secret)
            for index, secret in enumerate(
                csv_values("ASH_GROQ_API_KEYS"), start=1
            )
        ],
        "openrouter": [
            Credential("openrouter", index, secret)
            for index, secret in enumerate(
                csv_values("ASH_OPENROUTER_API_KEYS"), start=1
            )
        ],
    }

    account_ids = csv_values("ASH_CLOUDFLARE_ACCOUNT_IDS")
    tokens = csv_values("ASH_CLOUDFLARE_API_TOKENS")
    if len(account_ids) != len(tokens):
        raise RuntimeError(
            "ASH_CLOUDFLARE_ACCOUNT_IDS and ASH_CLOUDFLARE_API_TOKENS "
            "must contain the same number of entries"
        )

    credentials["cloudflare"] = [
        Credential("cloudflare", index, token, account_id)
        for index, (account_id, token) in enumerate(
            zip(account_ids, tokens, strict=True), start=1
        )
    ]
    return credentials


CREDENTIALS = load_credentials()
CREDENTIAL_STATES = {
    provider: CredentialState() for provider in CREDENTIALS
}

ROUTES = {
    "class-a": [
        Route(
            "google-gemini-3-7-flash",
            "class-a",
            "google",
            "gemini-3.7-flash",
            35,
        ),
        Route(
            "groq-gpt-oss-120b",
            "class-a",
            "groq",
            "openai/gpt-oss-120b",
            30,
        ),
        Route(
            "cloudflare-llama-3-3-70b",
            "class-a",
            "cloudflare",
            "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
            35,
        ),
        Route(
            "cloudflare-llama-3-1-70b",
            "class-a",
            "cloudflare",
            "@cf/meta/llama-3.1-70b-instruct-fp8-fast",
            1,
            fallback_only=True,
        ),
    ],
    "class-b": [
        Route(
            "google-gemini-3-5-flash",
            "class-b",
            "google",
            "gemini-3.5-flash",
            30,
        ),
        Route(
            "google-gemini-3-5-flash-lite",
            "class-b",
            "google",
            "gemini-3.5-flash-lite",
            25,
        ),
        Route(
            "groq-qwen-3-8-27b",
            "class-b",
            "groq",
            "qwen/qwen3.8-27b",
            20,
        ),
        Route(
            "cloudflare-qwen-3-8-27b",
            "class-b",
            "cloudflare",
            "@cf/qwen/qwen3.8-27b",
            10,
        ),
        Route(
            "cloudflare-gemma-4-26b",
            "class-b",
            "cloudflare",
            "@cf/google/gemma-4-26b-a4b-it",
            10,
        ),
        Route(
            "cloudflare-llama-3-1-8b",
            "class-b",
            "cloudflare",
            "@cf/meta/llama-3.1-8b-instruct-fast",
            5,
        ),
    ],
}

thought_signatures: dict[str, str] = {}
thought_signatures_lock = threading.Lock()

MONGO_URI = os.environ.get("MONGO_URI", "").strip()
mongo_client = MongoClient(MONGO_URI) if MONGO_URI else None
assignments = (
    mongo_client.get_database("LibreChat").get_collection(
        "modelRouteAssignments"
    )
    if mongo_client is not None
    else None
)
if assignments is not None:
    try:
        assignments.create_index("conversationId", unique=True)
        assignments.create_index([("userId", 1), ("updatedAt", -1)])
    except Exception as exc:
        print(
            "ROUTER ASSIGNMENT STORE INITIALIZATION DEFERRED "
            f"errorType={type(exc).__name__}",
            flush=True,
        )


def authorized(auth_header: Optional[str]) -> bool:
    return auth_header is not None and (
        auth_header.strip() == f"Bearer {ROUTER_API_KEY}"
    )


def conversation_key(request: Request, payload: dict) -> str:
    explicit = (
        request.headers.get("x-ais-conversation-id")
        or str(payload.get("conversation_id") or "").strip()
        or str(payload.get("conversationId") or "").strip()
    )
    if explicit:
        return explicit

    user = str(payload.get("user") or "anonymous")
    first_user_message = ""
    for message in payload.get("messages", []):
        if message.get("role") == "user":
            first_user_message = json.dumps(
                message.get("content", ""),
                sort_keys=True,
                ensure_ascii=False,
            )
            break
    return f"{user}:{first_user_message}"


def conversation_id(request: Request, payload: dict) -> str:
    return (
        request.headers.get("x-ais-conversation-id")
        or str(payload.get("conversation_id") or "").strip()
        or str(payload.get("conversationId") or "").strip()
    )


def assigned_route(model_class: str, identifier: str) -> Optional[Route]:
    if assignments is None or not identifier:
        return None
    try:
        assignment = assignments.find_one(
            {"conversationId": identifier, "modelClass": model_class}
        )
    except Exception as exc:
        print(
            "ROUTER ASSIGNMENT READ SKIPPED "
            f"errorType={type(exc).__name__}",
            flush=True,
        )
        return None
    if not assignment:
        return None
    route_id = str(assignment.get("routeId") or "")
    return next(
        (
            route
            for route in ROUTES[model_class]
            if route.route_id == route_id and CREDENTIALS.get(route.provider)
        ),
        None,
    )


def persist_assignment(
    request: Request,
    model_class: str,
    identifier: str,
    route: Route,
) -> None:
    if assignments is None or not identifier:
        return
    now = time.time()
    try:
        assignments.update_one(
            {"conversationId": identifier},
            {
                "$set": {
                    "conversationId": identifier,
                    "userId": request.headers.get("x-ais-user-id", ""),
                    "modelClass": model_class,
                    "routeId": route.route_id,
                    "provider": route.provider,
                    "model": route.model,
                    "updatedAt": now,
                },
                "$setOnInsert": {"createdAt": now},
            },
            upsert=True,
        )
    except Exception as exc:
        print(
            "ROUTER ASSIGNMENT WRITE SKIPPED "
            f"errorType={type(exc).__name__}",
            flush=True,
        )


def route_score(route: Route, key: str) -> float:
    digest = hashlib.sha256(
        f"{key}:{route.route_id}".encode("utf-8")
    ).digest()
    value = int.from_bytes(digest[:8], "big")
    uniform = (value + 1) / ((1 << 64) + 1)
    return -math.log(uniform) / max(route.weight, 1)


def ordered_routes(model_class: str, key: str) -> list[Route]:
    available = [
        route
        for route in ROUTES[model_class]
        if CREDENTIALS.get(route.provider)
    ]
    primary = sorted(
        (route for route in available if not route.fallback_only),
        key=lambda route: route_score(route, key),
    )
    fallback = sorted(
        (route for route in available if route.fallback_only),
        key=lambda route: route_score(route, key),
    )
    return primary + fallback


def ordered_credentials(provider: str) -> list[Credential]:
    credentials = CREDENTIALS[provider]
    state = CREDENTIAL_STATES[provider]
    now = time.monotonic()
    with state.lock:
        start = state.next_index % len(credentials)
        state.next_index = (state.next_index + 1) % len(credentials)
        ordered = credentials[start:] + credentials[:start]
        ready = [
            credential
            for credential in ordered
            if state.cooldown_until.get(credential.slot, 0) <= now
        ]
    return ready


def cooldown(credential: Credential, response: Optional[httpx.Response]) -> None:
    seconds = DEFAULT_COOLDOWN_SECONDS
    if response is not None:
        retry_after = response.headers.get("retry-after", "").strip()
        try:
            seconds = max(1, min(int(float(retry_after)), 3600))
        except ValueError:
            pass
    state = CREDENTIAL_STATES[credential.provider]
    with state.lock:
        state.cooldown_until[credential.slot] = time.monotonic() + seconds


def upstream_url(credential: Credential) -> str:
    if credential.provider == "google":
        return (
            "https://generativelanguage.googleapis.com/"
            "v1beta/openai/chat/completions"
        )
    if credential.provider == "groq":
        return "https://api.groq.com/openai/v1/chat/completions"
    if credential.provider == "openrouter":
        return "https://openrouter.ai/api/v1/chat/completions"
    if credential.provider == "cloudflare":
        return (
            "https://api.cloudflare.com/client/v4/accounts/"
            f"{credential.account_id}/ai/v1/chat/completions"
        )
    raise RuntimeError("Unsupported provider")


def upstream_headers(credential: Credential) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {credential.secret}",
        "Content-Type": "application/json",
    }
    if credential.provider == "openrouter":
        site_url = os.environ.get("ASH_OPENROUTER_SITE_URL", "").strip()
        app_name = os.environ.get(
            "ASH_OPENROUTER_APP_NAME", "AI Scholar Hub"
        ).strip()
        if site_url:
            headers["HTTP-Referer"] = site_url
        if app_name:
            headers["X-Title"] = app_name
    return headers


def restore_google_signatures(payload: dict) -> int:
    restored = 0
    for message in payload.get("messages", []):
        if message.get("role") != "assistant":
            continue
        for tool_call in message.get("tool_calls", []):
            call_id = tool_call.get("id")
            if not call_id:
                continue
            with thought_signatures_lock:
                signature = thought_signatures.get(call_id)
            if not signature:
                continue
            extra = tool_call.setdefault("extra_content", {})
            google = extra.setdefault("google", {})
            if "thought_signature" not in google:
                google["thought_signature"] = signature
                restored += 1
    return restored


def strip_google_metadata(payload: dict) -> None:
    for message in payload.get("messages", []):
        for tool_call in message.get("tool_calls", []):
            extra = tool_call.get("extra_content")
            if not isinstance(extra, dict):
                continue
            extra.pop("google", None)
            if not extra:
                tool_call.pop("extra_content", None)


def provider_payload(original: dict, route: Route) -> bytes:
    payload = json.loads(json.dumps(original))
    payload["model"] = route.model
    payload.pop("conversation_id", None)
    payload.pop("conversationId", None)
    if route.provider == "google":
        restored = restore_google_signatures(payload)
        if restored:
            print(
                f"ROUTER GEMINI THOUGHT SIGNATURE RESTORE count={restored}",
                flush=True,
            )
    else:
        strip_google_metadata(payload)
    return json.dumps(payload).encode("utf-8")


def store_signatures_from_event(event: dict) -> None:
    for choice in event.get("choices", []):
        message = choice.get("message") or choice.get("delta") or {}
        for tool_call in message.get("tool_calls", []):
            call_id = tool_call.get("id")
            extra = tool_call.get("extra_content")
            if not call_id or not isinstance(extra, dict):
                continue
            google = extra.get("google")
            if not isinstance(google, dict):
                continue
            signature = google.get("thought_signature")
            if signature:
                with thought_signatures_lock:
                    thought_signatures[call_id] = signature


def safe_error(response: httpx.Response) -> str:
    try:
        value = response.json()
        error = value.get("error", {}) if isinstance(value, dict) else {}
        message = error.get("message", "") if isinstance(error, dict) else ""
        return " ".join(str(message).split())[:300]
    except Exception:
        return ""


def log_attempt(
    route: Route,
    credential: Credential,
    status: object,
    elapsed_ms: float,
    response: Optional[httpx.Response] = None,
) -> None:
    print(
        "ROUTER PROVIDER ATTEMPT "
        f"class={route.model_class} route={route.route_id} "
        f"provider={route.provider} model={route.model} "
        f"credential={credential.safe_id} status={status} "
        f"elapsedMs={elapsed_ms:.1f} "
        f"message={safe_error(response) if response is not None else ''!r}",
        flush=True,
    )


def rewrite_json_response(response: httpx.Response, route: Route) -> bytes:
    try:
        payload = response.json()
    except Exception:
        return response.content
    if not isinstance(payload, dict):
        return response.content
    payload["model"] = route.model
    payload["ais_route"] = {
        "class": route.model_class,
        "provider": route.provider,
        "route_id": route.route_id,
    }
    if route.provider == "google":
        store_signatures_from_event(payload)
    return json.dumps(payload).encode("utf-8")


@app.get("/health")
async def health():
    return {
        "status": "ok" if ROUTER_ENABLED else "disabled",
        "enabled": ROUTER_ENABLED,
        "classes": {
            model_class: len(ordered_routes(model_class, "health"))
            for model_class in ROUTES
        },
        "credentials": {
            provider: len(credentials)
            for provider, credentials in CREDENTIALS.items()
        },
    }


@app.get("/v1/models")
async def models(authorization: Optional[str] = Header(default=None)):
    if not authorized(authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {
        "object": "list",
        "data": [
            {
                "id": model_class,
                "object": "model",
                "owned_by": "ai-scholar-hub",
            }
            for model_class in ROUTES
        ],
    }


def validation_category(status_code: int) -> str:
    if status_code < 400:
        return "AVAILABLE"
    if status_code in {401, 403}:
        return "CREDENTIAL_REJECTED"
    if status_code == 404:
        return "MODEL_UNAVAILABLE"
    if status_code == 429:
        return "CAPACITY_LIMITED"
    if status_code in {408, 500, 502, 503, 504}:
        return "TEMPORARILY_UNAVAILABLE"
    return "REQUEST_REJECTED"


@app.post("/admin/routes/validate")
async def validate_routes(authorization: Optional[str] = Header(default=None)):
    if not authorized(authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not ROUTER_ENABLED:
        raise HTTPException(status_code=503, detail="Model router is disabled")

    results = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        for model_class, routes in ROUTES.items():
            for route in routes:
                # One rotating credential per route keeps validation cheap and
                # distributes repeated checks across configured accounts.
                credentials = ordered_credentials(route.provider)[:1]
                if not credentials:
                    results.append({
                        "class": model_class,
                        "routeId": route.route_id,
                        "provider": route.provider,
                        "model": route.model,
                        "mode": "FALLBACK" if route.fallback_only else "STANDARD",
                        "available": False,
                        "category": "NOT_CONFIGURED",
                        "httpStatus": None,
                        "latencyMs": None,
                    })
                    continue

                final_status = None
                final_category = "UNREACHABLE"
                final_latency = None
                for credential in credentials:
                    started = time.perf_counter()
                    try:
                        response = await client.post(
                            upstream_url(credential),
                            headers=upstream_headers(credential),
                            json={
                                "model": route.model,
                                "messages": [
                                    {"role": "user", "content": "Reply OK."}
                                ],
                                "stream": False,
                            },
                        )
                        final_latency = round(
                            (time.perf_counter() - started) * 1000, 1
                        )
                        final_status = response.status_code
                        final_category = validation_category(response.status_code)
                        print(
                            "ROUTER VALIDATION "
                            f"class={model_class} route={route.route_id} "
                            f"provider={route.provider} status={response.status_code} "
                            f"category={final_category} latencyMs={final_latency}",
                            flush=True,
                        )
                        if (
                            response.status_code < 400
                            or response.status_code == 404
                            or response.status_code not in (
                                RETRYABLE_STATUSES
                                | CREDENTIAL_OR_ROUTE_STATUSES
                            )
                        ):
                            break
                    except httpx.RequestError as exc:
                        final_latency = round(
                            (time.perf_counter() - started) * 1000, 1
                        )
                        final_category = "UNREACHABLE"
                        print(
                            "ROUTER VALIDATION "
                            f"class={model_class} route={route.route_id} "
                            f"provider={route.provider} status={type(exc).__name__} "
                            f"category=UNREACHABLE latencyMs={final_latency}",
                            flush=True,
                        )

                results.append({
                    "class": model_class,
                    "routeId": route.route_id,
                    "provider": route.provider,
                    "model": route.model,
                    "mode": "FALLBACK" if route.fallback_only else "STANDARD",
                    "available": bool(final_status is not None and final_status < 400),
                    "category": final_category,
                    "httpStatus": final_status,
                    "latencyMs": final_latency,
                })

    return {
        "validatedAt": time.time(),
        "results": results,
    }


@app.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    if not authorized(authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not ROUTER_ENABLED:
        raise HTTPException(status_code=503, detail="Model router is disabled")
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")

    model_class = str(payload.get("model", "")).strip().lower()
    if model_class not in ROUTES:
        raise HTTPException(status_code=400, detail="Unknown model class")

    routes = ordered_routes(
        model_class,
        conversation_key(request, payload),
    )
    identifier = conversation_id(request, payload)
    sticky = assigned_route(model_class, identifier)
    if sticky is not None:
        routes = [sticky] + [
            route for route in routes if route.route_id != sticky.route_id
        ]
    if not routes:
        raise HTTPException(
            status_code=503,
            detail="No credentials are configured for this model class",
        )

    is_streaming = bool(payload.get("stream", False))
    last_response = None
    for route in routes:
        body = provider_payload(payload, route)
        for credential in ordered_credentials(route.provider):
            if is_streaming:
                result = await stream_attempt(route, credential, body)
                if result is not None:
                    if result.status_code < 400:
                        persist_assignment(
                            request,
                            model_class,
                            identifier,
                            route,
                        )
                    return result
                continue

            started = time.perf_counter()
            try:
                async with httpx.AsyncClient(timeout=None) as client:
                    response = await client.post(
                        upstream_url(credential),
                        content=body,
                        headers=upstream_headers(credential),
                    )
            except httpx.RequestError as exc:
                elapsed = (time.perf_counter() - started) * 1000
                log_attempt(route, credential, type(exc).__name__, elapsed)
                cooldown(credential, None)
                continue

            elapsed = (time.perf_counter() - started) * 1000
            log_attempt(route, credential, response.status_code, elapsed, response)
            last_response = response
            if response.status_code < 400:
                persist_assignment(
                    request,
                    model_class,
                    identifier,
                    route,
                )
                content = rewrite_json_response(response, route)
                return Response(
                    content=content,
                    status_code=response.status_code,
                    media_type="application/json",
                    headers={
                        "X-AIS-Route": route.route_id,
                        "X-AIS-Provider": route.provider,
                    },
                )
            if response.status_code in (
                RETRYABLE_STATUSES | CREDENTIAL_OR_ROUTE_STATUSES
            ):
                cooldown(credential, response)
                continue
            return Response(
                content=response.content,
                status_code=response.status_code,
                media_type=response.headers.get(
                    "content-type", "application/json"
                ),
            )

    if last_response is not None:
        return Response(
            content=last_response.content,
            status_code=last_response.status_code,
            media_type=last_response.headers.get(
                "content-type", "application/json"
            ),
        )
    raise HTTPException(
        status_code=503,
        detail="All routes and credentials are currently unavailable",
    )


async def stream_attempt(
    route: Route,
    credential: Credential,
    body: bytes,
) -> Optional[Response]:
    client = httpx.AsyncClient(timeout=None)
    started = time.perf_counter()
    try:
        upstream = await client.send(
            client.build_request(
                "POST",
                upstream_url(credential),
                content=body,
                headers=upstream_headers(credential),
            ),
            stream=True,
        )
    except httpx.RequestError as exc:
        elapsed = (time.perf_counter() - started) * 1000
        log_attempt(route, credential, type(exc).__name__, elapsed)
        cooldown(credential, None)
        await client.aclose()
        return None

    elapsed = (time.perf_counter() - started) * 1000
    if upstream.status_code >= 400:
        await upstream.aread()
        log_attempt(route, credential, upstream.status_code, elapsed, upstream)
        retryable = upstream.status_code in (
            RETRYABLE_STATUSES | CREDENTIAL_OR_ROUTE_STATUSES
        )
        if retryable:
            cooldown(credential, upstream)
        content = upstream.content
        status = upstream.status_code
        content_type = upstream.headers.get("content-type", "application/json")
        await upstream.aclose()
        await client.aclose()
        if retryable:
            return None
        return Response(content=content, status_code=status, media_type=content_type)

    log_attempt(route, credential, upstream.status_code, elapsed, upstream)
    return StreamingResponse(
        relay_stream(upstream, client, route),
        status_code=upstream.status_code,
        media_type="text/event-stream",
        headers={
            "X-AIS-Route": route.route_id,
            "X-AIS-Provider": route.provider,
        },
    )


async def relay_stream(
    upstream: httpx.Response,
    client: httpx.AsyncClient,
    route: Route,
):
    buffer = ""
    tool_call_ids: dict[int, str] = {}
    try:
        async for chunk in upstream.aiter_bytes():
            buffer += chunk.decode("utf-8", errors="ignore")
            while "\n\n" in buffer:
                event_text, buffer = buffer.split("\n\n", 1)
                yield rewrite_sse_event(event_text, route, tool_call_ids)
        if buffer:
            yield rewrite_sse_event(buffer, route, tool_call_ids)
    finally:
        await upstream.aclose()
        await client.aclose()


def rewrite_sse_event(
    event_text: str,
    route: Route,
    tool_call_ids: dict[int, str],
) -> bytes:
    rewritten = []
    for line in event_text.splitlines():
        if not line.startswith("data: ") or line[6:].strip() == "[DONE]":
            rewritten.append(line)
            continue
        try:
            event = json.loads(line[6:])
            if isinstance(event, dict):
                event["model"] = route.model
                if route.provider == "google":
                    for choice in event.get("choices", []):
                        delta = choice.get("delta", {})
                        for tool_call in delta.get("tool_calls", []):
                            index = tool_call.get("index")
                            call_id = tool_call.get("id")
                            if isinstance(index, int) and call_id:
                                tool_call_ids[index] = call_id
                            if not call_id and isinstance(index, int):
                                call_id = tool_call_ids.get(index)
                            extra = tool_call.get("extra_content")
                            google = (
                                extra.get("google")
                                if isinstance(extra, dict)
                                else None
                            )
                            signature = (
                                google.get("thought_signature")
                                if isinstance(google, dict)
                                else None
                            )
                            if call_id and signature:
                                with thought_signatures_lock:
                                    thought_signatures[call_id] = signature
            rewritten.append(f"data: {json.dumps(event)}")
        except json.JSONDecodeError:
            rewritten.append(line)
    return ("\n".join(rewritten) + "\n\n").encode("utf-8")
