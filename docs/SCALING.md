# Scaling — what to do as demand grows

The honest framing: for a self-hosted internal academic tool, a single VM
scales further than people expect before it becomes the actual bottleneck.
Don't pre-optimize for 1,000 concurrent students on day one — watch actual
resource usage and act on real numbers, not headcount.

## Step 0 — actually measure before acting on anything below

```bash
docker stats                 # live per-container CPU/mem, right now
htop                         # whole-VM picture, including your other websites
```

For something less manual than eyeballing `docker stats` periodically,
install a lightweight always-on dashboard:
```bash
sudo apt install -y netdata
```
Gives you a web UI (default port 19999, put it behind your reverse proxy
or just SSH-tunnel to it — don't expose it publicly) with historical
CPU/mem/disk/network graphs, so "is this VM actually under strain" becomes
a 10-second check instead of a guess.

**The trigger to act isn't a student count — it's sustained resource
pressure.** A rough guide:
- CPU sustained above ~70-80% for extended periods (not brief spikes)
- Memory consistently near the limits set in `docker-compose.yml`
- Students reporting slow responses that aren't explained by Gemini API
  latency itself (check `docker compose logs api` for where time is
  actually going)

## Step 1 — vertical scaling (resize the VM)

The simplest lever, and probably sufficient for a long time on a workload
this size (most of the actual heavy lifting — the LLM inference itself —
happens on Google's infrastructure, not yours; your VM is mostly running a
web server + three lightweight datastores).

```bash
az vm deallocate --resource-group <your-rg> --name <your-vm-name>
az vm resize --resource-group <your-rg> --name <your-vm-name> --size Standard_B4ms
az vm start --resource-group <your-rg> --name <your-vm-name>
```
This causes downtime (VM is off during the resize) — do it in a low-usage
window, e.g. between semesters or late night. Bump the `mem_limit`/`cpus`
values in `docker-compose.yml` afterward to actually take advantage of the
larger VM, then `docker compose up -d` to apply.

## Step 2 — separate the noisy neighbor problem

If it's specifically AI Scholar Hub's load affecting your other websites
(or vice versa) rather than the VM being globally under-resourced, the
`mem_limit`/`cpus` caps already in `docker-compose.yml` are your first
lever — tighten them further so this stack has a hard ceiling regardless
of demand spikes. If that's not enough isolation, the next step up is
moving AI Scholar Hub's containers to their own VM entirely — everything in
this repo is portable as-is (it's just `docker compose up -d` on a fresh
box, plus the reverse proxy step), and your existing sites keep the
original VM to themselves.

## Step 3 — offload the datastores to managed services

This is the point where self-hosting starts costing more in your own time
than a managed service costs in dollars, and it's also where your nonprofit
grant money is well spent:

- **MongoDB** → Azure Cosmos DB for MongoDB (vCore), or MongoDB Atlas's free/low
  tier — removes Mongo from your VM's resource budget, adds managed backups
- **Postgres/pgvector** → Azure Database for PostgreSQL Flexible Server
  (same service the very first draft of this project used, before we moved
  everything to LibreChat's self-hosted stack) — removes vectordb from the
  VM too
- Meilisearch and rag_api stay self-hosted (lighter, and Meilisearch
  specifically doesn't have a comparable "just rent it" managed option
  worth the switch at this scale)

Practically: change `MONGO_URI` and the `vectordb`/rag_api Postgres env
vars in `.env` to point at the managed endpoints instead of the in-Compose
containers, then remove the `mongodb` and `vectordb` services from
`docker-compose.yml` entirely. Your VM now only runs `api`, `meilisearch`,
and `rag_api` — meaningfully lighter.

## Step 4 — if you outgrow a single VM's compute entirely

Unlikely for this specific workload (again: Gemini is doing the actual
heavy lifting), but if it happens: this is where Azure Container Apps
becomes the right answer — not Azure App Service Compose, which we
deliberately moved away from and which is being retired in 2027 anyway.
Container Apps gives real per-container autoscaling and health-based
restarts, and this repo's `docker-compose.yml` ports over to a Container
Apps YAML definition with modest translation work (each service becomes a
Container App; the managed-datastore split from Step 3 should happen
first, since Container Apps doesn't want to be your database host either).

## Backups — do this regardless of which step you're on

App Service handled storage redundancy for you; a VM doesn't, automatically.
Cheap insurance, cron this now rather than after a disk failure:

```bash
# /opt/aischolarhub/backup.sh
#!/usr/bin/env bash
set -euo pipefail
DEST="/opt/aischolarhub/backups/$(date +%Y%m%d)"
mkdir -p "$DEST"
docker compose exec -T mongodb mongodump --archive > "$DEST/mongo.archive"
docker compose exec -T vectordb pg_dump -U raguser ragdb > "$DEST/ragdb.sql"
# Then sync $DEST somewhere off-VM — Azure Blob Storage is cheap and simple:
az storage blob upload-batch -d backups -s "$DEST" --account-name <your-storage-account>
```
Cron it daily (`crontab -e`): `0 3 * * * /opt/aischolarhub/backup.sh`
