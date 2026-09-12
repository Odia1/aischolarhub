# AI Scholar Hub release tooling

This tooling turns an AIH release into a deployment contract rather than only a Docker image.

## Files
- `promote-aca-ui.sh` — promotes the exact DEV-tested UI/API image to the existing Azure Container App. It auto-discovers only when exactly one ACA app uses the AIH image repository; otherwise it fails and requires explicit `ACA_RESOURCE_GROUP` / `ACA_APP_NAME`.
- `promote-release.sh` — VM PROD promotion: immutable image, mutable config checkpoints, environment gates, managed runtime dependencies, idempotent migrations, API deployment, verification.
- `verify-release.sh` — acceptance gate for API, SearXNG, model-router, Academic Agents, persona Web Search configuration, and runtime services.
- `close-release.sh` — refuses closure without a fresh passing verification, writes the final release fingerprint, safely prunes dangling images/build cache, and retains current + one rollback AIH image.
- `release-e.env.example` — Release E manifest template.

## Safety properties
- no secrets are printed;
- PROD is never rebuilt;
- exact DEV-tested image is promoted;
- required runtime services must be Compose-managed;
- no `docker system prune -a`;
- no volume pruning;
- cleanup occurs only after verification;
- promotion is serialized with `flock`;
- configuration is checkpointed before mutation;
- release-specific DB/schema changes live as idempotent migrations.

## ACA UI promotion
Before Release E work begins, the current DEV-tested Release-D image can be pushed to the existing ACA UI:

```bash
ACA_IMAGE=seeds.azurecr.io/aischolarhub-custom:dev-20260912-c33a0b62c-release-d-uat-v3 \
./scripts/promote-aca-ui.sh
```

If auto-discovery finds zero or multiple candidate apps:

```bash
ACA_RESOURCE_GROUP=<existing-resource-group> \
ACA_APP_NAME=<existing-container-app> \
ACA_IMAGE=seeds.azurecr.io/aischolarhub-custom:dev-20260912-c33a0b62c-release-d-uat-v3 \
./scripts/promote-aca-ui.sh
```

## Release E workflow
1. Finish DEV implementation and UAT.
2. Build one immutable ACR image from committed Git HEAD.
3. Record its tag and digest in `release-e.env`.
4. Put any DB changes in `release-migrations/release-e/*.sh`, written idempotently.
5. Put intentionally promoted bind-mounted files under `release-artifacts/release-e/` and enable their manifest flags.
6. Run `promote-release.sh release-e.env`.
7. After acceptance/soak, run `close-release.sh release-e.env`.
