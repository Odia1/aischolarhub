# AI Scholar Hub release tooling

This tooling treats a release as a deployment contract rather than only a Docker image.

## Deployment boundaries

- **DEV-only administration plane:** `admin-ui`, `admin-panel`, and administration interfaces.
- **ACA user plane:** `ash-web` plus only the runtime services required by user-facing AI Scholar Hub features.
- **VM PROD:** retains its own Compose-based verification and promotion workflow.

The ACA runtime dependencies currently required by `ash-web` are:

- `model-router`
- `gemini-proxy`
- `academic-research-mcp`
- `searxng`

They are not administration interfaces.

## Files

- `promote-aca-ui.sh` — promotes one exact immutable user UI/API image only after the ACA runtime dependency gate passes.
- `validate-aca-runtime.sh` — ACA-specific dependency/topology/asset gate. It prevents promotion when Compose-only hostnames are unresolved, admin interfaces are present, or runtime apps are absent.
- `promote-release.sh` — VM PROD promotion.
- `verify-release.sh` — VM PROD acceptance gate. ACA checks intentionally live in `validate-aca-runtime.sh`.
- `validate-release-assets.sh` — verifies configured release assets exist in committed Git/image content.
- `close-release.sh` — release closure and safe cleanup.
- `release-e.env.example` — Release E deployment contract.

## ACA rules

1. Do not promote `admin-ui` or `admin-panel` to ACA.
2. A Docker Compose hostname is not automatically valid in ACA.
3. Any hostname referenced by the user-facing configuration must map to:
   - a same-environment ACA app,
   - a deliberate localhost sidecar, or
   - an explicit reachable external/private endpoint.
4. `academic-research` MCP currently requires a concrete URL in `librechat.yaml`; `${...}` interpolation is rejected by LibreChat's MCP domain validation as `unknown`.
5. The ACA icon gate requires `/images/favicon-16x16.png` to return HTTP 200 with `Content-Type: image/png`.
6. The runtime gate is executed before and after `promote-aca-ui.sh`.
7. `verify-release.sh` remains a VM PROD verifier and is not overloaded with ACA logic.

## Current Release-E runtime images

Built from committed Release-E HEAD `d049b3414`:

```text
seeds.azurecr.io/aih-model-router:release-e-d049b3414
seeds.azurecr.io/aih-gemini:release-e-d049b3414
seeds.azurecr.io/aih-mcp:release-e-d049b3414
seeds.azurecr.io/aih-searxng:release-e-d049b3414
```

## ACA promotion

Use explicit resource group/app/image values:

```bash
clear

ACA_RESOURCE_GROUP="AI-SCHOLAR-HUB-ACA-TEST" \
ACA_APP_NAME="ash-web" \
ACA_IMAGE="seeds.azurecr.io/aischolarhub-custom:<exact-tested-tag>" \
scripts/release-tooling/promote-aca-ui.sh
```

The script refuses promotion unless the ACA user-runtime gate passes first.

## Release E workflow

1. Finish DEV implementation and UAT.
2. Build immutable artifacts from committed Git HEAD.
3. Validate tracked assets.
4. Validate ACA runtime dependencies before promotion.
5. Promote the exact tested ACA UI/API image.
6. Run the ACA runtime gate again after deployment.
7. Keep VM PROD promotion/verification separate.
8. Close the release only after the relevant environment-specific verification passes.

## Release-independent ACA runtime reconciliation

Use `ensure-aca-runtime.sh` for the ACA user-runtime services. The script discovers the environment, managed identity and registry from `ash-web`; only immutable image references and the resource group/app name are supplied.

```bash
ACA_RESOURCE_GROUP="<resource-group>" \
ACA_APP_NAME="ash-web" \
ACA_MODEL_ROUTER_IMAGE="<exact-image>" \
ACA_GEMINI_PROXY_IMAGE="<exact-image>" \
ACA_MCP_IMAGE="<exact-image>" \
ACA_SEARXNG_IMAGE="<exact-image>" \
scripts/release-tooling/ensure-aca-runtime.sh
```

It creates or updates the runtime apps idempotently, reconciles internal ingress and runtime URLs, and finishes by calling `validate-aca-runtime.sh`.

User acceptance criteria are maintained separately in `docs/USER-ACCEPTANCE-TEST.md`.
