docker exec AI_Scholar_Hub node /app/config/create-user.js ppatra@seedsnet.org "P Patra" ppatra <passwd>   --email-verified=True


# Runbook — Day-2 Operations

All commands below run directly on the VM, in `/opt/aischolarhub` (or
wherever you placed the project) — `docker exec` works normally here,
unlike the old App Service setup which needed `az webapp ssh` indirection.

## New semester roster
```bash
python3 scripts/bulk_import.py new_roster.csv --container AI_Scholar_Hub --domain college.edu
```
Safe to re-run — already-provisioned emails just get their balance
re-applied, not duplicated.

## Student graduated / left — revoke access
```bash
docker exec -it AI_Scholar_Hub npm run set-balance -- student@college.edu 0
```
Zeroing the balance stops further use without deleting their history. To
fully remove the account, use LibreChat's Admin Panel (v0.8.5+) or the
account's own deletion path — coordinate with the student first if using
the latter, since it needs their own auth token, not yours.

## Instructor wants to add a new core textbook to the shared RAG index
Have them upload it through the LibreChat UI under the file-search/RAG
panel while using either persona — `rag_api` handles chunking/embedding
automatically per the `CHUNK_SIZE`/`CHUNK_OVERLAP`/`TOP_K` settings in
`docker-compose.yml`. No separate manual ingestion step needed.

## Gemini API key rotation
```bash
nano .env    # update GEMINI_API_KEY
docker compose restart api rag_api
```
That's the entire procedure now — no image rebuild, no cloud redeploy.

## Something looks like abuse (one account burning way more than its quota)
The balance system catches this automatically once it hits zero. To
manually zero someone out immediately:
```bash
docker exec -it AI_Scholar_Hub npm run set-balance -- student@college.edu 0
```

## Checking current usage/spend
```bash
docker exec -it AI_Scholar_Hub npm run list-balances
```
Cross-reference against actual Gemini API usage in Google AI Studio's own
console for the real dollar figure — the balance system tracks credits,
not currency directly.

## Mongo/Meilisearch/Postgres direct inspection
```bash
docker exec -it chat-mongodb mongosh LibreChat
docker exec -it vectordb psql -U raguser -d ragdb
```
Both work directly now — no Kudu/SSH indirection needed, since you have
the actual Docker socket on this VM.

## VM-specific operations (new — didn't apply on App Service)

**Check resource pressure:**
```bash
docker stats
```
See `docs/SCALING.md` if this consistently shows containers near their
`mem_limit`/`cpus` caps.

**Restart everything after a VM reboot:**
Shouldn't be necessary — `restart: always` in `docker-compose.yml` means
Docker brings the stack back up on its own once the daemon starts, and
`systemctl enable docker` (set by `deploy-vm.sh`) means the daemon starts
on boot. If it doesn't come back after a reboot:
```bash
cd /opt/aischolarhub && docker compose up -d
```

**Disk filling up:**
Unlike App Service (which enforced storage limits for you), a VM will
just... fill its disk if you're not watching:
```bash
df -h
docker system df       # see how much Docker itself is using
docker system prune    # reclaim space from unused images/containers (safe — won't touch running containers or named volumes)
```

**Backups:** see `docs/SCALING.md`'s cron script — this is the one thing
that was fully automatic on App Service (Azure Files redundancy) and now
genuinely needs setting up.



## run all
cd /opt/aischolarhub && docker compose up -d