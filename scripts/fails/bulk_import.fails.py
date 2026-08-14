#!/usr/bin/env python3
"""
Bulk-provisions students from students.csv (email,role,token_quota) into
LibreChat via `docker exec` — works directly since we're running on a VM
you control (this used to need SSH-into-container indirection back when
this was deployed on Azure App Service, which hides the Docker socket;
not an issue here).

WHY THIS DIFFERS FROM YOUR DRAFT
---------------------------------
Your draft POSTs to `{HUB_URL}/api/admin/users` with a JSON payload
(email/role/tokenQuota/emailVerified). I could not confirm that exact route
+ payload shape exists with those field names:

- LibreChat's documented, stable, version-independent mechanism for this is
  the CLI commands shipped inside the API container: `npm run create-user`
  and `npm run set-balance`. That's what this script drives.
- LibreChat v0.8.5+ *does* ship a real Admin Panel backed by versioned
  `/api/admin/*` REST endpoints (user/group/role management) — see
  https://www.librechat.ai/docs/features/admin_panel. If you're on v0.8.5+
  and want to script against that instead of `docker exec`, it's a
  legitimate path, but check your running instance's own API contract
  first (the admin panel's network tab, or its OpenAPI doc if it exposes
  one) rather than assuming the field names below — I don't have a
  confirmed schema for it. The CLI approach here works on every version.

CSV format (matches your brief):
    email,role,token_quota
    alex.smith@college.edu,undergrad,200000
    jordan.lee@college.edu,phd,1000000

Usage:
    python3 bulk_import.py students.csv \
        --container AI_Scholar_Hub \
        --domain seedsnet.org
"""
import argparse
import csv
import secrets
import subprocess
import sys

VALID_ROLES = {"undergrad", "phd", "postdoc", "instructor"}



def docker_exec(container: str, command: str) -> subprocess.CompletedProcess:
    """Executes a command inside the container after navigating to /app context."""
    return subprocess.run(
        ["docker", "exec", container, "sh", "-c", f"cd /app && {command}"],
        capture_output=True,
        text=True,
    )


def derive_name(email: str) -> str:
    """No 'name' column in CSV — derive display name from email local-part."""
    local = email.split("@", 1)[0]
    return local.replace(".", " ").replace("_", " ").title()


def ensure_user(container: str, email: str) -> tuple[bool, str]:
    temp_password = secrets.token_urlsafe(16)
    name = derive_name(email)
    
    # Executing direct npm command inside /app without '--'
    cmd = f'npm run create-user "{email}" "{name}" "{temp_password}"'
    result = docker_exec(container, cmd)
    
    if result.returncode == 0:
        return True, "created"
    
    combined = (result.stdout + result.stderr).lower()
    if "already exists" in combined or "duplicate" in combined:
        return True, "already existed"
        
    return False, (result.stderr.strip() or result.stdout.strip() or "unknown error")


def set_balance(container: str, email: str, amount: int) -> tuple[bool, str]:
    # Executing direct npm command inside /app without '--'
    cmd = f'npm run set-balance "{email}" {amount}'
    result = docker_exec(container, cmd)
    
    if result.returncode == 0:
        return True, ""
        
    return False, (result.stderr.strip() or result.stdout.strip() or "unknown error")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path")
    parser.add_argument("--container", required=True, help="Running LibreChat API container name")
    parser.add_argument("--domain", required=True, help="Only process emails ending in @<domain>")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    provisioned, skipped, failed = [], [], []

    with open(args.csv_path, newline="") as f:
        for row in csv.DictReader(f):
            email = row["email"].strip().lower()
            role = row["role"].strip().lower()
            try:
                token_quota = int(row["token_quota"])
            except (KeyError, ValueError):
                skipped.append((email, "missing/invalid token_quota"))
                continue

            if not email.endswith(f"@{args.domain}"):
                skipped.append((email, "domain mismatch — refusing to provision outside-institution address"))
                continue
            if role not in VALID_ROLES:
                skipped.append((email, f"unrecognized role '{role}' (expected one of {sorted(VALID_ROLES)})"))
                continue
            if token_quota <= 0:
                skipped.append((email, f"non-positive token_quota ({token_quota})"))
                continue

            if args.dry_run:
                print(f"[dry-run] {email} -> role={role} balance={token_quota}")
                continue

            ok, detail = ensure_user(args.container, email)
            if not ok:
                failed.append((email, f"create-user failed: {detail}"))
                continue

            ok, detail = set_balance(args.container, email, token_quota)
            if ok:
                provisioned.append((email, role, token_quota))
            else:
                failed.append((email, f"set-balance failed: {detail}"))

    print(f"\nProvisioned: {len(provisioned)}  Skipped: {len(skipped)}  Failed: {len(failed)}")
    for email, reason in skipped:
        print(f"  SKIP  {email}: {reason}")
    for email, reason in failed:
        print(f"  FAIL  {email}: {reason}")


if __name__ == "__main__":
    if len(sys.argv) == 1:
        sys.exit(__doc__)
    main()
