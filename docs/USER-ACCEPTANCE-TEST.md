# AI Scholar Hub User Acceptance Test

## Purpose

This document defines the minimum user-facing acceptance gate for an AI Scholar Hub deployment. It is intentionally release-independent: a deployment passes only when the user-visible capabilities work end-to-end, regardless of image tag or release name.

## Preconditions

- `ash-web` is provisioned and reachable.
- No admin interface (`admin-ui`, `admin-panel`) is deployed in the ACA user plane.
- `validate-aca-runtime.sh` passes.
- Required runtime services are provisioned in the same ACA environment:
  - `model-router`
  - `gemini-proxy`
  - `academic-research-mcp`
  - `searxng`
- The deployed icon endpoint returns HTTP 200 with `Content-Type: image/png`.

## UAT-01 — AI Scholar Free Router

**Action**

Open the ACA website using a persona routed through AI Scholar Free Router and ask:

> Explain photosynthesis in two sentences.

**Pass criteria**

- A substantive response is returned.
- No user-visible model/provider error occurs.
- Model-router logs show an actual provider attempt for the expected model class.
- `ash-web` logs show no `ENOTFOUND`, `ECONNREFUSED`, `fetch failed`, or equivalent dependency error.

## UAT-02 — Gemini Academic Assistant

**Action**

Select Gemini Academic Assistant and ask:

> Summarize Newton's second law in one paragraph.

**Pass criteria**

- A coherent response is returned.
- Gemini proxy is reached successfully.
- No credential or transport error is presented to the user.

## UAT-03 — Web Search / SearXNG

**Action**

Using a Web Search-enabled persona, ask:

> What is one important scientific development reported this week? Give the source and publication date.

**Pass criteria**

- A current result is returned.
- At least one source and publication date are provided.
- SearXNG receives the search request.
- Individual optional SearXNG engine-load warnings do not fail UAT if the requested search succeeds.

## UAT-04 — Academic Research MCP

**Action**

Using an MCP-enabled research agent, ask:

> Find one recent paper on single-cell RNA sequencing. Give the title, year, authors, and source.

**Pass criteria**

- Academic Research MCP is invoked.
- A real paper is returned with title, year, authors and source.
- The response includes a DOI or authoritative bibliographic/source link when available.
- No MCP connection/circuit-breaker failure occurs.

**2026-09-12 acceptance evidence**

The deployed ACA environment returned:

- *Scalable single-cell total RNA sequencing unifies coding and noncoding transcriptomics*
- Year: 2026
- Source: *Nature Biotechnology*
- DOI: `10.1038/s41587-026-03068-6`

This is acceptance evidence for that deployment, not a hard-coded future expected result.

## UAT-05 — Static asset / favicon

**Action**

Request:

`/images/favicon-16x16.png`

**Pass criteria**

- HTTP 200
- `Content-Type: image/png`
- body is a PNG, not an HTML SPA fallback

## UAT-06 — Runtime dependency gate

Run:

```bash
ACA_RESOURCE_GROUP="<resource-group>" \
ACA_APP_NAME="ash-web" \
scripts/release-tooling/validate-aca-runtime.sh
```

**Pass criteria**

The script reports:

- no admin interfaces in the ACA user app;
- model-router URL valid;
- Gemini proxy URL valid;
- SearXNG URL valid;
- Academic Research MCP URL valid;
- required runtime apps exist in the same environment;
- final `PASS: ACA user-runtime gate complete`.

## Acceptance decision

A deployment is accepted only when UAT-01 through UAT-06 pass. Listener health alone is insufficient; the four end-to-end user interactions must succeed.
