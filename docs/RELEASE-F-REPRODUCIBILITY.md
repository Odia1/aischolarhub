# AI Scholar Hub — Release F Reproducibility

## Build model

Release F uses two distinct Docker targets:

- `dev-test`: full development/test dependencies retained locally on the DEV VM.
- `runtime`: production dependency set only.

The reusable local engineering image is:

`aih-dev-test:local`

It is intentionally not a PROD artifact.

The immutable runtime image is built in ACR only after the local release gate succeeds.

## Release invariant

Committed Git HEAD
→ source validation
→ DEV/test image build
→ native tests
→ failure stops release
→ ACR `runtime` target
→ exact runtime image deployed to DEV
→ DEV acceptance
→ same immutable runtime image promoted to PROD.

No separate PROD rebuild is permitted.

## Upload security

User uploads first enter the Multer temporary quarantine tree.

Before permanent storage, parsing, or vectorization:

1. all non-code uploads are scanned by ClamAV;
2. supported document formats receive structural validation;
3. suspicious OOXML, archive abuse, disguised files, active PDF content,
   malware, scanner failure, and resource abuse fail closed;
4. rejected uploads are audited without logging filenames or file contents.

ClamAV has read-only access only to `uploads/temp`.

The API depends on ClamAV health before startup.

Execute-code files remain under the separate code-sandbox trust boundary.

## Prompt-injection trust boundary

Retrieved RAG passages and directly attached document text are untrusted evidence.

Document content cannot override system/platform instructions, authorization,
tenant/file scope, tool authority, hidden prompts, or secrets.

## Support Knowledge

Lifecycle:

`DRAFT -> PUBLISHED -> RETIRED`

Only Platform Admin and Superadmin have management capability.

Database uniqueness permits at most one DRAFT and one PUBLISHED revision per
knowledge item.

Support Knowledge mutation endpoints are environment-gated. DEV enables them
for validation. PROD must leave them disabled until knowledge mutation and
tamper-evident platform audit writes can participate in one MongoDB
transaction.

This is a deliberate safety boundary, not a deferred error workaround.

## MongoDB transaction prerequisite

Current Mongo deployment is standalone `mongod --auth`.

Multi-document transaction support requires a replica-set deployment.
Support Knowledge PROD mutations must not be enabled until this prerequisite
and transaction-aware audit implementation are completed and tested.

## DEV storage retention

Keep locally:

- current DEV runtime image;
- current PROD runtime image;
- one known-good rollback image;
- `aih-dev-test:local`;
- actively used service images;
- recent Docker build cache.

Do not routinely use `docker system prune -a`, `docker volume prune`, or
`docker builder prune -a`.

## Secret handling

Do not print full `docker compose config` in operational transcripts because
resolved environment secrets may be exposed.

Use `docker compose config --quiet` for validation.
