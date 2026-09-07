# AI Scholar Hub next-release deployment

These commands deploy only to the active development installation. They do not
modify a production installation.

## 1. Back up the files replaced by the release

Run from `/opt/aischolarhub`:

```bash
clear
backup_dir="/home/ppatra/Downloads/aih-pre-next-release-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
cp --parents \
  docker-compose.yml \
  model-router/server.py \
  admin-ui/server.js \
  admin-ui/package.json \
  admin-ui/package-lock.json \
  admin-ui/public/admin-models.js \
  admin-ui/public/admin-agents.js \
  admin-ui/public/admin-org.js \
  admin-ui/public/index.html \
  api/server/services/Config/app.js \
  api/server/services/AcademicIntelligence/knowledgeScope.js \
  "$backup_dir"
```

## 2. Verify and extract the release

```bash
clear
cd /home/ppatra/Downloads
sha256sum -c aischolarhub-next-release-v2.tar.gz.sha256
tar -tzf aischolarhub-next-release-v2.tar.gz
tar -xzf aischolarhub-next-release-v2.tar.gz -C /opt/aischolarhub
```

## 3. Validate configuration and restart changed services

Run from `/opt/aischolarhub`:

```bash
clear
docker compose config --quiet
docker compose build model-router
docker compose up -d model-router admin-ui api
docker compose ps
```

## 4. Verify health and initialization

```bash
clear
docker compose exec -T model-router python -c \
"import json,urllib.request; print(json.load(urllib.request.urlopen('http://127.0.0.1:8000/health')))"
curl -fsS http://127.0.0.1:3080/api/health
docker compose logs --since=5m admin-ui api model-router | \
  grep -E "ERROR|Error|ROUTER PROVIDER ATTEMPT|ROUTER VALIDATION|listening|readiness" || true
```

In the Administrator Portal, verify:

1. **AI Experience Policy** displays Classes A/B/C, Class Composition,
   SUPERADMIN entitlements, the three primary experiences, and inherited agent
   routing.
2. **Groups & Structure** displays separate RAG Access Points and RAG Access
   Groups.
3. An Access Point's **Documents** action can upload, list, and remove a small
   test document.
4. A RAG Access Group can grant multiple Access Points to a selected group and
   its descendants.
