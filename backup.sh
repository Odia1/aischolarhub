#!/usr/bin/env bash
# =============================================================================
# AI-Scholar-Hub Smart Backup & Rotation Script
#
# Current architecture:
#   LibreChat API       -> MongoDB (chat-mongodb)
#   RAG API             -> PostgreSQL/pgvector (vectordb)
#   RAG embeddings      -> Ollama (aischolarhub-ollama)
#
# Persistent storage:
#   MongoDB             -> ./data-node
#   PostgreSQL          -> Docker volume (aischolarhub_pgdata2)
#   Ollama              -> ./ollama_data
#   Uploaded documents  -> ./uploads
#   LibreChat /app/data -> Docker volume (aischolarhub_librechat-data)
#
# Retention:
#   3 most recent backups
#   + 2 additional Sunday snapshots
#
# Backup contents:
#   - LibreChat MongoDB database
#   - PostgreSQL/pgvector database
#   - Ollama models/data
#   - Uploaded documents
#   - LibreChat /app/data volume
#   - .env
#   - docker-compose.yml
#   - docker-compose.override.yaml
#   - librechat.yaml
#   - config/
#   - deployment/container metadata
#
# IMPORTANT:
#   The backup contains secrets from .env. Protect this directory.
# =============================================================================

set -euo pipefail

PROJECT_DIR="/opt/aischolarhub"
BACKUP_DIR="${PROJECT_DIR}/backups"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TEMP_TARGET="${BACKUP_DIR}/temp_backup_${TIMESTAMP}"

# Actual current container names
MONGO_CONTAINER="chat-mongodb"
PGVECTOR_CONTAINER="vectordb"
OLLAMA_CONTAINER="aischolarhub-ollama"
LIBRECHAT_CONTAINER="LibreChat"

echo "============================================================"
echo "[$(date)] AI-Scholar-Hub backup starting"
echo "============================================================"

# -----------------------------------------------------------------------------
# 1. Basic checks
# -----------------------------------------------------------------------------

if [ ! -d "${PROJECT_DIR}" ]; then
    echo "ERROR: Project directory not found: ${PROJECT_DIR}"
    exit 1
fi

if [ ! -f "${PROJECT_DIR}/.env" ]; then
    echo "ERROR: .env not found"
    exit 1
fi

mkdir -p "${BACKUP_DIR}"
mkdir -p "${TEMP_TARGET}"

# Cleanup temporary directory on failure
cleanup() {
    rm -rf "${TEMP_TARGET}"
}
trap cleanup EXIT

cd "${PROJECT_DIR}"

# -----------------------------------------------------------------------------
# 2. Verify containers
# -----------------------------------------------------------------------------

echo "[$(date)] Checking containers..."

for container in \
    "${MONGO_CONTAINER}" \
    "${PGVECTOR_CONTAINER}" \
    "${OLLAMA_CONTAINER}" \
    "${LIBRECHAT_CONTAINER}"
do
    if ! docker inspect -f '{{.State.Running}}' "${container}" 2>/dev/null | grep -q true; then
        echo "ERROR: Required container is not running: ${container}"
        exit 1
    fi
done

# -----------------------------------------------------------------------------
# 3. Dump MongoDB
#
# MongoDB credentials are read directly from .env.
# MongoDB container: chat-mongodb
# Authentication database: admin
# Database: LibreChat
# -----------------------------------------------------------------------------

MONGO_INITDB_ROOT_USERNAME="$(
    grep '^MONGO_INITDB_ROOT_USERNAME=' "${PROJECT_DIR}/.env" \
    | head -1 \
    | cut -d'=' -f2-
)"

MONGO_INITDB_ROOT_PASSWORD="$(
    grep '^MONGO_INITDB_ROOT_PASSWORD=' "${PROJECT_DIR}/.env" \
    | head -1 \
    | cut -d'=' -f2-
)"

if [ -z "${MONGO_INITDB_ROOT_USERNAME}" ]; then
    echo "ERROR: MONGO_INITDB_ROOT_USERNAME is missing from .env"
    exit 1
fi

if [ -z "${MONGO_INITDB_ROOT_PASSWORD}" ]; then
    echo "ERROR: MONGO_INITDB_ROOT_PASSWORD is missing from .env"
    exit 1
fi

export MONGO_INITDB_ROOT_USERNAME
export MONGO_INITDB_ROOT_PASSWORD

echo "[$(date)] Dumping MongoDB LibreChat database..."

rm -rf "${TEMP_TARGET}/mongo_LibreChat"

docker exec "${MONGO_CONTAINER}" \
    rm -rf /tmp/aischolar_mongo_dump

docker exec "${MONGO_CONTAINER}" \
    mongodump \
    --username "${MONGO_INITDB_ROOT_USERNAME}" \
    --password "${MONGO_INITDB_ROOT_PASSWORD}" \
    --authenticationDatabase admin \
    --db="LibreChat" \
    --out="/tmp/aischolar_mongo_dump"

docker cp \
    "${MONGO_CONTAINER}:/tmp/aischolar_mongo_dump/LibreChat" \
    "${TEMP_TARGET}/mongo_LibreChat"

docker exec "${MONGO_CONTAINER}" \
    rm -rf /tmp/aischolar_mongo_dump

echo "[$(date)] MongoDB dump complete."

# -----------------------------------------------------------------------------
# 4. Dump PostgreSQL / pgvector
#
# Read credentials from the ACTUAL running container rather than sourcing .env.
# This avoids the shell-environment override problem.
# -----------------------------------------------------------------------------

echo "[$(date)] Dumping PostgreSQL/pgvector..."

PG_USER=$(docker exec "${PGVECTOR_CONTAINER}" printenv POSTGRES_USER)
PG_DB=$(docker exec "${PGVECTOR_CONTAINER}" printenv POSTGRES_DB)

if [ -z "${PG_USER}" ] || [ -z "${PG_DB}" ]; then
    echo "ERROR: Could not determine PostgreSQL credentials from container."
    exit 1
fi

echo "[$(date)] PostgreSQL database: ${PG_DB}"
echo "[$(date)] PostgreSQL user: ${PG_USER}"

docker exec "${PGVECTOR_CONTAINER}" \
    pg_dump \
    -U "${PG_USER}" \
    -d "${PG_DB}" \
    -F c \
    > "${TEMP_TARGET}/pgvector_rag.dump"

echo "[$(date)] PostgreSQL dump complete."

# -----------------------------------------------------------------------------
# 5. Back up Ollama persistent data
#
# Current bind mount:
#   /opt/aischolarhub/ollama_data
#       -> /root/.ollama
#
# This includes nomic-embed-text and any other locally installed models.
# -----------------------------------------------------------------------------

if [ -d "${PROJECT_DIR}/ollama_data" ]; then
    echo "[$(date)] Backing up Ollama data/models..."

    tar -czf "${TEMP_TARGET}/ollama_data.tar.gz" \
        --exclude='ollama_data/cache/model-recommendations.json' \
        -C "${PROJECT_DIR}" \
        ollama_data

    echo "[$(date)] Ollama backup complete."
else
    echo "WARNING: ollama_data directory not found; skipping."
fi

# -----------------------------------------------------------------------------
# 6. Back up uploaded documents
# -----------------------------------------------------------------------------

if [ -d "${PROJECT_DIR}/uploads" ]; then
    echo "[$(date)] Backing up uploaded documents..."

    tar -czf \
        "${TEMP_TARGET}/uploads.tar.gz" \
        -C "${PROJECT_DIR}" \
        uploads

    echo "[$(date)] Upload backup complete."
else
    echo "WARNING: uploads directory not found; skipping."
fi

# -----------------------------------------------------------------------------
# 7. Back up LibreChat /app/data Docker volume
#
# The volume is discovered from the LIVE LibreChat container.
#
# Current discovered volume:
#   aischolarhub_librechat-data
#
# Current contents include:
#   /data/logs.json
#   /data/violations.json
# -----------------------------------------------------------------------------

echo "[$(date)] Locating LibreChat /app/data volume..."

LIBRECHAT_DATA_VOLUME="$(
    docker inspect "${LIBRECHAT_CONTAINER}" \
        --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}'
)"

if [ -n "${LIBRECHAT_DATA_VOLUME}" ]; then

    echo "[$(date)] LibreChat data volume: ${LIBRECHAT_DATA_VOLUME}"
    echo "[$(date)] Backing up LibreChat application data..."

    docker run --rm \
        -v "${LIBRECHAT_DATA_VOLUME}:/data:ro" \
        -v "${TEMP_TARGET}:/backup" \
        alpine \
        sh -c 'tar -czf /backup/librechat-data.tar.gz -C /data .'

    echo "[$(date)] LibreChat application data backup complete."

else
    echo "ERROR: Could not locate /app/data volume on ${LIBRECHAT_CONTAINER}"
    exit 1
fi

# -----------------------------------------------------------------------------
# 8. Back up important configuration
# -----------------------------------------------------------------------------

echo "[$(date)] Copying configuration..."

# Core environment
cp "${PROJECT_DIR}/.env" \
   "${TEMP_TARGET}/.env"

# Main Compose file
cp "${PROJECT_DIR}/docker-compose.yml" \
   "${TEMP_TARGET}/docker-compose.yml"

# Active Compose override
if [ -f "${PROJECT_DIR}/docker-compose.override.yaml" ]; then
    cp "${PROJECT_DIR}/docker-compose.override.yaml" \
       "${TEMP_TARGET}/docker-compose.override.yaml"
fi

# Compose example/template
if [ -f "${PROJECT_DIR}/docker-compose.override.yml.example" ]; then
    cp "${PROJECT_DIR}/docker-compose.override.yml.example" \
       "${TEMP_TARGET}/docker-compose.override.yml.example"
fi

# LibreChat application configuration
if [ -f "${PROJECT_DIR}/librechat.yaml" ]; then
    cp "${PROJECT_DIR}/librechat.yaml" \
       "${TEMP_TARGET}/librechat.yaml"
fi

# Custom configuration/scripts
if [ -d "${PROJECT_DIR}/config" ]; then
    cp -a "${PROJECT_DIR}/config" \
       "${TEMP_TARGET}/config"
fi

# Keep the backup script itself
if [ -f "${PROJECT_DIR}/backup.sh" ]; then
    cp "${PROJECT_DIR}/backup.sh" \
       "${TEMP_TARGET}/backup.sh"
fi

# -----------------------------------------------------------------------------
# 9. Record current Docker/project state
# -----------------------------------------------------------------------------

echo "[$(date)] Recording deployment state..."

docker compose ps \
    > "${TEMP_TARGET}/docker-compose-ps.txt"

docker images \
    --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}' \
    > "${TEMP_TARGET}/docker-images.txt"

docker compose config \
    > "${TEMP_TARGET}/docker-compose-effective.yml"

# Record versions / useful diagnostic information
{
    echo "AI-Scholar-Hub backup"
    echo "====================="
    echo
    echo "Backup timestamp:"
    date
    echo
    echo "Project:"
    echo "${PROJECT_DIR}"
    echo
    echo "Git status (if applicable):"
    git -C "${PROJECT_DIR}" status --short 2>/dev/null || true
    echo
    echo "Docker Compose services:"
    docker compose config --services
    echo
    echo "PostgreSQL:"
    docker exec "${PGVECTOR_CONTAINER}" \
        psql -U "${PG_USER}" -d "${PG_DB}" \
        -c "SELECT version();" 2>/dev/null || true
    echo
    echo "PostgreSQL vector extension:"
    docker exec "${PGVECTOR_CONTAINER}" \
        psql -U "${PG_USER}" -d "${PG_DB}" \
        -c "SELECT extname, extversion FROM pg_extension WHERE extname='vector';" \
        2>/dev/null || true
    echo
    echo "PostgreSQL Docker volume:"
    docker inspect "${PGVECTOR_CONTAINER}" \
        --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}'
    echo
    echo "LibreChat /app/data Docker volume:"
    echo "${LIBRECHAT_DATA_VOLUME}"
    echo
    echo "Ollama models:"
    docker exec "${OLLAMA_CONTAINER}" ollama list 2>/dev/null || true
} > "${TEMP_TARGET}/backup-manifest.txt"

# -----------------------------------------------------------------------------
# 10. Change detection
#
# Do NOT include transient information in the state hash.
#
# backup-manifest.txt contains a timestamp and is excluded.
# docker-compose-ps.txt contains runtime state and is excluded.
#
# Persistent data and configuration remain part of the hash.
# -----------------------------------------------------------------------------

echo "[$(date)] Computing state checksum..."

CURRENT_HASH=$(
    find "${TEMP_TARGET}" \
        -type f \
        ! -name 'backup-manifest.txt' \
        ! -name 'docker-compose-ps.txt' \
        -print0 \
        | sort -z \
        | xargs -0 sha256sum \
        | sha256sum \
        | awk '{print $1}'
)

LATEST_HASH_FILE="${BACKUP_DIR}/latest_state.sha256"

if [ -f "${LATEST_HASH_FILE}" ]; then
    LAST_HASH=$(cat "${LATEST_HASH_FILE}")

    if [ "${CURRENT_HASH}" = "${LAST_HASH}" ]; then
        echo
        echo "[$(date)] NO CHANGES DETECTED."
        echo "[$(date)] Existing backup remains current."
        echo "[$(date)] No new archive created."

        rm -rf "${TEMP_TARGET}"
        trap - EXIT
        exit 0
    fi
fi

# -----------------------------------------------------------------------------
# 11. Create backup archive
# -----------------------------------------------------------------------------

ARCHIVE_NAME="aischolar_backup_${TIMESTAMP}.tar.gz"

echo "[$(date)] Changes detected."
echo "[$(date)] Creating ${ARCHIVE_NAME}..."

tar -czf \
    "${BACKUP_DIR}/${ARCHIVE_NAME}" \
    -C "${BACKUP_DIR}" \
    "temp_backup_${TIMESTAMP}"

# Record checksum of the archive itself
sha256sum \
    "${BACKUP_DIR}/${ARCHIVE_NAME}" \
    > "${BACKUP_DIR}/${ARCHIVE_NAME}.sha256"

# Update state tracker
echo "${CURRENT_HASH}" > "${LATEST_HASH_FILE}"

# Remove temporary directory
rm -rf "${TEMP_TARGET}"
trap - EXIT

echo "[$(date)] Backup archive created successfully."

# -----------------------------------------------------------------------------
# 12. Retention policy
#
# Keep:
#   - 3 newest backups
#   - 2 additional Sunday backups
# -----------------------------------------------------------------------------

echo "[$(date)] Enforcing retention policy..."

cd "${BACKUP_DIR}"

mapfile -t ALL_BACKUPS < <(
    ls -1t aischolar_backup_*.tar.gz 2>/dev/null || true
)

DAILY_COUNT=0
WEEKLY_COUNT=0
KEEP_LIST=()

for file in "${ALL_BACKUPS[@]}"; do

    DATE_STR=$(echo "${file}" | grep -oE '[0-9]{8}' | head -1)

    if [ -z "${DATE_STR}" ]; then
        continue
    fi

    DAY_OF_WEEK=$(date -d "${DATE_STR}" +%u 2>/dev/null || echo "0")

    if [ "${DAILY_COUNT}" -lt 3 ]; then
        KEEP_LIST+=("${file}")
        DAILY_COUNT=$((DAILY_COUNT + 1))

    elif [ "${DAY_OF_WEEK}" -eq 7 ] &&
         [ "${WEEKLY_COUNT}" -lt 2 ]; then

        KEEP_LIST+=("${file}")
        WEEKLY_COUNT=$((WEEKLY_COUNT + 1))
    fi
done

for file in "${ALL_BACKUPS[@]}"; do

    KEEP=false

    for keep in "${KEEP_LIST[@]}"; do
        if [ "${file}" = "${keep}" ]; then
            KEEP=true
            break
        fi
    done

    if [ "${KEEP}" = false ]; then
        echo "[$(date)] Removing old backup: ${file}"
        rm -f "${file}"
        rm -f "${file}.sha256"
    fi
done

# -----------------------------------------------------------------------------
# 13. Final report
# -----------------------------------------------------------------------------

echo
echo "============================================================"
echo "[$(date)] Backup process completed successfully."
echo "============================================================"
echo
echo "Current backups:"
ls -lh "${BACKUP_DIR}"/aischolar_backup_*.tar.gz 2>/dev/null || true
echo
echo "Latest state hash:"
cat "${LATEST_HASH_FILE}"
echo
