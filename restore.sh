#!/usr/bin/env bash
# =============================================================================
# AI Scholar Hub — FULL RESTORE SCRIPT
#
# Note:the restore should authenticate with the MONGO_INITDB_ROOT_* credentials. Update as needed.
# =============================================================================
#
# Purpose:
#   Restore an AI Scholar Hub installation from a backup produced by the
#   AI Scholar Hub Smart Backup script.
#
# Restores:
#   1. MongoDB / LibreChat
#      - Users
#      - Conversations
#      - User settings
#      - LibreChat application data stored in MongoDB
#
#   2. PostgreSQL / pgvector
#      - RAG document metadata
#      - Vector embeddings
#      - RAG database schema
#
#   3. Ollama
#      - Local Ollama model data
#      - nomic-embed-text embedding model
#
#   4. Configuration
#      - .env
#      - docker-compose.yml
#      - config/
#
#   5. Uploaded documents
#      - uploads/ (if present in the backup)
#
# IMPORTANT:
#   This is a DESTRUCTIVE restore.
#
#   MongoDB will be restored with --drop.
#   PostgreSQL will be restored with --clean --if-exists.
#   Existing Ollama data will be replaced.
#
#   The script therefore requires explicit confirmation before proceeding.
#
# Usage:
#
#   1. List available backups:
#
#        ./restore.sh --list
#
#   2. Restore a specific backup:
#
#        ./restore.sh /opt/aischolarhub/backups/aischolar_backup_YYYYMMDD_HHMMSS.tar.gz
#
#   3. Optional: restore without configuration files
#
#        ./restore.sh --no-config BACKUP.tar.gz
#
#   4. Optional: restore without uploads
#
#        ./restore.sh --no-uploads BACKUP.tar.gz
#
# =============================================================================

set -Eeuo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

source /opt/scholarhub-project-roots.env
PROJECT_DIR="$DEV_PROJECT_DIR"
BACKUP_DIR="${PROJECT_DIR}/backups"

# Docker Compose service/container names used by the current project.
MONGO_CONTAINER="chat-mongodb"
PGVECTOR_CONTAINER="vectordb"
OLLAMA_SERVICE="ollama"

# Temporary restore workspace.
RESTORE_ROOT="${PROJECT_DIR}/restore"

# Current project files that can be restored.
CONFIG_FILES=(
    ".env"
    "docker-compose.yml"
)

# -----------------------------------------------------------------------------
# Command-line options
# -----------------------------------------------------------------------------

RESTORE_CONFIG=true
RESTORE_UPLOADS=true
BACKUP_FILE=""

# -----------------------------------------------------------------------------
# Colors / output helpers
# -----------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

info() {
    echo -e "${CYAN}[INFO]${NC} $*"
}

success() {
    echo -e "${GREEN}[OK]${NC} $*"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $*"
}

error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

die() {
    error "$*"
    exit 1
}

# -----------------------------------------------------------------------------
# Error handling
# -----------------------------------------------------------------------------

cleanup() {
    if [[ -n "${RESTORE_WORKDIR:-}" && -d "${RESTORE_WORKDIR:-}" ]]; then
        log "Removing temporary restore directory..."
        rm -rf "${RESTORE_WORKDIR}"
    fi
}

trap cleanup EXIT

# -----------------------------------------------------------------------------
# Usage
# -----------------------------------------------------------------------------

usage() {
    cat <<EOF

AI Scholar Hub — Full Restore

Usage:

  $0 --list

      List available backups.

  $0 BACKUP.tar.gz

      Perform a complete restore.

  $0 --no-config BACKUP.tar.gz

      Restore databases, Ollama and uploads, but preserve the
      currently installed .env, docker-compose.yml and config/.

  $0 --no-uploads BACKUP.tar.gz

      Restore everything except uploads/.

Examples:

  $0 --list

  $0 /opt/aischolarhub/backups/aischolar_backup_20260822_230331.tar.gz

  $0 --no-config /opt/aischolarhub/backups/aischolar_backup_20260822_230331.tar.gz

EOF
}

# -----------------------------------------------------------------------------
# List backups
# -----------------------------------------------------------------------------

list_backups() {

    echo
    echo "Available AI Scholar Hub backups:"
    echo "---------------------------------"

    if ! compgen -G "${BACKUP_DIR}/aischolar_backup_*.tar.gz" > /dev/null; then
        echo "No backups found in:"
        echo "  ${BACKUP_DIR}"
        echo
        exit 0
    fi

    ls -lhtr "${BACKUP_DIR}"/aischolar_backup_*.tar.gz

    echo
}

# -----------------------------------------------------------------------------
# Parse arguments
# -----------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do

    case "$1" in

        --list)
            list_backups
            exit 0
            ;;

        --no-config)
            RESTORE_CONFIG=false
            shift
            ;;

        --no-uploads)
            RESTORE_UPLOADS=false
            shift
            ;;

        -h|--help)
            usage
            exit 0
            ;;

        -*)
            die "Unknown option: $1"
            ;;

        *)
            if [[ -n "${BACKUP_FILE}" ]]; then
                die "More than one backup file was specified."
            fi

            BACKUP_FILE="$1"
            shift
            ;;

    esac

done

# -----------------------------------------------------------------------------
# Validate backup argument
# -----------------------------------------------------------------------------

[[ -n "${BACKUP_FILE}" ]] ||
    die "No backup specified. Use --list or provide a .tar.gz backup."

[[ -f "${BACKUP_FILE}" ]] ||
    die "Backup file does not exist: ${BACKUP_FILE}"

[[ "${BACKUP_FILE}" == *.tar.gz ]] ||
    die "Backup must be a .tar.gz archive."

# -----------------------------------------------------------------------------
# Validate required commands
# -----------------------------------------------------------------------------

for cmd in docker tar sha256sum awk grep sed; do
    command -v "${cmd}" >/dev/null 2>&1 ||
        die "Required command not found: ${cmd}"
done

docker compose version >/dev/null 2>&1 ||
    die "Docker Compose is not available."

# -----------------------------------------------------------------------------
# Display restore summary
# -----------------------------------------------------------------------------

echo
echo "======================================================================"
echo "                 AI SCHOLAR HUB — FULL RESTORE"
echo "======================================================================"
echo
echo "Project:"
echo "  ${PROJECT_DIR}"
echo
echo "Backup:"
echo "  ${BACKUP_FILE}"
echo
echo "Restore configuration:"
echo "  ${RESTORE_CONFIG}"
echo
echo "Restore uploads:"
echo "  ${RESTORE_UPLOADS}"
echo
echo "The following EXISTING DATA WILL BE REPLACED:"
echo
echo "  * MongoDB LibreChat database"
echo "  * PostgreSQL / pgvector database"
echo "  * Ollama data/models"
if [[ "${RESTORE_UPLOADS}" == true ]]; then
    echo "  * uploads/"
fi
if [[ "${RESTORE_CONFIG}" == true ]]; then
    echo "  * .env"
    echo "  * docker-compose.yml"
    echo "  * config/"
fi
echo
echo "======================================================================"
echo

read -r -p "Type RESTORE to continue: " CONFIRM

[[ "${CONFIRM}" == "RESTORE" ]] ||
    die "Restore cancelled."

# -----------------------------------------------------------------------------
# Verify archive integrity / contents
# -----------------------------------------------------------------------------

log "Checking backup archive..."

tar -tzf "${BACKUP_FILE}" >/dev/null ||
    die "Backup archive is corrupt or unreadable."

success "Backup archive is readable."

# -----------------------------------------------------------------------------
# Determine archive root directory
# -----------------------------------------------------------------------------

ARCHIVE_ROOT=$(
    tar -tzf "${BACKUP_FILE}" |
    head -1 |
    cut -d/ -f1
)

[[ -n "${ARCHIVE_ROOT}" ]] ||
    die "Could not determine backup archive root directory."

info "Archive root: ${ARCHIVE_ROOT}"

# -----------------------------------------------------------------------------
# Create temporary restore directory
# -----------------------------------------------------------------------------

RESTORE_WORKDIR="${RESTORE_ROOT}/restore_$(date '+%Y%m%d_%H%M%S')"

mkdir -p "${RESTORE_WORKDIR}"

log "Extracting backup..."

tar -xzf "${BACKUP_FILE}" -C "${RESTORE_WORKDIR}"

BACKUP_ROOT="${RESTORE_WORKDIR}/${ARCHIVE_ROOT}"

[[ -d "${BACKUP_ROOT}" ]] ||
    die "Expected backup directory not found: ${BACKUP_ROOT}"

success "Backup extracted."

# -----------------------------------------------------------------------------
# Show backup contents
# -----------------------------------------------------------------------------

echo
info "Backup contents:"
find "${BACKUP_ROOT}" -maxdepth 2 -type f -printf '  %p\n' | sort
echo

# -----------------------------------------------------------------------------
# Verify expected backup components
# -----------------------------------------------------------------------------

[[ -d "${BACKUP_ROOT}/mongo_LibreChat" ]] ||
    die "MongoDB backup is missing."

[[ -f "${BACKUP_ROOT}/pgvector_rag.dump" ]] ||
    die "PostgreSQL/pgvector dump is missing."

[[ -f "${BACKUP_ROOT}/ollama_data.tar.gz" ]] ||
    die "Ollama backup is missing."

success "Required backup components are present."

# -----------------------------------------------------------------------------
# Load CURRENT project environment before replacing it.
#
# We need the PostgreSQL database name/user to perform the restore.
#
# The current MongoDB container is intentionally configured with --noauth,
# so MongoDB restore does NOT use MONGO_INITDB_ROOT_* authentication.
# -----------------------------------------------------------------------------

CURRENT_ENV="${PROJECT_DIR}/.env"

if [[ -f "${CURRENT_ENV}" ]]; then

    info "Reading current PostgreSQL configuration..."

    POSTGRES_DB=$(
        grep -E '^POSTGRES_DB=' "${CURRENT_ENV}" |
        tail -1 |
        cut -d= -f2- |
        sed 's/[[:space:]]*#.*$//' |
        tr -d '"'\'' '
    )

    POSTGRES_USER=$(
        grep -E '^POSTGRES_USER=' "${CURRENT_ENV}" |
        tail -1 |
        cut -d= -f2- |
        sed 's/[[:space:]]*#.*$//' |
        tr -d '"'\'' '
    )

else
    die "Current .env not found: ${CURRENT_ENV}"
fi

POSTGRES_DB="${POSTGRES_DB:-mydatabase}"
POSTGRES_USER="${POSTGRES_USER:-myuser}"

info "PostgreSQL database: ${POSTGRES_DB}"
info "PostgreSQL user:     ${POSTGRES_USER}"

# -----------------------------------------------------------------------------
# Save a safety copy of the current configuration
# -----------------------------------------------------------------------------

SAFETY_BACKUP="${BACKUP_DIR}/pre_restore_$(date '+%Y%m%d_%H%M%S')"

mkdir -p "${SAFETY_BACKUP}"

info "Saving current configuration before restore..."

cp -a "${PROJECT_DIR}/.env" \
    "${SAFETY_BACKUP}/.env"

cp -a "${PROJECT_DIR}/docker-compose.yml" \
    "${SAFETY_BACKUP}/docker-compose.yml"

if [[ -d "${PROJECT_DIR}/config" ]]; then
    cp -a "${PROJECT_DIR}/config" \
        "${SAFETY_BACKUP}/config"
fi

success "Current configuration saved to:"
echo "  ${SAFETY_BACKUP}"

# -----------------------------------------------------------------------------
# STOP APPLICATION
# -----------------------------------------------------------------------------

echo
log "Stopping AI Scholar Hub containers..."

cd "${PROJECT_DIR}"

docker compose down

success "Docker Compose stack stopped."

# -----------------------------------------------------------------------------
# RESTORE CONFIGURATION
# -----------------------------------------------------------------------------

if [[ "${RESTORE_CONFIG}" == true ]]; then

    log "Restoring configuration files..."

    [[ -f "${BACKUP_ROOT}/.env" ]] ||
        die "Backup .env is missing."

    [[ -f "${BACKUP_ROOT}/docker-compose.yml" ]] ||
        die "Backup docker-compose.yml is missing."

    cp -a "${BACKUP_ROOT}/.env" \
        "${PROJECT_DIR}/.env"

    cp -a "${BACKUP_ROOT}/docker-compose.yml" \
        "${PROJECT_DIR}/docker-compose.yml"

    if [[ -d "${BACKUP_ROOT}/config" ]]; then

        rm -rf "${PROJECT_DIR}/config"

        cp -a "${BACKUP_ROOT}/config" \
            "${PROJECT_DIR}/config"

    fi

    success "Configuration restored."

else

    info "Configuration restore disabled (--no-config)."

fi

# -----------------------------------------------------------------------------
# Re-read PostgreSQL configuration AFTER configuration restore.
# -----------------------------------------------------------------------------

if [[ -f "${PROJECT_DIR}/.env" ]]; then

    POSTGRES_DB=$(
        grep -E '^POSTGRES_DB=' "${PROJECT_DIR}/.env" |
        tail -1 |
        cut -d= -f2- |
        sed 's/[[:space:]]*#.*$//' |
        tr -d '"'\'' '
    )

    POSTGRES_USER=$(
        grep -E '^POSTGRES_USER=' "${PROJECT_DIR}/.env" |
        tail -1 |
        cut -d= -f2- |
        sed 's/[[:space:]]*#.*$//' |
        tr -d '"'\'' '
    )

fi

POSTGRES_DB="${POSTGRES_DB:-mydatabase}"
POSTGRES_USER="${POSTGRES_USER:-myuser}"

# -----------------------------------------------------------------------------
# START DATABASE / INFRASTRUCTURE SERVICES
#
# We start MongoDB, PostgreSQL and Ollama first.
# -----------------------------------------------------------------------------

log "Starting MongoDB, PostgreSQL and Ollama..."

docker compose up -d mongodb vectordb ollama

# -----------------------------------------------------------------------------
# Wait for PostgreSQL
# -----------------------------------------------------------------------------

log "Waiting for PostgreSQL..."

PG_READY=false

for i in {1..30}; do

    if docker exec "${PGVECTOR_CONTAINER}" \
        pg_isready \
        -U "${POSTGRES_USER}" \
        -d "${POSTGRES_DB}" \
        >/dev/null 2>&1; then

        PG_READY=true
        break

    fi

    sleep 2

done

[[ "${PG_READY}" == true ]] ||
    die "PostgreSQL did not become ready."

success "PostgreSQL is ready."

# -----------------------------------------------------------------------------
# Wait for MongoDB
# -----------------------------------------------------------------------------

log "Waiting for MongoDB..."

MONGO_READY=false

for i in {1..30}; do

    if docker exec "${MONGO_CONTAINER}" \
        mongosh \
        --quiet \
        --eval "db.adminCommand({ping:1}).ok" \
        2>/dev/null |
        grep -q "1"; then

        MONGO_READY=true
        break

    fi

    sleep 2

done

[[ "${MONGO_READY}" == true ]] ||
    die "MongoDB did not become ready."

success "MongoDB is ready."

# -----------------------------------------------------------------------------
# Wait for Ollama
# -----------------------------------------------------------------------------

log "Waiting for Ollama..."

OLLAMA_READY=false

for i in {1..30}; do

    if docker exec "${MONGO_CONTAINER}" true >/dev/null 2>&1; then

        if docker run --rm \
            --network aischolarhub_default \
            curlimages/curl:latest \
            --silent \
            --fail \
            http://ollama:11434/api/tags \
            >/dev/null 2>&1; then

            OLLAMA_READY=true
            break

        fi

    fi

    sleep 2

done

[[ "${OLLAMA_READY}" == true ]] ||
    die "Ollama did not become ready."

success "Ollama is ready."

# -----------------------------------------------------------------------------
# RESTORE MONGODB
# -----------------------------------------------------------------------------

echo
log "Restoring MongoDB / LibreChat database..."

docker cp \
    "${BACKUP_ROOT}/mongo_LibreChat" \
    "${MONGO_CONTAINER}:/tmp/mongo_LibreChat"

docker exec "${MONGO_CONTAINER}" \
    mongorestore \
    --db=LibreChat \
    --drop \
    /tmp/mongo_LibreChat

docker exec "${MONGO_CONTAINER}" \
    rm -rf /tmp/mongo_LibreChat

success "MongoDB / LibreChat database restored."

# -----------------------------------------------------------------------------
# Verify MongoDB
# -----------------------------------------------------------------------------

log "Verifying MongoDB..."

MONGO_COUNT=$(
    docker exec "${MONGO_CONTAINER}" \
        mongosh LibreChat \
        --quiet \
        --eval "db.getCollectionNames().length"
)

info "LibreChat collection count: ${MONGO_COUNT}"

[[ "${MONGO_COUNT}" -gt 0 ]] ||
    die "MongoDB restore appears empty."

success "MongoDB verification passed."

# -----------------------------------------------------------------------------
# RESTORE POSTGRESQL / PGVECTOR
# -----------------------------------------------------------------------------

echo
log "Restoring PostgreSQL / pgvector..."

docker cp \
    "${BACKUP_ROOT}/pgvector_rag.dump" \
    "${PGVECTOR_CONTAINER}:/tmp/pgvector_rag.dump"

docker exec "${PGVECTOR_CONTAINER}" \
    pg_restore \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    --clean \
    --if-exists \
    /tmp/pgvector_rag.dump

docker exec "${PGVECTOR_CONTAINER}" \
    rm -f /tmp/pgvector_rag.dump

success "PostgreSQL / pgvector database restored."

# -----------------------------------------------------------------------------
# Verify pgvector extension
# -----------------------------------------------------------------------------

log "Verifying pgvector extension..."

VECTOR_VERSION=$(
    docker exec "${PGVECTOR_CONTAINER}" \
        psql \
        -U "${POSTGRES_USER}" \
        -d "${POSTGRES_DB}" \
        -tAc \
        "SELECT extversion FROM pg_extension WHERE extname='vector';"
)

[[ -n "${VECTOR_VERSION}" ]] ||
    die "pgvector extension was not found after restore."

success "pgvector extension: ${VECTOR_VERSION}"

# -----------------------------------------------------------------------------
# Show PostgreSQL table count
# -----------------------------------------------------------------------------

PG_TABLE_COUNT=$(
    docker exec "${PGVECTOR_CONTAINER}" \
        psql \
        -U "${POSTGRES_USER}" \
        -d "${POSTGRES_DB}" \
        -tAc \
        "SELECT count(*) FROM information_schema.tables
         WHERE table_schema='public';"
)

info "PostgreSQL public tables: ${PG_TABLE_COUNT}"

# -----------------------------------------------------------------------------
# RESTORE OLLAMA
# -----------------------------------------------------------------------------

echo
log "Restoring Ollama data and models..."

# Stop Ollama while replacing its data.
docker compose stop "${OLLAMA_SERVICE}" || true

# Remove current Ollama data.
rm -rf "${PROJECT_DIR}/ollama_data"

# Extract backup.
tar -xzf \
    "${BACKUP_ROOT}/ollama_data.tar.gz" \
    -C "${PROJECT_DIR}"

[[ -d "${PROJECT_DIR}/ollama_data" ]] ||
    die "Ollama data directory was not restored."

# Our project uses ppatra ownership for host-mounted Ollama data.
if id ppatra >/dev/null 2>&1; then

    chown -R ppatra:ppatra \
        "${PROJECT_DIR}/ollama_data"

fi

success "Ollama data restored."

# -----------------------------------------------------------------------------
# Start Ollama
# -----------------------------------------------------------------------------

docker compose up -d "${OLLAMA_SERVICE}"

sleep 3

# -----------------------------------------------------------------------------
# Verify Ollama model
# -----------------------------------------------------------------------------

log "Verifying Ollama models..."

OLLAMA_MODELS=$(
    docker compose exec -T "${OLLAMA_SERVICE}" \
        ollama list
)

echo "${OLLAMA_MODELS}"

echo "${OLLAMA_MODELS}" |
    grep -q "nomic-embed-text" ||
    warn "nomic-embed-text was not found in ollama list."

if echo "${OLLAMA_MODELS}" | grep -q "nomic-embed-text"; then
    success "nomic-embed-text is available."
fi

# -----------------------------------------------------------------------------
# RESTORE UPLOADS
# -----------------------------------------------------------------------------

if [[ "${RESTORE_UPLOADS}" == true ]]; then

    if [[ -f "${BACKUP_ROOT}/uploads.tar.gz" ]]; then

        echo
        log "Restoring uploaded documents..."

        rm -rf "${PROJECT_DIR}/uploads"

        tar -xzf \
            "${BACKUP_ROOT}/uploads.tar.gz" \
            -C "${PROJECT_DIR}"

        mkdir -p "${PROJECT_DIR}/uploads"

        if id ppatra >/dev/null 2>&1; then
            chown -R ppatra:ppatra \
                "${PROJECT_DIR}/uploads"
        fi

        success "Uploads restored."

    else

        warn "No uploads.tar.gz found in this backup."
        warn "Skipping uploads."

    fi

else

    info "Upload restore disabled (--no-uploads)."

fi

# -----------------------------------------------------------------------------
# START COMPLETE APPLICATION
# -----------------------------------------------------------------------------

echo
log "Starting complete AI Scholar Hub stack..."

cd "${PROJECT_DIR}"

docker compose up -d

success "AI Scholar Hub stack started."

# -----------------------------------------------------------------------------
# Wait for containers
# -----------------------------------------------------------------------------

log "Allowing services to initialize..."

sleep 10

# -----------------------------------------------------------------------------
# Display service status
# -----------------------------------------------------------------------------

echo
echo "======================================================================"
echo "                     CONTAINER STATUS"
echo "======================================================================"

docker compose ps

# -----------------------------------------------------------------------------
# RAG API verification
# -----------------------------------------------------------------------------

echo
log "Checking RAG API..."

if docker compose ps rag_api 2>/dev/null |
    grep -q "Up"; then

    success "RAG API container is running."

else

    warn "RAG API container is not reported as running."

fi

# -----------------------------------------------------------------------------
# API verification
# -----------------------------------------------------------------------------

echo
log "Checking LibreChat API..."

if docker compose ps api 2>/dev/null |
    grep -q "Up"; then

    success "LibreChat API container is running."

else

    warn "LibreChat API container is not reported as running."

fi

# -----------------------------------------------------------------------------
# Final RAG logs
# -----------------------------------------------------------------------------

echo
echo "======================================================================"
echo "                         RAG API LOG"
echo "======================================================================"

docker compose logs --tail=30 rag_api || true

# -----------------------------------------------------------------------------
# Final API logs
# -----------------------------------------------------------------------------

echo
echo "======================================================================"
echo "                       LIBRECHAT API LOG"
echo "======================================================================"

docker compose logs --tail=30 api || true

# -----------------------------------------------------------------------------
# Final summary
# -----------------------------------------------------------------------------

echo
echo "======================================================================"
echo "                    RESTORE COMPLETED"
echo "======================================================================"
echo
echo "Backup restored:"
echo "  ${BACKUP_FILE}"
echo
echo "Safety copy of previous configuration:"
echo "  ${SAFETY_BACKUP}"
echo
echo "Next checks:"
echo
echo "  1. Open:"
echo "       https://aischolarhub.seedsnet.org"
echo
echo "  2. Verify administrator login."
echo
echo "  3. Verify GPT-4.1-mini."
echo
echo "  4. Verify GPT-5.4-mini."
echo
echo "  5. Verify RAG/document upload."
echo
echo "  6. Verify Ollama:"
echo "       docker compose exec ollama ollama list"
echo
echo "  7. Verify pgvector:"
echo "       docker exec vectordb psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} \\"
echo "         -c \"SELECT extname, extversion FROM pg_extension WHERE extname='vector';\""
echo
echo "======================================================================"
echo
success "AI Scholar Hub restore procedure completed."
