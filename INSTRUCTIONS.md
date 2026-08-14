# INSTRUCTIONS — Implementing AI Scholar Hub (on your VM)

Everything here runs on your existing Ubuntu VM — no separate Azure App
Service resources needed. If you're doing local testing first on a
different machine (laptop/dev VM), Steps 1-2 apply there too before you
move to the real VM in Step 3 onward.

## Prerequisites

- SSH access to your VM
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
- A DNS subdomain you can point at the VM (e.g. `aischolarhub.yourcollege.edu`)
- Your student roster as a CSV: `email,role,token_quota`

---

## Step 1 — Generate secrets

On whichever machine you're working from:
```bash
cd ai-scholar-hub-librechat
bash scripts/generate-secrets.sh
```
Export the printed values, plus:
```bash
export GEMINI_API_KEY=your-gemini-api-key
export POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c24)
```
Write these down somewhere safe (password manager) — you'll re-export them
on the VM in Step 3.

## Step 2 — (Optional) local test first

If you want to sanity-check the stack before touching the VM at all:
```bash
cp .env.example .env
nano .env   # fill in the values from Step 1
docker compose up -d
```
Visit `http://localhost:3080`, confirm login/personas/Gemini responses
work, confirm the rate limiter rejects an 11th rapid message. Then
`docker compose down` — you don't need to keep this running, it was just a
check.

## Step 3 — Get the project onto the VM

```bash
scp -r ai-scholar-hub-librechat/ you@your-vm-ip:/home/you/
ssh you@your-vm-ip
sudo mkdir -p /opt/aischolarhub
sudo mv ~/ai-scholar-hub-librechat/* /opt/aischolarhub/
sudo chown -R $USER:$USER /opt/aischolarhub
cd /opt/aischolarhub
```

## Step 4 — Configure and start the stack

Re-export the same secrets from Step 1 (in this SSH session):
```bash
export MEILI_MASTER_KEY=...
export JWT_SECRET=...
export JWT_REFRESH_SECRET=...
export CREDS_KEY=...
export CREDS_IV=...
export POSTGRES_PASSWORD=...
export GEMINI_API_KEY=...
```
Then:
```bash
bash deploy-vm.sh
```
This installs Docker if it isn't already there (if it just got installed,
the script will tell you to log out/in and re-run it once), sets up basic
firewall rules, creates `.env` from your exports, pauses so you can fill
in `DOMAIN_CLIENT`/`DOMAIN_SERVER`/Google OAuth values by hand, then starts
the stack.

Check it's up:
```bash
docker compose ps
docker compose logs -f api
```

## Step 5 — Reverse proxy + HTTPS

See **`deploy/README.md`** — it branches into two paths depending on
whether this VM already runs nginx/Apache for your other sites (Path A) or
not (Path B, Caddy). Follow whichever applies, then confirm
`https://aischolarhub.yourcollege.edu` loads the login page.

## Step 6 — Google OAuth redirect URI

In Google Cloud Console, add the real domain's callback URI:
```
https://aischolarhub.yourcollege.edu/oauth/google/callback
```
(alongside the `http://localhost:3080/...` one from local testing, if you
did Step 2 — keep both registered).

## Step 7 — Create your admin account and provision students

This is much simpler than the old App Service path — `docker exec` works
directly now, no SSH-into-container indirection needed:

# Fails: docker exec -it AI_Scholar_Hub npm run create-user -- ppatra@seedsnet.org "Admin" "Foo1Bar@23" --admin

```bash
docker exec -it AI_Scholar_Hub /bin/sh -c "cd .. && npm run create-user ppatra@seedsnet.org Admin Foo1Bar@23 --admin"
```


Copy your roster CSV onto the VM (`scp students.csv you@your-vm-ip:/opt/aischolarhub/`),
then:
```bash
cd /opt/aischolarhub
python3 scripts/bulk_import.py students.csv --container AI_Scholar_Hub --domain seedsnet.org
```
Re-running is safe — already-provisioned students just get their balance
re-applied, not duplicated.

## Step 8 — Ongoing changes

Edit `config/librechat.yaml` directly on the VM, then:
```bash
docker compose restart api
```
No image rebuild, no push, no redeploy step — this is the entire benefit
of moving off App Service. Same for any `.env` change (`docker compose
restart <service>`) or `docker-compose.yml` change (`docker compose up -d`
picks up the new definition).

New students mid-semester: append to your roster CSV, re-run
`bulk_import.py` — same as Step 7.

## Step 9 — Lock things down before going live

- [ ] `config/librechat.yaml`'s `allowedDomains` set to your real institutional domain(s)
- [ ] Confirm `docker compose ps` shows port `127.0.0.1:3080->3080` for `api`, not `0.0.0.0:3080` — if it shows the latter, `docker-compose.yml` wasn't pulled correctly
- [ ] Test the rate limiter against the live domain specifically, not just local
- [ ] `docs/SCALING.md`'s backup script is cron'd — App Service handled storage redundancy for you; a VM doesn't, automatically
- [ ] Confirm the VM's Azure NSG (network security group) only allows 22/80/443 inbound, matching the ufw rules `deploy-vm.sh` set — ufw alone isn't the full picture on Azure, the NSG is a separate layer in front of it

## Troubleshooting quick reference

| Symptom | Likely cause | Fix |
|---|---|---|
| `docker compose up -d` fails pulling an image | Tag doesn't exist / changed upstream | Check the re-verify links at the bottom of `docker-compose.yml` |
| Site loads over HTTP but not HTTPS | Reverse proxy TLS step not done, or DNS not propagated yet | Recheck Step 5, confirm `dig aischolarhub.yourcollege.edu` resolves to the VM's IP |
| Google login redirects back to login page | `DOMAIN_CLIENT`/`DOMAIN_SERVER` in `.env` don't match the domain registered in Google Cloud Console exactly | Step 6, and re-check `.env` |
| Registration rejected for a valid student email | `allowedDomains` in `config/librechat.yaml` doesn't match — remember to `docker compose restart api` after editing it | Step 9 |
| Chat responses arrive all at once instead of streaming | Reverse proxy missing the websocket upgrade headers | nginx: check `deploy/nginx-aischolarhub.conf` has the `Upgrade`/`Connection` lines; Caddy handles this automatically |
