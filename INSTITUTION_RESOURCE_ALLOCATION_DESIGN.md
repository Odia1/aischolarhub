# Institution resource allocation — proposed design

## Principle

Allocate service capacity by institution, but do not dedicate API keys to an
institution. A shared credential pool provides better utilization and failover.
The router should enforce institutional policy before selecting a provider and
credential, while retaining the exact model assignment for each conversation.

## Policy record

Create one versioned `institutionResourcePolicies` record per institution:

- free-tier share weight;
- Class A and Class B request/token limits per minute, day, and month;
- maximum concurrent requests;
- paid monthly budget in USD;
- paid Class C permission and paid-spillover permission;
- per-role sublimits and optional per-user safeguards;
- warning thresholds and hard-limit behavior;
- effective date, policy version, and audit metadata.

## Runtime decision order

1. Confirm institution, role, experience, and model entitlement.
2. Apply the institution concurrency limit.
3. Reserve capacity from its weighted free-tier token bucket.
4. Select a healthy model route and rotate credentials within that provider.
5. Use paid Class C only when explicitly entitled and within budget.
6. Record actual usage and reconcile the reservation after the response.

Free capacity should use weighted fair sharing with temporary borrowing. An
idle institution's unused capacity may be borrowed, but its configured minimum
share must become available again when demand returns.

## Accounting ledger

Write one append-only `institutionUsageEvents` entry for every attempt and
completion. Store tenant, user, role, experience, agent, class, provider, model,
safe credential slot ID, input/output tokens, latency, outcome, retry/fallback,
conversation ID, policy version, and estimated/actual cost. Never store a key,
token, Cloudflare account ID, or authorization header.

Report two separate measures:

- **Billable cost:** actual Azure or other paid-provider charges attributable to
  the institution.
- **Allocated service usage:** free-provider tokens/requests, compute pressure,
  RAG storage, vector indexing, and tool usage. This supports fair allocation
  without pretending that free API traffic has a direct invoice cost.

## Recommended rollout

1. Meter accurately without enforcing limits.
2. Add dashboards and 70/85/100 percent alerts.
3. Enforce concurrency and weighted free-tier shares.
4. Add paid budgets with no automatic spillover by default.
5. Add RAG storage/indexing and external-tool allocations.

## Prompt and quota efficiency

Keep the complete transcript in the application, but construct the provider
request on the server. Browser-only trimming is not an authorization boundary
and produces inconsistent results across clients.

The provider request should contain:

- one compact, invariant academic-integrity policy;
- the experience or agent instructions needed for this turn;
- only the most relevant RAG excerpts, with source metadata;
- a persisted summary of older conversation state; and
- the most recent four to six turns verbatim.

Create or refresh the rolling summary when either a token threshold is reached
or roughly six to ten completed turns have accumulated. Because summarization
itself consumes quota, trigger it only when its projected reuse savings exceed
its cost. Store the summary version and source-turn watermark so the operation
is auditable and retry-safe. Preserve exact citations, tool results, numeric
values, user constraints, unresolved questions, and safety-relevant context
outside lossy prose summaries when necessary.

Cache retrieval by normalized query, corpus revision, and authorization scope;
invalidate it when documents or access policy change. Retrieve a small number
of relevant passages rather than placing static documents in every prompt.

Batching is appropriate for compatible background work, such as indexing or
several questions from the same authorized corpus. Do not combine unrelated
users or unrelated questions merely to reduce request count: it increases
latency, weakens attribution, and risks privacy leakage.

All policy changes and manual overrides should be audited. Only Superadmin and
Platform Admin should see cross-institution usage, provider composition, or
capacity data; Institution Admins may later receive only their own summarized
allowance and consumption.
