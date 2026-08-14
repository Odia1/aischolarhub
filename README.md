# AI Scholar Hub — LibreChat on your VM + Gemini

**Start here → [INSTRUCTIONS.md](./INSTRUCTIONS.md)**

Deployed on your existing lightly-loaded Ubuntu VM (Azure), not Azure App
Service — this repo went through an App Service iteration first, but
Compose-on-App-Service turned out to need a lot of workarounds (no local
bind-mounts, no real persistent storage without extra Azure Files
plumbing, `depends_on` silently ignored, and the whole feature is being
retired by Microsoft in 2027 anyway). A VM you already control sidesteps
all of that.

## What's in this repo

```
INSTRUCTIONS.md          <- start here, numbered walkthrough
docker-compose.yml       <- the one and only compose file (local test == production)
.env.example             <- copy to .env, fill in secrets
config/librechat.yaml    <- personas, rate limits, domain lock, balance tiers

deploy-vm.sh             <- installs Docker if needed, firewall, starts the stack
deploy/
  README.md              <- reverse proxy setup — two paths depending on
                             whether nginx/Apache already runs on your VM
  nginx-aischolarhub.conf
  apache-aischolarhub.conf
  Caddyfile

scripts/
  generate-secrets.sh    <- alnum-only secrets (safe in connection strings)
  bulk_import.py         <- roster CSV -> LibreChat accounts + token balances
                             (runs directly via `docker exec` — no SSH-into-
                             container indirection needed on a real VM)

docs/
  SCALING.md             <- what to do as demand grows: measure first, then
                             vertical scaling -> resource isolation ->
                             managed datastores -> Container Apps, in that order
  RUNBOOK.md             <- day-2 ops
```

## Why this is simpler than the App Service version

| | App Service | VM |
|---|---|---|
| Config changes | rebuild custom image, push to ghcr.io, redeploy | `docker compose restart api` |
| Persistent storage | 5 separate Azure Files mounts | real disk, just works |
| Local test vs production | two different compose files | the same file |
| Startup ordering | `depends_on` silently ignored | works normally |

## Governance model, unchanged from before

Domain-restricted registration and the two locked personas (Socratic
Tutor / Research Synthesizer) live in `config/librechat.yaml`. Per-student
token quotas run on LibreChat's native balance system via
`scripts/bulk_import.py`. Burst rate limiting is LibreChat's built-in
message-rate limiter (`.env.example`), with a daily allowance via the
balance system's auto-refill.

## Protecting your VM's other websites

`docker-compose.yml` sets `mem_limit`/`cpus` on every service — this is
what keeps AI Scholar Hub from starving whatever else is running on the
VM under load, and vice versa. See `docs/SCALING.md` for what to do if
that's not enough headroom as usage grows.
