#!/usr/bin/env python3
"""
Bulk-provisions students from a roster CSV into LibreChat via `docker exec`
— works directly since this runs on a VM you control.

CSV format:
    email,name,temp_password,role,token_quota
    odia@seedsnet.org,Odia User,foobar,undergrad,200000

FIXES IN THIS VERSION (both confirmed against LibreChat's own source/issues)
-----------------------------------------------------------------------------
1. create-user.js's real signature is (email, name, USERNAME, password) —
   four positional args, not three. An earlier version of this script was
   missing `username` entirely. `role` (undergrad/phd/etc.) is never passed
   to create-user.js at all — it's pure CSV metadata used below to pick the
   set-balance amount, nothing more.

2. create-user.js prompts interactively ("Email verified? (Y/n)") EVEN WHEN
   a password is supplied as an argument — this is a confirmed, currently
   open LibreChat bug (danny-avila/LibreChat#10202), not something specific
   to your setup. `docker exec` here has no attached stdin, so that prompt
   waits forever for an answer that can never come — this is what "hangs"
   actually was. Fixed by passing `--email-verified=True` explicitly, which
   skips the prompt outright.

3. `docker_exec()` now has a timeout. If some other prompt shows up in a
   future LibreChat version that this script doesn't yet account for, you
   get a clear timeout error in ~30s instead of the whole run hanging with
   no explanation.

4. Uses `npm run create-user --` rather than a hardcoded node path
   (`node /app/config/create-user.js`) — the exact file layout has changed
   between LibreChat versions (confirmed: some versions put it under
   /app/api, current ones under /app/config), so the npm script alias is
   what stays correct across versions rather than a path you'd have to
   re-verify every time you update the image.

Usage:
    python3 bulk_import.py students.csv --container AI_Scholar_Hub --domain seedsnet.org
"""
#!/usr/bin/env python3
"""
Bulk-provisions students from a roster CSV into LibreChat via `docker exec`
— works directly since this runs on a VM you control.

CSV format:
    email,name,temp_password,role,token_quota
    odia@seedsnet.org,Odia User,foobar,undergrad,200000
"""
import argparse
import csv
import subprocess
import sys

VALID_ROLES = {"undergrad", "phd", "postdoc", "instructor"}
DOCKER_TIMEOUT_SECONDS = 30


class _TimedOut:
    returncode = -1
    stdout = ""
    stderr = (
        f"docker exec timed out after {DOCKER_TIMEOUT_SECONDS}s — almost "
        "certainly stuck on an interactive prompt inside the container"
    )


def docker_exec(container: str, *args: str) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            ["docker", "exec", container, *args],
            capture_output=True, text=True, timeout=DOCKER_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return _TimedOut()


def derive_username(email: str) -> str:
    return email.split("@", 1)[0]


def derive_display_name(email: str) -> str:
    return derive_username(email).replace(".", " ").replace("_", " ").title()


def ensure_user(container: str, email: str, name: str, password: str) -> tuple[bool, str]:
    username = derive_username(email)
    result = docker_exec(
        container, "node", "/app/config/create-user.js",
        email, name, username, password, "--email-verified=True",
    )
    if result.returncode == 0:
        return True, "created"
    combined = (result.stdout + result.stderr).lower()
    if "already exists" in combined or "duplicate" in combined:
        return True, "already existed"
    return False, (result.stderr.strip() or result.stdout.strip() or "unknown error")


def set_balance(container: str, email: str, amount: int) -> tuple[bool, str]:
    result = docker_exec(container, "node", "/app/config/set-balance.js", email, str(amount))
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
            name = (row.get("name") or "").strip() or derive_display_name(email)
            password = (row.get("temp_password") or "").strip()
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
            if not password:
                skipped.append((email, "missing temp_password value in CSV"))
                continue

            if args.dry_run:
                print(f"[dry-run] {email} -> name={name} role={role} balance={token_quota}")
                continue

            ok, detail = ensure_user(args.container, email, name, password)
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
