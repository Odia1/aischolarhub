# AI Scholar Hub Support — Administration Manual

## Purpose

AIH Support is an authenticated platform capability for helping users operate
AI Scholar Hub. It is separate from Academic Agents and is not an authority
for changing permissions, tenant scope, security policy, or model/provider
configuration.

## Support context

Support may use only sanitized user context needed to assist the user, such as:

- authenticated status;
- normalized role;
- institution display name;
- permitted Support capabilities.

Support must not expose:

- credentials or API keys;
- hidden prompts;
- internal database identifiers;
- infrastructure topology;
- raw logs containing sensitive information;
- provider secrets;
- source-code implementation details.

## Support Knowledge

Support Knowledge is platform-scoped documentation curated by Platform Admin
or Superadmin.

Lifecycle:

- DRAFT — editable;
- PUBLISHED — immutable for normal use and retrievable by Support;
- RETIRED — retained for history but not used for new Support answers.

Editing a published article requires creating a new revision.

Only one DRAFT and one active PUBLISHED revision may exist for a knowledge item.

## Categories

Supported categories include:

- Getting Started
- RAG
- Academic Agents
- Instructor Workflows
- Institution Administration
- Troubleshooting
- Security / Privacy
- Other

## Authority

Support Knowledge is evidence and guidance. It cannot override:

- authentication or authorization;
- institutional/tenant boundaries;
- RAG access policy;
- role capabilities;
- tool permissions;
- platform security controls.

## Upload security

Documents entering AIH are treated as untrusted until validated.

For ordinary uploads and Agent/message attachments:

- uploads begin in temporary quarantine;
- ClamAV scans non-code uploads before permanent storage;
- supported documents receive structural inspection;
- malicious files, suspicious active content, archive abuse, and scanner
  failures are rejected before parsing or indexing.

Execute-code resources are governed by the separate sandbox boundary.

## Prompt injection

Text inside an uploaded or retrieved document is treated as document content,
not platform instruction.

Statements such as “ignore previous instructions,” requests for credentials,
claims of elevated privilege, or requests to invoke unrelated tools do not
change AIH authorization or tool boundaries.

## Troubleshooting uploads

If an upload is rejected:

1. confirm it is a supported format;
2. remove macros, embedded executables, or active content;
3. re-export the document from a trusted application;
4. retry only after the source file is known to be safe;
5. escalate repeated scanner-unavailable errors to the platform operator.

Never disable the security gate merely to accept a problematic document.

## Audit

Support Knowledge administrative operations and upload-security rejections are
audited.

Audit records must not contain uploaded document contents or secrets.

## Current Support Knowledge administration status

DEV may enable Support Knowledge mutations for validation.

PROD mutation endpoints remain disabled until MongoDB transaction support is
available for atomic knowledge mutation plus audit recording.

Read-only Support behavior and the authenticated Support boundary remain
available independently.


## Release F baseline Support corpus

Release F supplies an audited, idempotent baseline bootstrap operation at:

`POST /api/admin/support-knowledge/bootstrap-baseline`

The endpoint is protected by JWT authentication, Admin access,
`MANAGE_SUPPORT_KNOWLEDGE`, and the Support Knowledge mutation gate.

It publishes the baseline articles required for:

- Getting Started
- Account/Login Help
- RAG and Documents
- Academic Agents
- Instructor Workflows
- Institution Administration
- Troubleshooting
- Common Errors
- Escalation
- Security and Privacy Boundaries

Existing published articles with the same baseline title are retained rather
than overwritten.

The custom Administrator Portal exposes **Help & Support** in its header and
provides role-aware administrator guidance.

<!-- AIH_RELEASE_I_ADMIN_EVALUATION_START -->

## Release I Evaluation

Evaluation is a cross-cutting platform capability controlled by the
Superadmin.

Evaluation has separate controls for:

- **Telemetry:** OFF, ON, or TIMED;
- **Semantic evaluation:** OFF, ON, or TIMED;
- scope: platform, institution, Experience, or Academic Agent;
- telemetry and semantic sampling rates; and
- **Lean Efficiency** measurement.

A timed policy becomes ineffective automatically outside its configured
window.

Lean Efficiency measures useful outcomes relative to resources such as token
use, latency, tool activity, retrieval activity, model cost, and operational
overhead.

Ordinary usage accounting remains authoritative. Evaluation does not duplicate
normal token accounting.

Semantic evaluation is intentionally separated from the synchronous user
response path. Enabling semantic sampling must not introduce a second
evaluator-model call into every normal chat response.

Evaluation policy changes are Superadmin-only, server-enforced, and auditable.

## Support Knowledge maintenance

Material user-interface or workflow changes must be reflected in approved
Support Knowledge before production promotion.

For Release I, Support Knowledge must use these user-facing terms:

- Primary Experience;
- Academic Agent;
- Tools;
- Skills;
- Knowledge Sources;
- Research Integrity & Contribution Reviewer;
- Evaluation and Lean Efficiency where relevant to administrators.

Do not expose model-provider routing, credentials, deployment topology, raw
logs, internal diagnostics, or other implementation details through AIH
Support.

<!-- AIH_RELEASE_I_ADMIN_EVALUATION_END -->
