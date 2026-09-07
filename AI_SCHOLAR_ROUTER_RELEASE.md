# AI Scholar Hub model-class router

This release adds credential-array routing for Google, Groq, OpenRouter, and
Cloudflare, while retaining the existing Azure endpoints as paid Class C routes.

## Required `.env` variables

```dotenv
ASH_MODEL_ROUTER_ENABLED=true
ASH_GOOGLE_API_KEYS=
ASH_GROQ_API_KEYS=
ASH_OPENROUTER_API_KEYS=
ASH_CLOUDFLARE_ACCOUNT_IDS=
ASH_CLOUDFLARE_API_TOKENS=
```

Each value is a comma-separated array. Cloudflare account IDs and tokens are
paired by position. OpenRouter keys are accepted and held in reserve, but this
release does not route traffic to OpenRouter until a stable free model ID is
validated.

`GEMINI_PROXY_API_KEY` remains the internal LibreChat-to-router credential during
the staged migration. Existing Azure variables remain unchanged.

## Deployment

Back up the files replaced by this bundle before extracting it at the project
root. Then build and start only the changed services:

```bash
docker compose config --quiet
docker compose build model-router
docker compose up -d model-router admin-ui api
docker compose ps
```

The legacy `gemini-proxy` remains available for rollback and for database
overrides that have not yet been migrated.

## Safe validation

```bash
docker compose exec -T model-router python -c \
  "import json,urllib.request; print(json.load(urllib.request.urlopen('http://127.0.0.1:8000/health')))"
```

The response reports credential counts only; it never prints credential values.

## Platform Admin workflow

1. Open **AI Experience Policy**.
2. Select an institution and configure tenant/role entitlements for the
   permitted classes.
3. Assign a class to each of the three primary experiences. Specialized agents
   inherit the class of their associated primary experience.

The managed catalog and missing core Academic Agents are provisioned
idempotently. No bootstrap button or operator database setup is required.

Persona routing never expands an entitlement. A class must be both assigned to
the persona and allowed for the tenant/role.

## Follow-up administration model

The restricted AI policy dashboard separates three primary experiences from
Academic Agents. Each institution assigns a class once to K-12,
Undergraduate, and PhD/Post-Doc experiences. Specialized Academic Agents
inherit the route of their associated experience through `modelSpecName`.

The read-only class-composition inventory is available only through the
Superadmin/Platform Admin policy endpoint. It contains provider/model names and
route modes, but never credentials, Cloudflare account IDs, endpoint URLs, or
secret fragments.

The managed class catalog is initialized idempotently when the Admin UI starts;
there is no administrator-facing bootstrap action. The provider card is hidden,
and public-facing policy labels avoid describing service classes by acquisition
cost.

`Check Model Availability` performs one minimal test per configured Class A/B
route, rotating which credential is used on subsequent checks. Only sanitized
availability category, HTTP status, latency, provider, model, and validation
time are returned to Superadmin/Platform Admin.

## Academic integrity runtime enforcement

Academic Agent bootstrap stores a versioned `SCHOLARLY_INTEGRITY_CORE` policy.
Runtime configuration now loads the enabled policy referenced by the primary
Academic Agent and appends its rules to the ModelSpec prompt. These rules
prohibit fabricated citations, data and results; prohibit false source
inspection claims; distinguish evidence from inference; preserve contradictory
evidence; qualify research-gap claims; and retain human scholarly judgment.
If a tenant policy document is temporarily absent, the same conservative core
rules are applied as a runtime default rather than silently dropping the
integrity boundary.

Specialized `AGENT` records no longer unpredictably replace the primary `MODE`
record when several agents share a ModelSpec. The primary mode owns the
user-facing experience; specialized agents inherit its route and integrity
boundary.

## Institutional RAG administration

A **RAG Access Point** owns a document corpus attached to the institution, a
department, a course/class, or an organizational group. Platform and
Institution Administrators upload, index, list, and recoverably remove its PDF,
plain-text, and Markdown documents using the Access Point's **Documents**
button. Uploads are limited to 20 MB and duplicate content is rejected within
an institution.

A **RAG Access Group** is an audience policy, not a document collection. It may
grant one or more organizational groups, their descendants, or selected users
access to one or more Access Points. Retrieval resolves these grants on the
server and never allows the model to decide authorization.

Department, course, and group deletion now stops when the organizational item
still owns or participates in a RAG policy. This prevents silent corpus or
authorization orphaning.

## Prompt-volume policy

The invariant academic-integrity directive has been condensed while retaining
all enforced principles. Static knowledge belongs in selectively retrieved RAG
passages rather than every request. Rolling conversation summaries should be a
subsequent server-side feature: preserve the full visible transcript, retain
recent turns verbatim, and persist a versioned summary of older turns only when
the expected reuse savings exceed the summary call's own cost. Browser-only
history trimming is deliberately not used as the authoritative behavior.
