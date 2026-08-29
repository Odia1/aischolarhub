AI Scholar Hub — Docker Command Manual

Current deployment

Project directory:     /opt/aischolarhub

LibreChat container:   AI_Scholar_Hub
MongoDB container:      chat-mongodb
PostgreSQL container:   vectordb
Ollama container:       aischolarhub-ollama
Gemini proxy container: aischolarhub-gemini-proxy

Main LibreChat YAML:   /opt/aischolarhub/librechat.yaml
Environment file:      /opt/aischolarhub/.env
Database:              LibreChat
Mongo authentication:  admin
1. Go to the project directory
cd /opt/aischolarhub
2. See all running containers
docker ps

Cleaner version:

docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

See all containers, including stopped ones:

docker ps -a
3. Start the complete AI Scholar Hub stack

From /opt/aischolarhub:

docker compose up -d

Recreate containers after configuration changes:

docker compose up -d --force-recreate

Rebuild images when you have changed a Dockerfile or application code:

docker compose up -d --build
4. Stop the stack
docker compose down

This stops/removes containers but normally preserves volumes.

Do not use -v casually:

docker compose down -v

That can remove Docker volumes and therefore persistent data.

5. Restart one container

LibreChat:

docker restart AI_Scholar_Hub

MongoDB:

docker restart chat-mongodb

Gemini proxy:

docker restart aischolarhub-gemini-proxy

Ollama:

docker restart aischolarhub-ollama
6. Check container status
docker ps --format "table {{.Names}}\t{{.Status}}"

Check one container:

docker inspect -f '{{.State.Status}}' AI_Scholar_Hub

Check whether it is running:

docker inspect -f '{{.State.Running}}' AI_Scholar_Hub
Logs
7. LibreChat logs

Last 100 lines:

docker logs AI_Scholar_Hub --tail 100

Follow live:

docker logs -f AI_Scholar_Hub

Logs from the last 10 minutes:

docker logs --since 10m AI_Scholar_Hub

Last 50 lines with timestamps:

docker logs -t --tail 50 AI_Scholar_Hub
8. Search LibreChat logs for an error

Example:

docker logs --since 20m AI_Scholar_Hub 2>&1 | grep -i "error"

Search for a specific model:

docker logs --since 20m AI_Scholar_Hub 2>&1 | grep -i "gemini-3.5-flash-lite"

Search for an endpoint/model validation problem:

docker logs --since 20m AI_Scholar_Hub 2>&1 | grep -iE 'illegal_model_request|not available'
9. Gemini proxy logs
docker logs aischolarhub-gemini-proxy --tail 100

Live:

docker logs -f aischolarhub-gemini-proxy
10. MongoDB logs
docker logs chat-mongodb --tail 100

Live:

docker logs -f chat-mongodb
11. Ollama logs
docker logs aischolarhub-ollama --tail 100
Entering containers
12. Enter LibreChat container
docker exec -it AI_Scholar_Hub sh

Exit:

exit
13. Enter MongoDB shell

Your authenticated command:

docker exec -it chat-mongodb mongosh \
  -u "$MONGO_INITDB_ROOT_USERNAME" \
  -p "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin \
  LibreChat

If those variables aren't exported in your current host shell, use the credentials from .env as appropriate, but don't expose passwords in chat or shell history unnecessarily.

MongoDB
14. Select the LibreChat database

Inside mongosh:

use LibreChat
15. List collections
show collections

or:

db.getCollectionNames()
16. Check Instructor users
db.users.find(
  { role: { $in: ["Instructor", "INSTRUCTOR", "instructor"] } },
  {
    _id: 1,
    name: 1,
    email: 1,
    role: 1,
    endpoint: 1,
    model: 1,
    models: 1,
    endpoints: 1,
    presets: 1
  }
).forEach(printjson)
17. Check the Instructor role
db.roles.find(
  { name: { $in: ["Instructor", "INSTRUCTOR", "instructor"] } }
).forEach(printjson)

Remember: in your setup, the Instructor role document contains permissions, not model assignments.

18. Check the role-level configuration

This is especially important for your AI Scholar Hub:

db.configs.findOne(
  {
    principalType: "role",
    principalId: "Instructor"
  }
)

Your working Instructor configuration is:

Socratic Tutor
  endpoint: Gemini Academic Assistant
  model:    gemini-3.5-flash

Research Synthesizer
  endpoint: Gemini Academic Assistant
  model:    gemini-3.7-flash
19. Find a particular model across MongoDB

Example:

db.conversations.find({
  model: "gemini-3.5-flash-lite"
}).forEach(printjson)

The user field in your LibreChat conversations contains the user's ID. Do not assume it is called userId.

20. Count conversations using a model
db.conversations.countDocuments({
  model: "gemini-3.5-flash-lite"
})

For M Acharya:

db.conversations.countDocuments({
  user: "6a8a86fe00ec19c5498ebcaa",
  model: "gemini-3.5-flash-lite"
})
21. Exit MongoDB
exit
Gemini Proxy
22. Check files in the proxy
find /opt/aischolarhub/gemini-proxy -maxdepth 2 -type f -print

Current important files:

gemini-proxy/server.py
gemini-proxy/Dockerfile
gemini-proxy/requirements.txt
23. Check Gemini models exposed by the proxy
grep -n -A4 -B2 '"id": "gemini-' \
  /opt/aischolarhub/gemini-proxy/server.py

Your current proxy exposes:

gemini-3.5-flash
gemini-3.5-flash-lite
gemini-3.7-flash
LibreChat configuration
24. Main configuration file

The active file is:

/opt/aischolarhub/librechat.yaml

It is mounted into the container as:

/opt/aischolarhub/librechat.yaml
    ->
/app/librechat.yaml

Verify the mount:

docker inspect AI_Scholar_Hub --format '{{range .Mounts}}{{println .Source " -> " .Destination}}{{end}}'
25. Check Gemini configuration
grep -n -A15 -B3 "Gemini Academic Assistant" \
  /opt/aischolarhub/librechat.yaml
26. Check for a specific model
grep -n "gemini-3.5-flash" /opt/aischolarhub/librechat.yaml

Or:

grep -n "gemini-3.5-flash-lite" /opt/aischolarhub/librechat.yaml
27. Check YAML for tabs

Tabs in YAML caused problems in your deployment previously.

grep -nP '\t' /opt/aischolarhub/librechat.yaml

No output is what you want.

28. Validate the YAML

If Python/YAML tooling is available on the host:

python3 - <<'PY'
import yaml
with open('/opt/aischolarhub/librechat.yaml', 'r') as f:
    yaml.safe_load(f)
print("YAML OK")
PY

If PyYAML isn't installed, you can use the running LibreChat container/application logs as the validation mechanism.

Compose
29. See effective Compose configuration
cd /opt/aischolarhub
docker compose config

Save it:

docker compose config > /tmp/aischolar-compose-effective.yml
30. Validate Compose configuration
docker compose config -q

No output generally means the Compose configuration is valid.

31. Show services
docker compose config --services
32. Show Compose service status
docker compose ps
Volumes and persistent data
33. List Docker volumes
docker volume ls

Your LibreChat data volume includes:

aischolarhub_librechat-data

Inspect it:

docker volume inspect aischolarhub_librechat-data
34. Be careful with volumes

Never casually run:

docker compose down -v

That can remove persistent application/database volumes.

For AI Scholar Hub, backup first before destructive Docker operations.

Backup
35. Run your backup
cd /opt/aischolarhub
./backup.sh

Your backup directory is:

/opt/aischolarhub/backups

List backups:

ls -lh /opt/aischolarhub/backups/
36. Check backup script syntax
bash -n /opt/aischolarhub/backup.sh

No output means the shell syntax passed.

37. Check whether the backup script is executable
ls -l /opt/aischolarhub/backup.sh

If necessary:

chmod +x /opt/aischolarhub/backup.sh
Useful inspection commands
38. Look at container environment without displaying secrets
docker exec AI_Scholar_Hub env | cut -d= -f1 | sort
39. Inspect MongoDB container environment variable names only
docker inspect chat-mongodb \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | cut -d= -f1
40. Check resource usage
docker stats

One container:

docker stats AI_Scholar_Hub
41. Check disk usage by Docker
docker system df

Do not run cleanup commands such as docker system prune -a unless you deliberately want unused images/containers/networks removed.

Updating after configuration changes
42. After changing only librechat.yaml

Because it is bind-mounted, normally restart LibreChat:

docker restart AI_Scholar_Hub

Then check:

docker logs --since 30s AI_Scholar_Hub 2>&1 | tail -50
43. After changing Gemini proxy code

Rebuild/recreate the proxy:

docker compose build gemini-proxy
docker compose up -d gemini-proxy

Then:

docker logs --since 30s aischolarhub-gemini-proxy
44. After changing Docker Compose configuration
docker compose up -d

Forcing recreation:

docker compose up -d --force-recreate
Fast troubleshooting sequence

When AI Scholar Hub suddenly stops working, this is the sequence I would remember:

cd /opt/aischolarhub

docker ps

docker compose config -q

docker logs --tail 50 AI_Scholar_Hub

docker logs --tail 50 aischolarhub-gemini-proxy

docker logs --tail 50 chat-mongodb

Then, if it is a model problem:

grep -n -A15 -B3 "Gemini Academic Assistant" librechat.yaml

And if it is an Instructor-specific problem, inspect:

db.configs.findOne({
  principalType: "role",
  principalId: "Instructor"
})
AI Scholar Hub commands worth memorizing

These are the core 10 I'd keep handy:

cd /opt/aischolarhub
docker ps
docker compose ps
docker logs --tail 100 AI_Scholar_Hub
docker logs -f AI_Scholar_Hub
docker restart AI_Scholar_Hub
docker compose up -d
docker compose config -q
docker exec -it chat-mongodb mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin LibreChat
./backup.sh

And the single most important safety rule for this deployment:

BACKUP → BEFORE → destructive Docker/MongoDB changes

Your current successful Instructor design should remain:

Instructor role
      ↓
LibreChat.configs
      ↓
Gemini Academic Assistant
      ├── Socratic Tutor → gemini-3.5-flash
      └── Research       → gemini-3.7-flash

That role-level configuration is the key piece to remember when troubleshooting Instructor model behavior.
