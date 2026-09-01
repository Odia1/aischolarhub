#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# AI Scholar Hub — stack-local MongoDB shell
#
# Usage:
#   ./mongo.sh
#   ./mongo.sh --eval 'db.users.find().limit(5).forEach(printjson)'
#   ./mongo.sh LibreChat --eval 'db.users.countDocuments()'
#
# The stack is determined by the directory containing this script.
# No PORT, RAG_PORT, Mongo shell variables, or "source .env" required.
# ============================================================

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Verify this is a Compose project.
if [[ ! -f "$SCRIPT_DIR/docker-compose.yml" ]]; then
    echo "ERROR: docker-compose.yml not found in $SCRIPT_DIR" >&2
    exit 1
fi

# Determine the Compose project name from this directory.
COMPOSE_PROJECT="$(docker compose config --format json 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("name",""))')"

if [[ -z "$COMPOSE_PROJECT" ]]; then
    echo "ERROR: Could not determine Docker Compose project." >&2
    exit 1
fi

# Determine the MongoDB container from the current Compose project.
MONGO_CONTAINER="$(
    docker compose ps -q mongodb 2>/dev/null
)"

if [[ -z "$MONGO_CONTAINER" ]]; then
    echo "ERROR: MongoDB container for Compose project '$COMPOSE_PROJECT' is not running." >&2
    echo
    echo "Start this stack first with:"
    echo "  docker compose up -d"
    exit 1
fi

# Read credentials from THIS stack's .env.
ENV_FILE="$SCRIPT_DIR/.env"

if [[ ! -r "$ENV_FILE" ]]; then
    echo "ERROR: $ENV_FILE not found or not readable." >&2
    exit 1
fi

get_env_value() {
    local key="$1"
    local value

    value="$(
        awk -v key="$key" '
            $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
                sub("^[[:space:]]*" key "[[:space:]]*=[[:space:]]*", "")
                print
                exit
            }
        ' "$ENV_FILE"
    )"

    # Remove optional surrounding quotes.
    value="${value#\"}"
    value="${value%\"}"
    value="${value#'}"
    value="${value%'}"

    printf "%s" "$value"
}

MONGO_USER="$(get_env_value MONGO_INITDB_ROOT_USERNAME)"
MONGO_PASS="$(get_env_value MONGO_INITDB_ROOT_PASSWORD)"

if [[ -z "$MONGO_USER" || -z "$MONGO_PASS" ]]; then
    echo "ERROR: MongoDB credentials not found in $ENV_FILE" >&2
    echo "Required:"
    echo "  MONGO_INITDB_ROOT_USERNAME"
    echo "  MONGO_INITDB_ROOT_PASSWORD"
    exit 1
fi

# Default to LibreChat, but permit an explicit database name as
# the first non-option argument.
DB_NAME="LibreChat"

if [[ $# -gt 0 && "$1" != -* ]]; then
    DB_NAME="$1"
    shift
fi

echo "================================================"
echo "MongoDB shell"
echo "================================================"
echo "Stack:       $COMPOSE_PROJECT"
echo "Directory:   $SCRIPT_DIR"
echo "Container:   $MONGO_CONTAINER"
echo "Database:    $DB_NAME"
echo "================================================"

exec docker exec -it "$MONGO_CONTAINER" \
    mongosh \
    --username "$MONGO_USER" \
    --password "$MONGO_PASS" \
    --authenticationDatabase admin \
    "$DB_NAME" \
    "$@"

