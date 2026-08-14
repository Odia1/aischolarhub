#!/usr/bin/env bash
# Generates secrets that are safe to drop straight into connection strings
# and Azure CLI args — no shell-special characters (!, #, $, &, etc.) that
# would otherwise get mangled or need escaping in a Mongo/Postgres URI.
set -euo pipefail

gen_alnum() { # $1 = length
  openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"
}

echo "DB_PASS=$(gen_alnum 24)"
echo "MEILI_MASTER_KEY=$(gen_alnum 32)"
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "CREDS_KEY=$(openssl rand -hex 32)"
echo "CREDS_IV=$(openssl rand -hex 16)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c24)"
echo ""
echo "# Pipe this into a .env, or better: az keyvault secret set for each line."
