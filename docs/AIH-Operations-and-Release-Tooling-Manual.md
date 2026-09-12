# AI Scholar Hub Operations & Release Tooling Manual

**Status:** Release-E hardened baseline  
**Project:** AI Scholar Hub (AIH)  
**DEV root:** `/opt/aischolarhub`  
**PROD root:** `/opt/scholarhub`  
**Current branch:** `release-e`  
**Hardened tooling commit:** `cbe06d430`  
**Remote:** `origin/release-e`

---

## 1. Operating principle

AI Scholar Hub releases are deployment contracts, not merely Docker images.

A complete release consists of:

1. committed source code;
2. one immutable application image;
3. explicit bind-mounted configuration artifacts;
4. database/state migrations;
5. Compose-managed dependencies;
6. environment wiring;
7. automated verification;
8. rollback metadata;
9. release closure and cleanup.

The core rule is:

> **Promote the tested system, not merely the tested image.**

---

## 2. Current Release-E baseline

The Release-E branch was created from the accepted Release-D application baseline:

```text
c33a0b62c245ea86b99e3122e7e71f8248fdce84
```

Important Release-E commits:

```text
1dc0d05c7  build(release-e): add robust promotion and closure tooling
70cca74f4  build(release-e): ignore local release checkpoints
f2453d2a1  fix(release-e): repair endpoint icon references
c899fceb1  build(release-e): enforce tracked release asset validation
cf21fbe02  build(release-e): refresh release tooling checksums
cbe06d430  build(release-e): harden promotion verification and cleanup
```

The current working tree may intentionally show:

```text
 M docker-compose.override.yaml
```

That file reflects the current DEV deployment image and is runtime/deployment state. It is not part of the hardened tooling commit.

---

## 3. Release-D accepted baseline

Accepted application commit:

```text
c33a0b62c245ea86b99e3122e7e71f8248fdce84
```

Accepted application image:

```text
seeds.azurecr.io/aischolarhub-custom:dev-20260912-c33a0b62c-release-d-uat-v3
```

Accepted image digest:

```text
sha256:57982e6c6efa5ee1f21de7f5f5951408ac2726efb617cca5e055925df2de0489
```

Release D remains the rollback baseline until Release E is accepted.

---

## 4. Environment map

### DEV

```text
Root:            /opt/aischolarhub
Compose project: aih-dev
Branch:          release-e
API port:        127.0.0.1:3080
```

Important DEV services:

```text
api
mongodb
meilisearch
vectordb
rag_api
gemini-proxy
model-router
searxng
ollama
academic-research-mcp
admin-panel
admin-ui
```

### PROD

```text
Root:            /opt/scholarhub
Compose project: aih-prod
```

PROD receives the exact image that passed DEV UAT. PROD must never be rebuilt independently.

### Azure Container Apps

ACA test deployment:

```text
Resource group: AI-SCHOLAR-HUB-ACA-TEST
Container app:   ash-web
```

Canonical ACA checkpoint:

```text
/opt/aischolarhub/release-checkpoints/ACA-UI-LAST-PROMOTION.txt
```

---

## 5. Source and terminal conventions

### Node/npm

Node.js/npm are not assumed to exist on the VM host.

Do not use host-shell commands such as:

```text
node
npm
npx
```

unless intentionally executed inside a suitable Docker container.

### Terminal stability

Keep operational commands small.

Avoid large pasted multi-file heredocs in xterm. For changes:

- patch one file at a time;
- syntax-check immediately;
- commit in small logical units.

### Working directory

When already at `/opt/aischolarhub`, omit redundant `cd` commands.

Operational command blocks should begin with:

```bash
clear
```

---

## 6. Tooling inventory

Primary release tooling:

```text
scripts/release-tooling/release-lib.sh
scripts/release-tooling/promote-aca-ui.sh
scripts/release-tooling/promote-release.sh
scripts/release-tooling/verify-release.sh
scripts/release-tooling/close-release.sh
scripts/release-tooling/validate-release-assets.sh
scripts/release-tooling/release-e.env.example
scripts/release-tooling/README.md
scripts/release-tooling/SHA256SUMS
```

Application build/deploy helper:

```text
scripts/acr-build.sh
```

---

## 7. `scripts/acr-build.sh`

### Purpose

Build one immutable application image from committed Git `HEAD`, deploy it to DEV, verify readiness, and create a Git deployment tag.

### Safety properties

The script:

- refuses a dirty working tree;
- builds from `git archive HEAD`;
- therefore excludes uncommitted files and runtime data;
- runs the build remotely in Azure Container Registry;
- pulls the exact built image;
- updates DEV Compose to that image;
- recreates the DEV API only;
- waits for readiness;
- creates the deployment tag only after success;
- now runs the release-asset gate before building.

### Usage

```bash
clear

./scripts/acr-build.sh release-e-<candidate>
```

Example:

```bash
clear

./scripts/acr-build.sh release-e-icon-asset-fix
```

The successful output records:

```text
Git branch
Git commit
Git deployment tag
ACR image
```

Push the generated tag:

```bash
clear

git push origin "<generated-tag>"
```

---

## 8. Release asset validation

Validator:

```text
scripts/release-tooling/validate-release-assets.sh
```

This exists because a valid PNG once existed on the DEV filesystem but was ignored by Git. Since ACR builds from `git archive HEAD`, the local file was absent from the immutable image and ACA returned an HTML SPA fallback instead of the icon.

The validator therefore treats Git `HEAD`, not the DEV filesystem, as the authoritative build source.

### Source validation

```bash
clear

scripts/release-tooling/validate-release-assets.sh source
```

For every active `iconURL: "/images/..."` reference in committed `librechat.yaml`, the validator requires that the corresponding file is present in committed Git `HEAD`.

A missing committed asset returns non-zero and blocks the build.

### Built-image validation

The validator also supports checking the finished image:

```bash
scripts/release-tooling/validate-release-assets.sh image "<full-image>"
```

The intended contract is that each configured asset must exist in the application image, including the public/static output used by the frontend.

### Current endpoint icon

Current standard:

```text
/images/favicon-16x16.png
```

The file is explicitly tracked despite the broader images ignore rule.

### Important web validation

Do not treat HTTP `200` alone as proof an icon exists.

A missing static asset may fall through to the SPA and return:

```text
HTTP 200
Content-Type: text/html
```

A valid PNG check must confirm:

```text
HTTP 200
Content-Type: image/png
```

---

## 9. `.gitignore` and release assets

`client/public/images/` is broadly ignored because most runtime/mounted assets should not enter source control automatically.

Required immutable release assets must be explicitly exempted and committed.

The rule is:

> Any asset referenced by committed release configuration must itself be committed or supplied as an explicit release artifact.

---

## 10. `release-lib.sh`

Shared helper functions for release scripts.

Typical responsibilities:

- consistent PASS/FAIL output;
- required command/file checks;
- hashing;
- environment-variable presence checks;
- container environment checks.

Keep environment-specific release behavior in caller scripts.

---

## 11. `promote-aca-ui.sh`

### Purpose

Promote the exact DEV-tested image to Azure Container Apps.

### Recommended invocation

```bash
clear

ACA_RESOURCE_GROUP="AI-SCHOLAR-HUB-ACA-TEST" \
ACA_APP_NAME="ash-web" \
ACA_IMAGE="seeds.azurecr.io/aischolarhub-custom:<exact-tested-tag>" \
  scripts/release-tooling/promote-aca-ui.sh
```

The script:

- validates Azure CLI/authentication;
- determines the existing ACA image;
- updates only to the requested immutable image;
- checks provisioning state;
- verifies ingress;
- records the promotion checkpoint.

### Canonical checkpoint location

```text
/opt/aischolarhub/release-checkpoints/ACA-UI-LAST-PROMOTION.txt
```

Because the script resides in:

```text
scripts/release-tooling/
```

the project-root path uses:

```text
$SCRIPT_DIR/../../release-checkpoints/
```

---

## 12. Release manifest

Template:

```text
scripts/release-tooling/release-e.env.example
```

Working manifest:

```text
release-e.env
```

The working manifest is local and excluded from Git.

Create once:

```bash
clear

cp --update=none \
  scripts/release-tooling/release-e.env.example \
  release-e.env
```

Important fields include:

```text
RELEASE_NAME
DEV_ROOT
PROD_ROOT

EXPECTED_API_IMAGE
EXPECTED_API_DIGEST

ROLLBACK_API_IMAGE
RETAIN_API_IMAGES
IMAGE_REPO

PROD_API_CONTAINER
PROD_MODEL_ROUTER_CONTAINER
PROD_SEARXNG_CONTAINER
API_SERVICE

PROMOTE_LIBRECHAT
PROMOTE_COMPOSE
LIBRECHAT_SOURCE
COMPOSE_SOURCE

MIGRATIONS_DIR

EXPECTED_ACADEMIC_AGENT_COUNT
EXPECTED_WEBSEARCH_PERSONA_COUNT
MIN_CLASS_A
MIN_CLASS_B

REQUIRED_PROD_ENV_KEYS
```

Do not fill final image/digest values until DEV UAT passes.

---

## 13. Frozen release artifacts

Mutable configuration that is part of a release must be frozen under:

```text
release-artifacts/<release>/
```

For Release E:

```text
release-artifacts/release-e/
```

Typical files:

```text
release-artifacts/release-e/librechat.yaml
release-artifacts/release-e/docker-compose.yml
```

The hardened promotion script no longer silently falls back to mutable DEV files.

If:

```text
PROMOTE_LIBRECHAT=1
```

then the manifest must explicitly define:

```text
LIBRECHAT_SOURCE=/opt/aischolarhub/release-artifacts/release-e/librechat.yaml
```

If:

```text
PROMOTE_COMPOSE=1
```

then the manifest must explicitly define:

```text
COMPOSE_SOURCE=/opt/aischolarhub/release-artifacts/release-e/docker-compose.yml
```

Otherwise promotion fails closed.

---

## 14. Release migrations

Release state/database changes go under:

```text
release-migrations/<release>/
```

For Release E:

```text
release-migrations/release-e/
```

Migration requirements:

- idempotent;
- deterministic;
- tenant-scoped where appropriate;
- safe to rerun;
- auditable;
- non-secret.

Do not depend on remembered Mongo shell commands.

---

## 15. `promote-release.sh`

### Purpose

Promote the complete tested release contract to PROD.

The script:

1. serializes promotion with `flock`;
2. validates current PROD Compose;
3. checkpoints mutable PROD configuration;
4. pulls the exact immutable image;
5. verifies image digest when supplied;
6. promotes explicit frozen artifacts when requested;
7. patches only the API image;
8. revalidates candidate Compose;
9. requires `model-router` and `searxng` to be Compose-managed;
10. checks required environment-variable presence without printing values;
11. runs idempotent migrations;
12. recreates managed dependencies;
13. recreates API;
14. invokes `verify-release.sh`.

Usage:

```bash
clear

scripts/release-tooling/promote-release.sh release-e.env
```

---

## 16. `verify-release.sh`

### Purpose

Independently prove that PROD satisfies the release contract.

Current verification covers:

- exact API image;
- API health;
- SearXNG environment wiring;
- API → SearXNG connectivity;
- model-router health;
- minimum model-class counts;
- non-zero router credential pool;
- expected Academic Agents;
- expected Web Search-enabled personas;
- required runtime containers;
- verification fingerprint.

### Hardened API health check

The verifier no longer assumes a PROD host port.

It checks from inside the API container:

```text
http://127.0.0.1:3080/health
```

This makes release verification independent of Apache or host-port mappings.

---

## 17. Model router

Expected Release-D healthy baseline:

```json
{
  "status": "ok",
  "enabled": true,
  "classes": {
    "class-a": 4,
    "class-b": 6
  },
  "credentials": {
    "google": 6,
    "groq": 2,
    "openrouter": 2,
    "cloudflare": 3
  }
}
```

An HTTP-healthy router with zero usable classes is operationally failed.

Required service:

```text
model-router
```

It must be Compose-managed.

---

## 18. SearXNG

Required API environment:

```text
SEARXNG_INSTANCE_URL=http://searxng:8080
```

Required service:

```text
searxng
```

It must be Compose-managed.

Release verification checks actual connectivity from API to SearXNG.

Web Search should not silently depend on another provider when SearXNG is the configured provider.

---

## 19. Academic Tools / Academic Agents

The Academic Tools UI is dynamic.

It depends on enabled Academic Agent records in:

```text
LibreChat.academicAgents
```

Tenant:

```text
SEEDS
```

Priority Release-D agents:

```text
EVIDENCE_OF_LEARNING
RESEARCH_CLAIM_AUDITOR
CURRICULUM_COHERENCE
```

Important lesson:

> Frontend code alone does not make Academic Tools appear.

Required database state is part of the release contract and belongs in idempotent migrations.

---

## 20. Bind-mounted configuration

The API has historically mounted files such as:

```text
./librechat.yaml -> /app/librechat.yaml
./images         -> /app/client/public/images
```

Therefore:

> A newer image does not automatically imply newer runtime configuration.

This was one of the primary Release-D promotion lessons.

Every behaviorally significant bind-mounted file must be an explicit release artifact.

---

## 21. `close-release.sh`

### Purpose

Formally close an accepted release and safely reclaim storage.

The script:

- reruns verification;
- requires a verification checkpoint matching the current manifest;
- writes a final release fingerprint;
- reports Docker storage;
- prunes dangling images;
- prunes build cache;
- applies explicit image-retention logic.

### Hardened retention

The following are protected:

```text
EXPECTED_API_IMAGE
ROLLBACK_API_IMAGE
RETAIN_API_IMAGES
```

In addition, the script automatically protects any image currently referenced by a running container.

This prevents release closure from deleting another environment's active candidate image.

Optional extra retention:

```text
RETAIN_API_IMAGES=image1,image2,...
```

### Never use

```bash
docker system prune -a
```

or:

```bash
docker volume prune
```

for routine AIH cleanup.

---

## 22. Smart storage cleanup

Measure first:

```bash
clear

df -h /
docker system df
```

Safe generic cleanup:

```bash
clear

docker image prune -f
docker builder prune -af
```

Inspect AIH application images:

```bash
clear

docker image ls seeds.azurecr.io/aischolarhub-custom \
  --format '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}'
```

Delete obsolete release tags explicitly unless using the hardened close script.

If an image is referenced by a container, do not force-delete it until that dependency is understood.

---

## 23. Persistent data safety

Never blindly delete:

```text
MongoDB data
Meilisearch data
PostgreSQL/pgvector data
Ollama data
uploads
```

Never manually delete Docker volumes as part of ordinary release cleanup.

---

## 24. ConnMan and Docker networking

ConnMan is required for host Azure connectivity.

Do not casually:

```text
stop ConnMan
disable ConnMan
mask ConnMan
restart ConnMan
restart Docker
restart the VM
```

Relevant host policy:

```text
NetworkInterfaceBlacklist = vmnet,vboxnet,virbr,ifb,ve-,vb-,veth,docker,br-
```

Ownership model:

```text
ConnMan → Azure eth0
Docker  → docker0, br-*, veth*
```

Repair a specific broken Docker network rather than restarting the host networking stack.

---

## 25. Secrets handling

Never expose secret values in diagnostics.

Avoid unfiltered use of:

```text
cat .env
docker compose config
```

when they may print credentials.

Prefer:

- presence checks;
- filtered inspection;
- commands inside already-configured containers;
- redacted output.

Credential categories include:

```text
MongoDB
PostgreSQL
email/app credentials
Azure/OpenAI
Google
Groq
OpenRouter
Cloudflare
```

Rotate credentials if they are exposed.

---

## 26. `SHA256SUMS`

Current tooling checksums are stored in:

```text
scripts/release-tooling/SHA256SUMS
```

After any tooling change:

```bash
clear

cd scripts/release-tooling

sha256sum \
  README.md \
  close-release.sh \
  promote-aca-ui.sh \
  promote-release.sh \
  release-e.env.example \
  release-lib.sh \
  validate-release-assets.sh \
  verify-release.sh \
  > SHA256SUMS

sha256sum -c SHA256SUMS

cd ../..
```

Do not include `SHA256SUMS` in its own checksum list.

---

## 27. Standard release workflow

### A. Develop

```text
feature work
→ test
→ review
→ commit
```

### B. Validate assets

```bash
clear

scripts/release-tooling/validate-release-assets.sh source
```

### C. Build one immutable image

```bash
clear

./scripts/acr-build.sh release-e-<candidate>
```

### D. Push deployment tag

```bash
clear

git push origin "<generated-tag>"
```

### E. DEV UAT

Validate:

```text
authentication
persona routing
model router
RAG
institution/group RAG
Web Search
Academic Tools
role/tenant authorization
file upload
citations
branding/assets
release-specific functionality
```

### F. ACA validation

```bash
clear

ACA_RESOURCE_GROUP="AI-SCHOLAR-HUB-ACA-TEST" \
ACA_APP_NAME="ash-web" \
ACA_IMAGE="<exact DEV-tested image>" \
  scripts/release-tooling/promote-aca-ui.sh
```

Validate browser behavior and required static assets by MIME type, not HTTP status alone.

### G. Freeze release contract

Populate:

```text
release-e.env
```

Freeze:

```text
release-artifacts/release-e/
release-migrations/release-e/
```

Record exact image digest.

### H. PROD promotion

```bash
clear

scripts/release-tooling/promote-release.sh release-e.env
```

### I. Independent verification

```bash
clear

scripts/release-tooling/verify-release.sh release-e.env
```

### J. Acceptance/soak

Exercise real workflows and inspect relevant logs.

### K. Closure

```bash
clear

scripts/release-tooling/close-release.sh release-e.env
```

---

## 28. Pre-Release-E archive

The pre-Release-E working tree was preserved under:

```text
/home/ppatra/Downloads/aih-pre-release-e-20260912-091436
```

It contains:

```text
git-status.txt
tracked-changes.patch
staged-changes.patch
untracked-files.tar.gz
release-tooling/
ACA-UI-LAST-PROMOTION.txt
```

Retain this until Release E is stable.

---

## 29. Minimum release evidence

Every accepted release should leave enough evidence to reconstruct it independently of chat history.

Retain:

```text
Git source commit
Git deployment/release tag
ACR image tag
ACR image digest
release manifest
release-artifact hashes
migration scripts
ACA checkpoint
PROD pre-promotion checkpoint
verification checkpoint
final release fingerprint
rollback image reference
```

---

## 30. Failure modes now explicitly protected

The hardened Release-E tooling addresses the key failures discovered during Release D and early Release E:

### Missing static asset

Protected by:

```text
validate-release-assets.sh
```

A configured image that exists locally but is absent from committed `HEAD` blocks the build.

### SPA fallback masquerading as valid asset

Operational validation must confirm MIME type, not merely HTTP 200.

### Wrong host-port health assumption

`verify-release.sh` checks `/health` inside the API container on port 3080.

### Mutable DEV configuration entering PROD

`promote-release.sh` requires explicit frozen artifact paths for promoted `librechat.yaml` or Compose files.

### Orphan supporting services

Promotion requires SearXNG and model-router to be Compose-managed.

### Healthy-but-empty model router

Verification checks class counts and credential availability.

### Cleanup removing another environment's active image

`close-release.sh` protects current, rollback, explicitly retained, and running-container images.

### Secrets in diagnostics

Release scripts check presence rather than printing secret values.

---

## 31. Final operating rule

Classify every release change before deployment:

```text
source code / compiled UI
    → immutable application image

bind-mounted YAML / Compose
    → frozen release artifact

database/policy state
    → idempotent migration

credentials
    → environment / secret management

supporting runtime service
    → Compose-managed dependency

acceptance evidence
    → release checkpoint

old builds/cache
    → controlled cleanup after acceptance
```

If a change does not fit one of those categories, stop and decide how it becomes reproducible before promoting it.

That discipline is the basis of a reliable AI Scholar Hub release process.


---

## Release E ACA user-runtime hardening — 2026-09-12

### Deployment boundary

The administration plane remains DEV-only. Do not deploy `admin-ui` or `admin-panel` to Azure Container Apps.

The ACA deployment is the user-facing AI Scholar Hub application. Its runtime dependencies are not administration interfaces. Current user-runtime dependencies referenced by `ash-web` are:

- `model-router`
- `gemini-proxy`
- `academic-research-mcp`
- `searxng`

RAG is currently reached through its already configured reachable endpoint and is not changed by this hardening pass.

### Compose DNS is not an ACA contract

Names such as `model-router`, `gemini-proxy`, `academic-research-mcp`, and `searxng` work automatically inside Docker Compose. They are valid in ACA only when an ACA networking topology deliberately provides those names, or when the application is configured to use a different reachable endpoint.

The release gate must reject a promotion when a Compose-only hostname has no ACA mapping.

### ACA-specific verification

ACA verification is intentionally separate from `verify-release.sh`.

- `verify-release.sh` remains the VM PROD verifier.
- `validate-aca-runtime.sh` is the ACA user-runtime verifier.
- `promote-aca-ui.sh` invokes the ACA gate before changing the image and again after deployment.

The ACA gate checks:

- no admin-interface containers are present;
- model-router, Gemini proxy, SearXNG and Academic Research MCP references have a valid ACA mapping;
- MCP uses a concrete URL;
- required runtime apps are provisioned in the same ACA environment when that topology is selected;
- the web app health endpoint responds;
- `/images/favicon-16x16.png` returns HTTP 200 and `Content-Type: image/png`.

### MCP interpolation limitation

LibreChat's MCP domain validation evaluates the configured MCP URL before ordinary `${...}` substitution is usable for this path. Using `${ACADEMIC_RESEARCH_MCP_URL}` caused the host to be interpreted as `unknown` and the MCP registry refused to initialize.

Therefore the Academic Research MCP URL remains concrete in the release configuration unless LibreChat's MCP interpolation behavior changes and is revalidated.

### Release-E port portability

Release E made the Python user-runtime services port-configurable while preserving DEV defaults:

- model-router defaults to port 8000 and can use `PORT`;
- Gemini proxy defaults to port 8000 and can use `PORT`;
- Academic Research MCP now honors `HOST` and `PORT`.

Regression testing confirmed:

- model-router: DEV 8000 and alternate 8001;
- Gemini proxy: DEV 8000 and alternate 8002;
- Academic Research MCP: DEV 8000 and alternate 8003.

This makes a localhost-sidecar topology possible if ever selected, while not requiring that topology.

### Immutable runtime images

Built successfully from committed Release-E HEAD `d049b3414`:

```text
seeds.azurecr.io/aih-model-router:release-e-d049b3414
seeds.azurecr.io/aih-gemini:release-e-d049b3414
seeds.azurecr.io/aih-mcp:release-e-d049b3414
seeds.azurecr.io/aih-searxng:release-e-d049b3414
```

### Icon incident closed

The ACA favicon incident is closed. The final verified response is:

```text
/images/favicon-16x16.png
HTTP 200
Content-Type: image/png
Content-Length: 860
```

The underlying release lesson is retained: local presence is insufficient because ACR builds from committed Git `HEAD`; referenced release assets must be tracked by Git and validated before build.

### Python build hygiene

`__pycache__/` is ignored in Git as of commit `d049b3414`, preventing syntax-check artifacts from appearing as untracked release changes.
